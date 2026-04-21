/**
 * RapierVehicleController — full physics replacement using Rapier3D.
 *
 * Replaces custom VehiclePhysics with Rapier's built-in:
 *   - DynamicRayCastVehicleController (suspension, tire friction, steering)
 *   - Rigid body dynamics (3D forces, inertia, collision)
 *   - Built-in collision detection (walls, guardrails, car-vs-car)
 *
 * Terrain collision via TerrainCollider (trimesh patch).
 * Guardrails via Guardrails (road-edge cuboids).
 *
 * Keeps our game-feel modules:
 *   - EngineUnit (RPM, torque curves, rev limiter, turbo)
 *   - Gearbox (auto-shift, shift timing)
 *   - Brakes (brake + handbrake model)
 *   - DragModel (aero drag + rolling resistance)
 *
 * Coordinate convention: Rapier Y-up, car faces +Z (front wheels at +Z).
 */

import RAPIER from "@dimforge/rapier3d-compat";
import { DragModel } from "./aero/DragModel.ts";
import type { CarConfig, ChassisSpec } from "./configs.ts";
import { buildDebugInfo } from "./DebugInfoBuilder.ts";
import { BurnoutState, type BurnoutStateResult } from "./drive/BurnoutState.ts";
import { DriveState } from "./drive/DriveState.ts";
import { computeForces } from "./drive/ForceComputer.ts";
import { EngineUnit } from "./engine/EngineUnit.ts";
import { Guardrails } from "./rapier-guardrails.ts";
import { TerrainCollider } from "./rapier-terrain-collider.ts";
import { Brakes } from "./suspension/Brakes.ts";
import { CustomSuspension } from "./suspension/CustomSuspension.ts";
import type { TireDynamicsState } from "./tires/TireDynamics.ts";
import { TireDynamics } from "./tires/TireDynamics.ts";
import type { EngineTelemetry, TerrainProvider, VehicleInput, VehicleState } from "./types.ts";

export type { TerrainProvider, VehicleInput } from "./types.ts";

// ── Vehicle controller tuning constants ──
const STEER_SPEED = 2.0;

const MAX_SUS_FORCE = 100000;
const WHEEL_FRICTION_SLIP = 2.0;
const WHEEL_SIDE_FRICTION = 2.5;
const ANGULAR_DAMPING = 1.0;

// ── Lateral grip falloff ──
// Simulates tire grip saturation under high lateral load.
// Real tires follow a Pacejka-like curve: grip peaks at ~0.8g then falls.
// Below threshold: full grip. Above threshold: grip reduces linearly.
const LAT_GRIP_THRESHOLD = 0.6; // g — where grip starts to fall off
const LAT_GRIP_RANGE = 0.8; // g — range over which grip drops to minimum
const LAT_GRIP_FALLOFF = 0.35; // max 35% grip reduction at 1.4g
const PHYSICS_SUBSTEPS = 2;
const YAW_DAMP_RATE = 15.0;

// ── Real-world braking physics ──
// Tire-road friction coefficient (dry asphalt, performance tires)
// Rolling resistance coefficient (performance tires on asphalt)
// Maximum reverse speed (m/s) — ~40 km/h, electronic limiter like real cars

export class RapierVehicleController {
	private world!: RAPIER.World;
	private carBody!: RAPIER.RigidBody;
	private vehicle!: RAPIER.DynamicRayCastVehicleController;

	private wheelFL = 0;
	private wheelFR = 1;
	private wheelRL = 2;
	private wheelRR = 3;

	private readonly engineUnit: EngineUnit;
	private readonly brakes: Brakes;
	private readonly drag: DragModel;
	private readonly tireDynamics: TireDynamics;
	private readonly customSuspension: CustomSuspension;
	private readonly _config: CarConfig;

	private _terrain: TerrainProvider | null = null;
	private terrainCollider: TerrainCollider | null = null;
	private guardrails: Guardrails | null = null;
	get guardrailBodies(): readonly RAPIER.RigidBody[] {
		return this.guardrails?.bodyList ?? [];
	}

	// Deferred rebuilds (applied AFTER world.step() to avoid WASM aliasing)
	private pendingGroundRebuild: { x: number; z: number } | null = null;
	private pendingGuardrailUpdate: { x: number; z: number } | null = null;
	private _lastOffRoadForce = 0;

	state: VehicleState;
	telemetry: EngineTelemetry;
	private simBoostNorm = 0;
	private steerAngle = 0;
	/** Whether handbrake is currently active */
	handbrakeActive = false;
	/** Whether burnout is currently active */
	burnoutActive = false;
	/** Whether revving in neutral (space+W, stopped) */
	revvingInNeutral = false;
	private initialized = false;
	private readonly driveState = new DriveState();
	private readonly burnoutState = new BurnoutState();
	private _wheelSpinAngles = [0, 0, 0, 0];
	private _wheelSpinVels = [0, 0, 0, 0]; // current angular velocities (rad/s)
	/** Tire dynamics state snapshot (updated each frame after physics step) */
	tireDynState: TireDynamicsState | null = null;
	/** Current frame force breakdown for debug visualization (world-space) */
	forces: {
		engine: number;
		brake: number;
		wheelBrake: number;
		rolling: number;
		aero: number;
		engineBrake: number;
		coast: number;
		offRoad: number;
		total: number;
	} = {
		engine: 0,
		brake: 0,
		wheelBrake: 0,
		rolling: 0,
		aero: 0,
		offRoad: 0,
		engineBrake: 0,
		coast: 0,
		total: 0,
	};

	constructor(config: CarConfig) {
		this._config = config;
		this.engineUnit = new EngineUnit(config.engine, config.gearbox, config.chassis.wheelRadius);
		this.brakes = new Brakes(config.brakes);
		this.drag = new DragModel(config.drag);
		this.tireDynamics = new TireDynamics({
			chassis: config.chassis,
			tires: config.tires,
			wheelIndices: { fl: 0, fr: 1, rl: 2, rr: 3 },
		});
		this.customSuspension = new CustomSuspension({
			stiffness: config.suspension?.customStiffness ?? 25000,
			damping: config.suspension?.customDamping ?? 1500,
		});
		this.state = {
			speed: 0,
			rpm: config.engine.idleRPM,
			gear: 1,
			steeringAngle: 0,
			throttle: 0,
			brake: 0,
			onGround: true,
		};
		this.telemetry = this.engineUnit.getTelemetry(0);
	}

	async init(): Promise<void> {
		await RAPIER.init();
		this.buildWorld();
		this.initialized = true;
	}

	private buildWorld(): void {
		this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
		const { chassis } = this._config;
		const { wheelRadius, mass, halfExtents } = chassis;
		const [halfW, halfH, halfD] = halfExtents;

		// Car body — moderate angular damping allows realistic pitch/roll while preventing spin
		this.carBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0).setLinearDamping(0.0).setAngularDamping(ANGULAR_DAMPING),
		);
		this.world.createCollider(
			RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD)
				.setDensity(mass / (halfW * 2 * halfH * 2 * halfD * 2))
				.setFriction(0.0)
				.setRestitution(0.1),
			this.carBody,
		);

		// NOTE: Center-of-mass offset (from weightFront/cgHeight config) is computed
		// by TireDynamics but NOT applied via setAdditionalMassProperties here.
		// Reason: Rapier's vehicle suspension solver is calibrated for COM at geometric center.
		// Moving COM changes suspension force distribution and breaks existing tuning.
		// COM effects (weight transfer) are simulated through the tire dynamics force model instead.
		// The computed COM position is available via tireDynamics.state.localCOM for debug visualization.

		// Vehicle controller with 4 wheels
		this.vehicle = this.world.createVehicleController(this.carBody);
		const susRest = chassis.suspensionRestLength;
		const wl = halfW * 0.85;
		const wy = -halfH;
		const wheelOpts = [
			{ x: -wl, y: wy, z: halfD * 0.7 },
			{ x: wl, y: wy, z: halfD * 0.7 },
			{ x: -wl, y: wy, z: -halfD * 0.7 },
			{ x: wl, y: wy, z: -halfD * 0.7 },
		];
		this.customSuspension.setAnchors(wheelOpts);
		for (const wo of wheelOpts) {
			this.vehicle.addWheel(
				{ x: wo.x, y: wy, z: wo.z },
				{ x: 0, y: -1, z: 0 },
				{ x: 1, y: 0, z: 0 },
				susRest,
				wheelRadius,
			);
		}

		for (let i = 0; i < 4; i++) {
			this.vehicle.setWheelSuspensionStiffness(i, chassis.suspensionStiffness);
			this.vehicle.setWheelSuspensionCompression(i, chassis.dampingCompression);
			this.vehicle.setWheelSuspensionRelaxation(i, chassis.dampingRelaxation);
			this.vehicle.setWheelMaxSuspensionTravel(i, chassis.maxSuspensionTravel);
			this.vehicle.setWheelMaxSuspensionForce(i, MAX_SUS_FORCE);
			this.vehicle.setWheelFrictionSlip(i, WHEEL_FRICTION_SLIP);
			this.vehicle.setWheelSideFrictionStiffness(i, WHEEL_SIDE_FRICTION);
		}

		this.rebuildGroundPatch(0, 0);
	}

	setTerrain(terrain: TerrainProvider): void {
		this._terrain = terrain;
		if (this.initialized) {
			this.terrainCollider = new TerrainCollider(this.world, terrain);
			this.guardrails = new Guardrails(this.world, terrain);
			const p = this.carBody.translation();
			this.rebuildGroundPatch(p.x, p.z);
		}
	}

	private rebuildGroundPatch(cx: number, cz: number): void {
		if (this.terrainCollider) {
			this.terrainCollider.rebuild(cx, cz);
		}
	}

	private updateGuardrails(cx: number, cz: number): void {
		if (this.guardrails) {
			this.guardrails.update(cx, cz);
		}
	}

	update(input: VehicleInput, delta: number): void {
		if (!this.initialized) return;
		const dt = Math.min(delta, 1 / 30);
		const { chassis, engine: engineSpec, tires } = this._config;
		const engine = this.engineUnit.engine;
		const gearbox = this.engineUnit.gearbox;

		// ── Read physics state (copy WASM values immediately) ──
		const pos = this.carBody.translation();
		const vel = this.carBody.linvel();
		const vx = vel.x;
		const vz = vel.z;
		const rot = this.carBody.rotation();
		const rw = rot.w;
		const rx = rot.x;
		const ry = rot.y;
		const rz = rot.z;
		const heading = Math.atan2(2 * (rw * ry + rz * rx), 1 - 2 * (ry * ry + rx * rx));
		const localVelX = vz * Math.cos(heading) + vx * Math.sin(heading);
		const speedMs = Math.sqrt(vx * vx + vz * vz);
		const speedKmh = speedMs * 3.6;
		const absSpeedMs = Math.abs(localVelX);

		// ── Check terrain patch rebuild ──
		if (this.terrainCollider?.needsRebuild(pos.x, pos.z)) {
			this.pendingGroundRebuild = { x: pos.x, z: pos.z };
		}
		this.pendingGuardrailUpdate = { x: pos.x, z: pos.z };

		// ── Steering ──
		const speedRed = Math.max(0.15, 1 - (speedKmh / 140) ** 1.5);
		const targetSteer = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * chassis.maxSteerAngle * speedRed;
		const maxD = STEER_SPEED * dt;
		const sd = targetSteer - this.steerAngle;
		this.steerAngle = Math.abs(sd) < maxD ? targetSteer : this.steerAngle + Math.sign(sd) * maxD;
		this.state.steeringAngle = this.steerAngle;

		// ── Drive state machine ──
		const wantsForward = !!input.forward && !input.backward;
		const wantsBackward = !!input.backward && !input.forward;
		const ds = this.driveState.compute(wantsForward, wantsBackward, localVelX);
		const { isBraking, isReverse, effectiveNeutral: dsNeutral } = ds;

		// ── Burnout state machine ──
		// Full update happens after engine/gearbox so we have torque data.
		const wasBurnoutActive = this.burnoutActive;

		// Throttle: full during revving or burnout, normal otherwise
		engine.throttle =
			this.revvingInNeutral || this.burnoutActive ? 1 : wantsForward && !input.handbrake ? 1 : isReverse ? 0.5 : 0;

		// Gearbox: handbrake forces neutral; during burnout lock gear until car moves
		const effectiveNeutral = dsNeutral || !!input.handbrake;
		if (effectiveNeutral) {
			gearbox.effectiveRatio = 0;
		} else if (isReverse) {
			const firstGearRatio = this._config.gearbox.gearRatios[0] || 3.5;
			gearbox.effectiveRatio = engineSpec.finalDrive * firstGearRatio;
		} else if (this.burnoutActive && absSpeedMs < 3.0) {
			// Lock gear 1 during standstill burnout.
			// Once car reaches ~11 km/h, unlock gearbox — auto-shift will
			// upshift, torque drops, and the physics formula ends the burnout.
			gearbox.effectiveRatio = this._config.gearbox.gearRatios[gearbox.currentGear];
			gearbox.isShifting = false;
		} else {
			gearbox.update(dt, engine, localVelX, isBraking);
		}
		// During burnout, driven wheels spin freely against reduced traction.
		// Engine should rev toward redline — pass wheel speed derived from
		// near-redline RPM through the drivetrain so engine.update() computes correctly.
		// Only fake wheel speed at low speeds; once car is moving, use real speed.
		let engineWheelSpeed = localVelX;
		if (this.burnoutActive && absSpeedMs < 3.0 && gearbox.effectiveRatio > 0.1) {
			const nearRedlineRPM = engineSpec.maxRPM * 0.95;
			const wheelCircumference = 2 * Math.PI * chassis.wheelRadius;
			const burnoutWheelSpeed =
				((nearRedlineRPM / (gearbox.effectiveRatio * engineSpec.finalDrive)) * wheelCircumference) / 60;
			engineWheelSpeed = Math.max(localVelX, burnoutWheelSpeed);
		}
		engine.update(engineWheelSpeed, gearbox.effectiveRatio, chassis.wheelRadius, dt);

		// ── Burnout full update (after engine — needs torque/gear data) ──
		const bs = this.burnoutState.update(!!input.handbrake, !!input.forward, absSpeedMs, dt, this._config.drivetrain, {
			gearRatio: gearbox.effectiveRatio,
			engineTorqueNm: engineSpec.torqueNm * engine.getTorqueMultiplier(),
			finalDrive: engineSpec.finalDrive,
			wheelRadius: chassis.wheelRadius,
			mass: chassis.mass,
			tractionPct: tires.tractionPct,
			currentGear: gearbox.currentGear + 1,
		});
		this.burnoutActive = bs.active;
		this.revvingInNeutral = bs.revvingInNeutral;

		// On burnout activation (clutch dump), force gear 1 for max torque
		if (bs.active && !wasBurnoutActive) {
			gearbox.currentGear = 0;
			gearbox.effectiveRatio = this._config.gearbox.gearRatios[0];
			gearbox.isShifting = false;
		}

		// ── Brake lights ──
		this.brakes.isBraking = isBraking;
		this.brakes.isHandbrake = !!input.handbrake;
		this.handbrakeActive = !!input.handbrake;
		this.brakes.brakePressure = isBraking || input.handbrake ? 1 : 0;

		// ── Force computation ──
		const tractionPerWheel = (chassis.mass * tires.tractionPct * 9.82) / 2;
		const fc = computeForces(
			{
				dsIsBraking: isBraking,
				dsIsReverse: isReverse,
				dsNeutral,
				absSpeedMs,
				localVelX,
				heading,
				handbrake: !!input.handbrake,
				wantsForward,
				tractionPerWheel,
			},
			engine as any,
			gearbox as any,
			{ ...engineSpec, gearRatios: this._config.gearbox.gearRatios, maxBrakeG: this._config.brakes.maxBrakeG },
			chassis,
			this.drag.config,
			dt,
		);

		this.applyEngineForce(fc.engF);

		// ── Apply wheel brakes (front-biased for normal braking) ──
		this.vehicle.setWheelBrake(this.wheelFL, fc.rapierBrakeForce * 1.2);
		this.vehicle.setWheelBrake(this.wheelFR, fc.rapierBrakeForce * 1.2);

		// ── Apply body retard impulse ──
		if (fc.retardFx !== 0 || fc.retardFz !== 0) {
			this.carBody.applyImpulse({ x: fc.retardFx, y: 0, z: fc.retardFz }, true);
		}

		this._lastOffRoadForce = this.applyOffRoadDrag(vx, vz, pos.x, pos.z, heading, speedMs, dt);

		// ── Tire dynamics: handbrake → rear grip reduction ──
		const rearGripMul = this.tireDynamics.updateHandbrake(!!input.handbrake, absSpeedMs, dt);
		const bodyAngVel = this.carBody.angvel();
		const rawLatG = Math.abs(bodyAngVel.y * localVelX) / 9.81;

		// ── Steering → front wheels ──
		this.vehicle.setWheelSteering(this.wheelFL, this.steerAngle);
		this.vehicle.setWheelSteering(this.wheelFR, this.steerAngle);

		this.applyTireFriction(rearGripMul, rawLatG, bs);
		this.applyHandbrakeBrakes(fc.rapierBrakeForce, !!input.handbrake);

		// ── Step physics (substeps for stability) ──
		this.stepPhysics(dt, localVelX, fc, chassis, bodyAngVel);

		// ── Post-step forces ──
		this.applyPostStepForces(absSpeedMs, this.steerAngle, dt);

		// Record forces for debug visualization
		this.forces.engine = fc.engF;
		this.forces.brake = fc.forcesDebug.brake;
		this.forces.wheelBrake = fc.forcesDebug.wheelBrake;
		this.forces.rolling = fc.forcesDebug.rolling;
		this.forces.aero = fc.forcesDebug.aero;
		this.forces.engineBrake = fc.forcesDebug.engineBrake;
		this.forces.coast = fc.forcesDebug.coast;
		this.forces.offRoad = this._lastOffRoadForce;
		this.forces.total =
			this.forces.engine +
			this.forces.brake +
			this.forces.wheelBrake +
			this.forces.rolling +
			this.forces.aero +
			this.forces.engineBrake +
			this.forces.coast +
			this._lastOffRoadForce;

		// ── Post-step world rebuilds ──
		// WHY: Rapier forbids modifying the physics world during step().
		// Terrain trimesh patches and guardrail cuboids are rebuilt here
		// when the car moves to a new region.
		this.flushPendingRebuilds();

		// Suppress micro-yaw from tire solver noise when not steering
		if (Math.abs(this.steerAngle) < 0.01) {
			const av = this.carBody.angvel();
			const yawDamp = Math.exp(-YAW_DAMP_RATE * dt);
			this.carBody.setAngvel({ x: av.x, y: av.y * yawDamp, z: av.z }, true);
		}

		// ── Update per-wheel spin angles ──
		this.updateWheelSpin(fc, dt, !!input.handbrake, bs);

		// ── Output state ──
		this.state.speed = localVelX;
		this.state.rpm = engine.rpm;
		this.state.gear = isReverse ? -1 : wantsForward || wantsBackward ? gearbox.currentGear + 1 : 0;
		this.state.throttle = engine.throttle;
		this.state.brake = this.brakes.brakePressure;
		this.state.onGround = this.countContacts() > 0;

		const maxF = (engineSpec.torqueNm * gearbox.effectiveRatio * engineSpec.finalDrive) / chassis.wheelRadius;
		engine.load = maxF > 0 ? Math.min(1, Math.abs(fc.engF) / maxF) : 0;

		this.telemetry = {
			rpm: engine.rpm,
			gear: gearbox.currentGear,
			displayGear: this.state.gear,
			throttle: engine.throttle,
			load: engine.load,
			boost: this.engineUnit.isTurbo ? this.boostCalc() : 0,
			speed: localVelX,
			isShifting: gearbox.isShifting,
			revLimited: engine.revLimited,
			isTurbo: this.engineUnit.isTurbo,
			grade: 0,
			clutchEngaged: !gearbox.isShifting,
		};
	}

	// ── Extracted update() sub-methods ──

	/** Route engine force to driven wheels based on drivetrain config. */
	private applyEngineForce(engForce: number): void {
		const negF = -engForce;
		const dt = this._config.drivetrain ?? "RWD";
		if (dt === "FWD") {
			this.vehicle.setWheelEngineForce(this.wheelFL, negF);
			this.vehicle.setWheelEngineForce(this.wheelFR, negF);
			this.vehicle.setWheelEngineForce(this.wheelRL, 0);
			this.vehicle.setWheelEngineForce(this.wheelRR, 0);
		} else if (dt === "AWD") {
			for (let i = 0; i < 4; i++) this.vehicle.setWheelEngineForce(i, negF);
		} else {
			// RWD
			this.vehicle.setWheelEngineForce(this.wheelFL, 0);
			this.vehicle.setWheelEngineForce(this.wheelFR, 0);
			this.vehicle.setWheelEngineForce(this.wheelRL, negF);
			this.vehicle.setWheelEngineForce(this.wheelRR, negF);
		}
	}

	/** Check wheels against road boundary; apply drag impulse for off-road wheels. */
	private applyOffRoadDrag(
		vx: number,
		vz: number,
		px: number,
		pz: number,
		heading: number,
		speedMs: number,
		dt: number,
	): number {
		let wheelsOffRoad = 0;
		const cfg = this.config.offRoad;
		if (!cfg || speedMs <= cfg.minSpeed) return 0;

		const cosH = Math.cos(heading);
		const sinH = Math.sin(heading);
		for (const lp of this._config.chassis.wheelPositions) {
			const wx = px + lp.x * cosH - lp.z * sinH;
			const wz = pz + lp.x * sinH + lp.z * cosH;
			const rb = this._terrain?.getRoadBoundary?.(wx, wz);
			if (rb && !rb.onRoad) wheelsOffRoad++;
		}

		const force = cfg.dragPerWheel * wheelsOffRoad * speedMs * speedMs;
		if (force > 0 && speedMs > 0.01) {
			const ix = -(vx / speedMs) * force * dt;
			const iz = -(vz / speedMs) * force * dt;
			this.carBody.applyImpulse({ x: ix, y: 0, z: iz }, true);
		}
		return force;
	}

	/** Set per-wheel side friction (grip falloff) and burnout traction slip. */
	private applyTireFriction(rearGripMul: number, rawLatG: number, bs: BurnoutStateResult): void {
		const latGripMul =
			rawLatG < LAT_GRIP_THRESHOLD
				? 1.0
				: 1.0 - LAT_GRIP_FALLOFF * Math.min(1, (rawLatG - LAT_GRIP_THRESHOLD) / LAT_GRIP_RANGE);

		this.vehicle.setWheelSideFrictionStiffness(this.wheelFL, WHEEL_SIDE_FRICTION * latGripMul);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelFR, WHEEL_SIDE_FRICTION * latGripMul);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelRL, WHEEL_SIDE_FRICTION * rearGripMul * latGripMul);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelRR, WHEEL_SIDE_FRICTION * rearGripMul * latGripMul);

		for (let i = 0; i < 4; i++) {
			const slip = bs.tractionMul[i] < 1 ? WHEEL_FRICTION_SLIP * bs.tractionMul[i] : WHEEL_FRICTION_SLIP;
			this.vehicle.setWheelFrictionSlip(i, slip);
		}
	}

	/** Apply handbrake rear brake override or normal rear brake force. */
	private applyHandbrakeBrakes(normalBrakeForce: number, isHandbrake: boolean): void {
		if (isHandbrake) {
			this.vehicle.setWheelBrake(this.wheelRL, 50.0);
			this.vehicle.setWheelBrake(this.wheelRR, 50.0);
		} else {
			this.vehicle.setWheelBrake(this.wheelRL, normalBrakeForce * 0.8);
			this.vehicle.setWheelBrake(this.wheelRR, normalBrakeForce * 0.8);
		}
	}

	/** Run physics substeps with weight transfer suspension. */
	private stepPhysics(
		dt: number,
		localVelX: number,
		fc: ReturnType<typeof computeForces>,
		chassis: ChassisSpec,
		bodyAngVel: { x: number; y: number; z: number },
	): void {
		const substepDt = dt / PHYSICS_SUBSTEPS;
		const trackWidth = Math.abs(chassis.wheelPositions[0].x - chassis.wheelPositions[1].x);
		const longAccel = Math.max(-12, Math.min(12, chassis.mass > 0 ? (fc.engF - fc.totalRetard) / chassis.mass : 0));
		const latAccel = Math.max(-12, Math.min(12, bodyAngVel.y * localVelX));

		for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
			this.vehicle.updateVehicle(substepDt);
			this.world.step();
			this.customSuspension.applyWeightTransfer(
				this.carBody,
				longAccel,
				latAccel,
				chassis.mass,
				chassis.cgHeight,
				chassis.wheelBase,
				trackWidth,
				substepDt,
			);
		}
	}

	/** Apply post-step forces: drift torque, yaw damping, rebuilds. */
	private applyPostStepForces(absSpeedMs: number, steerAngle: number, dt: number): void {
		this.tireDynamics.readWheelStates(this.vehicle);
		const yawRate = this.carBody.angvel().y;
		const driftTorque = this.tireDynamics.computeDriftYawTorque(absSpeedMs, yawRate, steerAngle);
		if (Math.abs(driftTorque) > 0.01) {
			this.carBody.applyTorqueImpulse({ x: 0, y: driftTorque * dt, z: 0 }, true);
		}
		this.tireDynState = this.tireDynamics.state;
	}

	/** Flush deferred terrain/guardrail rebuilds after physics step. */
	private flushPendingRebuilds(): void {
		if (this.pendingGroundRebuild) {
			this.rebuildGroundPatch(this.pendingGroundRebuild.x, this.pendingGroundRebuild.z);
			this.pendingGroundRebuild = null;
		}
		if (this.pendingGuardrailUpdate) {
			this.updateGuardrails(this.pendingGuardrailUpdate.x, this.pendingGuardrailUpdate.z);
			this.pendingGuardrailUpdate = null;
		}
	}

	private countContacts(): number {
		let c = 0;
		for (let i = 0; i < 4; i++) {
			if (this.vehicle.wheelIsInContact(i)) c++;
		}
		return c;
	}

	// ── Public getters ──

	getHeading(): number {
		const r = this.carBody.rotation();
		return Math.atan2(2 * (r.w * r.y + r.z * r.x), 1 - 2 * (r.y * r.y + r.x * r.x));
	}

	getPosition(): { x: number; y: number; z: number } {
		const p = this.carBody.translation();
		return { x: p.x, y: p.y, z: p.z };
	}

	getForward(): { x: number; y: number; z: number } {
		const h = this.getHeading();
		return { x: Math.sin(h), y: 0, z: Math.cos(h) };
	}

	/** Center of mass in world space (offset from body position) */
	getWorldCOM(): { x: number; y: number; z: number } {
		const com = this.carBody.localCom();
		const pos = this.carBody.translation();
		const r = this.carBody.rotation();
		// Rotate local COM offset by body quaternion
		const qx = 2 * (r.w * com.x + r.y * com.z - r.z * com.y);
		const qy = 2 * (r.w * com.y + r.z * com.x - r.x * com.z);
		const qz = 2 * (r.w * com.z + r.x * com.y - r.y * com.x);
		return { x: pos.x + qx, y: pos.y + qy, z: pos.z + qz };
	}

	getPitch(): number {
		return 0;
	}
	getRoll(): number {
		return 0;
	}
	getSteerAngle(): number {
		return this.steerAngle;
	}

	/** Per-wheel current suspension lengths from Rapier. null if wheel not grounded. */
	getSuspensionLengths(): (number | null)[] {
		return [0, 1, 2, 3].map((i) => this.vehicle.wheelSuspensionLength(i));
	}

	/**
	 * Per-wheel world positions at ground contact level.
	 * Uses full body quaternion (not just heading) and Rapier's suspension data.
	 * Falls back to anchor + suspension rest length if wheel is airborne.
	 */
	getWheelWorldPositions(): [number, number, number][] {
		const pos = this.carBody.translation();
		const rot = this.carBody.rotation();
		const chassis = this._config.chassis;

		// Full rotation matrix from quaternion
		const { x: qx, y: qy, z: qz, w: qw } = rot;
		const xx = qx * qx,
			yy = qy * qy,
			zz = qz * qz;
		const xy = qx * qy,
			xz = qx * qz,
			yz = qy * qz;
		const wx = qw * qx,
			wy = qw * qy,
			wz = qw * qz;

		return chassis.wheelPositions.map((lp) => {
			// Rotate local position by full quaternion
			const rx = lp.x * (1 - 2 * (yy + zz)) + lp.y * 2 * (xy - wz) + lp.z * 2 * (xz + wy);
			const ry = lp.x * 2 * (xy + wz) + lp.y * (1 - 2 * (xx + zz)) + lp.z * 2 * (yz - wx);
			const rz = lp.x * 2 * (xz - wy) + lp.y * 2 * (yz + wx) + lp.z * (1 - 2 * (xx + yy));

			return [pos.x + rx, pos.y + ry, pos.z + rz] as [number, number, number];
		});
	}

	/** Per-wheel spin angles (rad) for visual wheel rotation. */
	getWheelSpinAngles(): number[] {
		return this._wheelSpinAngles;
	}

	/**
	 * Aggregate slide intensity (0-1) for audio.
	 * Combines handbrake drift, hard cornering, and burnout into a single value.
	 * Only active above ~2 m/s to avoid static burnout screech.
	 */
	getSlideIntensity(): number {
		const speed = Math.abs(this.state.speed);
		if (speed < 2.0) return 0;

		const td = this.tireDynState;
		let intensity = 0;

		// Handbrake / drift
		if (td?.isDrifting) {
			intensity = Math.max(intensity, Math.min(1, td.driftFactor));
		}

		// Hard cornering (lateral G)
		const angVel = this.carBody.angvel();
		const latG = Math.abs(angVel.y * speed) / 9.81;
		if (latG > 0.3) {
			intensity = Math.max(intensity, Math.min(0.6, (latG - 0.3) * 0.5));
		}

		// Burnout
		if (this.burnoutActive) {
			intensity = Math.max(intensity, 0.5);
		}

		return intensity;
	}

	/**
	 * Update per-wheel spin angles based on drivetrain and handbrake state.
	 * Driven wheels follow engine output; undriven wheels free-roll at ground speed.
	 * Handbrake locks rear wheels with rapid deceleration.
	 */
	private updateWheelSpin(_fc: { engF: number }, dt: number, isHandbrake: boolean, bs: BurnoutStateResult): void {
		const wheelRadius = this._config.chassis.wheelRadius;
		const speed = this.state.speed;

		// Ground angular velocity (rad/s)
		const groundOmega = wheelRadius > 0 ? speed / wheelRadius : 0;

		// Deadzone: below this speed, snap to zero to prevent slow creep
		const deadzone = 0.05;

		for (let i = 0; i < 4; i++) {
			const isFront = i < 2;

			let targetOmega: number;

			if (isHandbrake && !isFront) {
				// Handbrake: rear wheels lock — rapid deceleration to zero
				targetOmega = 0;
				const lockBlend = 1 - Math.exp(-12.0 * dt); // locks in ~0.25s
				this._wheelSpinVels[i] *= 1 - lockBlend;
			} else if (bs.active && bs.overspin[i] > 1.0) {
				// Burnout: driven wheels overspin (spin faster than ground)
				const overspinOmega = Math.abs(groundOmega) * bs.overspin[i];
				targetOmega = overspinOmega;
				const blend = 1 - Math.exp(-20.0 * dt);
				this._wheelSpinVels[i] += (targetOmega - this._wheelSpinVels[i]) * blend;
			} else {
				// Both driven and undriven: target ground speed
				targetOmega = Math.abs(groundOmega) < deadzone ? 0 : groundOmega;
				// Quick blend — wheels respond fast to speed changes
				const blend = 1 - Math.exp(-15.0 * dt);
				this._wheelSpinVels[i] += (targetOmega - this._wheelSpinVels[i]) * blend;
			}

			// Kill residual spin when nearly stopped
			if (Math.abs(this._wheelSpinVels[i]) < deadzone && Math.abs(targetOmega) < deadzone) {
				this._wheelSpinVels[i] = 0;
			}

			this._wheelSpinAngles[i] += this._wheelSpinVels[i] * dt;
		}
	}

	/** Debug info for the ?debug overlay. */
	getDebugInfo(): Record<string, unknown> {
		const pos = this.carBody.translation();
		const vel = this.carBody.linvel();
		const av = this.carBody.angvel();
		const rot = this.carBody.rotation();
		const pitch = Math.atan2(2 * (rot.w * rot.x + rot.y * rot.z), 1 - 2 * (rot.x ** 2 + rot.y ** 2));
		const roll = Math.atan2(2 * (rot.w * rot.z + rot.x * rot.y), 1 - 2 * (rot.y ** 2 + rot.z ** 2));
		return buildDebugInfo({
			pos,
			vel,
			angvel: av,
			heading: this.getHeading(),
			pitch,
			roll,
			speed: this.state.speed,
			rpm: this.state.rpm,
			gear: this.state.gear,
			steerAngle: this.steerAngle,
			contacts: this.countContacts(),
			suspRestLength: this._config.chassis.suspensionRestLength,
			wheelRadius: this._config.chassis.wheelRadius,
			wheelY: -this._config.chassis.halfExtents[1] * 0.5,
			halfExtentsY: this._config.chassis.halfExtents[1],
			patchCenterX: this.terrainCollider?.patchCenterX,
			patchCenterZ: this.terrainCollider?.patchCenterZ,
			guardrailCount: this.guardrails?.bodyCount ?? 0,
			tireDynState: this.tireDynState,
			burnout: this.burnoutActive,
			revvingNeutral: this.revvingInNeutral,
			wheel: {
				wheelIsInContact: (i: number) => this.vehicle.wheelIsInContact(i),
				wheelSuspensionLength: (i: number) => this.vehicle.wheelSuspensionLength(i),
				wheelSuspensionRestLength: (i: number) => this.vehicle.wheelSuspensionRestLength(i),
				wheelSuspensionForce: (i: number) => this.vehicle.wheelSuspensionForce(i),
			},
		});
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.carBody.setTranslation({ x, y, z }, true);
		this.carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		this.carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		this.carBody.setRotation({ x: 0, y: Math.sin(rotation / 2), z: 0, w: Math.cos(rotation / 2) }, true);
		this.engineUnit.engine.rpm = this._config.engine.idleRPM;
		this.engineUnit.gearbox.currentGear = 0;
		this.engineUnit.gearbox.isShifting = false;
		this.simBoostNorm = 0;
		this.steerAngle = 0;
		this.state = {
			speed: 0,
			rpm: this._config.engine.idleRPM,
			gear: 1,
			steeringAngle: 0,
			throttle: 0,
			brake: 0,
			onGround: true,
		};
		this.telemetry = this.engineUnit.getTelemetry(0);
		this.customSuspension.reset();
		this.burnoutState.end();

		// Force immediate ground + guardrail rebuild at reset position
		if (this._terrain) {
			this.rebuildGroundPatch(x, z);
			this.updateGuardrails(x, z);
		}
	}

	private boostCalc(): number {
		const rf = Math.max(
			0,
			Math.min(
				1,
				(this.state.rpm - this._config.engine.idleRPM * 1.5) /
					(this._config.engine.maxRPM - this._config.engine.idleRPM * 1.5),
			),
		);
		const target = rf * this.state.throttle ** 0.8;
		this.simBoostNorm += (target - this.simBoostNorm) * (target > this.simBoostNorm ? 0.012 : 0.04);
		this.simBoostNorm = Math.max(0, Math.min(1, this.simBoostNorm));
		return this.simBoostNorm;
	}

	// ── Stub properties for practice.ts compatibility ──

	get audio(): null {
		return null;
	}
	get headlights(): null {
		return null;
	}
	get model(): null {
		return null;
	}
	get renderer(): null {
		return null;
	}
	get physicsBody(): RAPIER.RigidBody {
		return this.carBody;
	}
	get config(): CarConfig {
		return this._config;
	}
	get rapierWorld(): RAPIER.World {
		return this.world;
	}
	/** Terrain provider for height/boundary queries (null until setTerrain called) */
	get terrain(): TerrainProvider | null {
		return this._terrain;
	}

	initAudio(): void {}
	async loadModel(): Promise<null> {
		return null;
	}
	syncVisuals(): void {}
	dispose(): void {
		this.terrainCollider?.dispose();
		this.guardrails?.dispose();
	}
}
