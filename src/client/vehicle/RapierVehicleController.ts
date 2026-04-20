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
import type { CarConfig } from "./configs.ts";
import { buildDebugInfo } from "./DebugInfoBuilder.ts";
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
const STEER_SPEED = 3.5;
const SUS_TRAVEL = 0.3;
const MAX_SUS_FORCE = 100000;
const WHEEL_FRICTION_SLIP = 2.0;
const WHEEL_SIDE_FRICTION = 2.5;
const ANGULAR_DAMPING = 1.0;
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

	private terrain: TerrainProvider | null = null;
	private terrainCollider: TerrainCollider | null = null;
	private guardrails: Guardrails | null = null;
	get guardrailBodies(): readonly RAPIER.RigidBody[] {
		return this.guardrails?.bodyList ?? [];
	}

	// Deferred rebuilds (applied AFTER world.step() to avoid WASM aliasing)
	private pendingGroundRebuild: { x: number; z: number } | null = null;
	private pendingGuardrailUpdate: { x: number; z: number } | null = null;

	state: VehicleState;
	telemetry: EngineTelemetry;
	private simBoostNorm = 0;
	private steerAngle = 0;
	private initialized = false;
	private _diagTimer = 0; // throttle diagnostic log output
	private readonly driveState = new DriveState();
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
		total: number;
	} = {
		engine: 0,
		brake: 0,
		wheelBrake: 0,
		rolling: 0,
		aero: 0,
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
			this.vehicle.setWheelMaxSuspensionTravel(i, SUS_TRAVEL);
			this.vehicle.setWheelMaxSuspensionForce(i, MAX_SUS_FORCE);
			this.vehicle.setWheelFrictionSlip(i, WHEEL_FRICTION_SLIP);
			this.vehicle.setWheelSideFrictionStiffness(i, WHEEL_SIDE_FRICTION);
		}

		this.rebuildGroundPatch(0, 0);
	}

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
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

		engine.throttle = wantsForward && !input.handbrake ? 1 : isReverse ? 0.5 : 0;
		// Handbrake forces gearbox to neutral — no engine drive, no engine braking
		const effectiveNeutral = dsNeutral || !!input.handbrake;
		if (effectiveNeutral) {
			gearbox.effectiveRatio = 0; // neutral = no gear ratio = no engine braking
		} else if (isReverse) {
			// During reverse, set a proper gear ratio so engine RPM stays in
			// the torque curve's power band (above 1100 RPM where mult = 1.0).
			// Without this, effectiveRatio=0 (from prior neutral) causes RPM
			// to drop to idle where the torque multiplier is only 0.3.
			const firstGearRatio = this._config.gearbox.gearRatios[0] || 3.5;
			gearbox.effectiveRatio = engineSpec.finalDrive * firstGearRatio;
		} else {
			gearbox.update(dt, engine, localVelX, isBraking);
		}
		engine.update(localVelX, gearbox.effectiveRatio, chassis.wheelRadius, dt);

		// ── Brake lights ──
		this.brakes.isBraking = isBraking;
		this.brakes.isHandbrake = !!input.handbrake;
		this.brakes.brakePressure = isBraking || input.handbrake ? 1 : 0;

		// ── Force computation ──
		const tractionPerWheel = (chassis.mass * tires.tractionPct * 9.82) / 2;
		const absSpeedMs = Math.abs(localVelX);
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

		// Apply engine force to driven wheels based on drivetrain config
		const drivetrain = this._config.drivetrain ?? "RWD";
		const engForce = -fc.engF;
		if (drivetrain === "FWD") {
			this.vehicle.setWheelEngineForce(this.wheelFL, engForce);
			this.vehicle.setWheelEngineForce(this.wheelFR, engForce);
			this.vehicle.setWheelEngineForce(this.wheelRL, 0);
			this.vehicle.setWheelEngineForce(this.wheelRR, 0);
		} else if (drivetrain === "AWD") {
			this.vehicle.setWheelEngineForce(this.wheelFL, engForce);
			this.vehicle.setWheelEngineForce(this.wheelFR, engForce);
			this.vehicle.setWheelEngineForce(this.wheelRL, engForce);
			this.vehicle.setWheelEngineForce(this.wheelRR, engForce);
		} else {
			// RWD
			this.vehicle.setWheelEngineForce(this.wheelFL, 0);
			this.vehicle.setWheelEngineForce(this.wheelFR, 0);
			this.vehicle.setWheelEngineForce(this.wheelRL, engForce);
			this.vehicle.setWheelEngineForce(this.wheelRR, engForce);
		}

		// ── Apply wheel brakes (front-biased for normal braking) ──
		this.vehicle.setWheelBrake(this.wheelFL, fc.rapierBrakeForce * 1.2);
		this.vehicle.setWheelBrake(this.wheelFR, fc.rapierBrakeForce * 1.2);

		// ── Apply body retard impulse ──
		if (fc.retardFx !== 0 || fc.retardFz !== 0) {
			this.carBody.applyImpulse({ x: fc.retardFx, y: 0, z: fc.retardFz }, true);
		}

		// ── Off-road drag ──
		// Check each wheel's world position against road boundary.
		// Wheels off the road surface create extra drag (grass/gravel resistance).
		let wheelsOffRoad = 0;
		const OFF_ROAD_DRAG_BASE = 3.0;
		const rb = this.terrain?.getRoadBoundary?.(pos.x, pos.z);
		if (rb && speedMs > 0.5) {
			// Compute wheel world positions from body transform + local offsets
			const cosH = Math.cos(heading);
			const sinH = Math.sin(heading);
			for (let i = 0; i < 4; i++) {
				const lp = chassis.wheelPositions[i];
				const wx = pos.x + lp.x * cosH - lp.z * sinH;
				const wz = pos.z + lp.x * sinH + lp.z * cosH;
				const wRb = this.terrain?.getRoadBoundary?.(wx, wz);
				if (wRb && !wRb.onRoad) wheelsOffRoad++;
			}
		}
		const offRoadDragCoeff = wheelsOffRoad > 0 ? OFF_ROAD_DRAG_BASE * (wheelsOffRoad / 4) : 0;
		if (offRoadDragCoeff > 0) {
			// Drag proportional to speed², scaled by how many wheels are off-road
			// Typical: 1 wheel off = mild, 2+ = significant. Capped so it slows but doesn't stop instantly.
			const dragForce = offRoadDragCoeff * speedMs * speedMs * chassis.mass;
			// Apply opposing velocity direction
			if (speedMs > 0.1) {
				const dragImpulseX = -(vx / speedMs) * dragForce * dt;
				const dragImpulseZ = -(vz / speedMs) * dragForce * dt;
				this.carBody.applyImpulse({ x: dragImpulseX, y: 0, z: dragImpulseZ }, true);
			}
		}

		// Record forces for debug visualization
		this.forces.engine = fc.engF;
		this.forces.brake = fc.forcesDebug.brake;
		this.forces.wheelBrake = fc.forcesDebug.wheelBrake;
		this.forces.rolling = fc.forcesDebug.rolling;
		this.forces.aero = fc.forcesDebug.aero;
		this.forces.engineBrake = fc.forcesDebug.engineBrake;
		this.forces.coast = fc.forcesDebug.coast;
		this.forces.total =
			this.forces.engine +
			this.forces.brake +
			this.forces.wheelBrake +
			this.forces.rolling +
			this.forces.aero +
			this.forces.engineBrake +
			this.forces.coast +
			(wheelsOffRoad > 0 ? offRoadDragCoeff * speedMs * speedMs * chassis.mass : 0);

		// DIAG
		if (!this._diagTimer) this._diagTimer = 0;
		this._diagTimer += dt * 1000;
		if (this._diagTimer >= 200) {
			this._diagTimer = 0;
			if (wantsBackward || isReverse) {
				console.log(
					`[DRIVE] vel=${localVelX.toFixed(3)} state=${isReverse ? "REV" : isBraking ? "BRK" : wantsForward ? "FWD" : "---"} ` +
						`engF=${fc.engF.toFixed(0)}N wheelBrk=${fc.rapierBrakeForce.toFixed(1)} bodyRetard=${fc.totalRetard.toFixed(0)}N trac=${tractionPerWheel.toFixed(0)} contacts=${this.countContacts()}`,
				);
			}
		}
		// prevReverse is tracked inside DriveState

		// ── Steering → front wheels ──
		this.vehicle.setWheelSteering(this.wheelFL, this.steerAngle);
		this.vehicle.setWheelSteering(this.wheelFR, this.steerAngle);

		// ── Tire dynamics: handbrake → rear grip reduction ──
		// WHY: Rapier's native friction model can't distinguish locked vs rolling wheels.
		// By reducing rear side friction stiffness before the step, locked rear wheels
		// slide sideways with less resistance — creating the drift effect.
		// Update handbrake state (ramps grip up/down smoothly)
		const rearGripMul = this.tireDynamics.updateHandbrake(!!input.handbrake, absSpeedMs, dt);

		// Apply per-wheel side friction: rear wheels get reduced grip during handbrake
		// Front wheels always keep full grip for directional stability
		const baseSideFriction = WHEEL_SIDE_FRICTION;
		this.vehicle.setWheelSideFrictionStiffness(this.wheelFL, baseSideFriction);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelFR, baseSideFriction);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelRL, baseSideFriction * rearGripMul);
		this.vehicle.setWheelSideFrictionStiffness(this.wheelRR, baseSideFriction * rearGripMul);

		// Handbrake also applies Rapier brake to rear wheels only (longitudinal lock)
		if (input.handbrake) {
			this.vehicle.setWheelBrake(this.wheelRL, 50.0);
			this.vehicle.setWheelBrake(this.wheelRR, 50.0);
		} else {
			this.vehicle.setWheelBrake(this.wheelRL, fc.rapierBrakeForce * 0.8);
			this.vehicle.setWheelBrake(this.wheelRR, fc.rapierBrakeForce * 0.8);
		}

		// ── Step physics (substeps for stability) ──
		const substepDt = dt / PHYSICS_SUBSTEPS;

		// Compute accelerations for weight transfer suspension
		const trackWidth = Math.abs(chassis.wheelPositions[0].x - chassis.wheelPositions[1].x);
		// Longitudinal accel: rate of change of forward speed (approximated from forces)
		// Clamp to realistic range — beyond ~1.2g the tires would have lost grip anyway
		const longAccel = Math.max(-12, Math.min(12, chassis.mass > 0 ? (fc.engF - fc.totalRetard) / chassis.mass : 0));
		// Lateral accel from yaw rate × forward speed (use local angVel.y)
		const bodyAngVel = this.carBody.angvel();
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

		// ── Post-step tire dynamics ──
		// WHY: Forces that depend on contact state must be applied AFTER step()
		// because Rapier resolves contacts during step() — pre-step would use stale data.
		this.tireDynamics.readWheelStates(this.vehicle);

		// Read current yaw rate from body angular velocity
		const yawRate = bodyAngVel.y;

		// Compute drift yaw torque: when rear grip is reduced, front lateral
		// forces create a net yaw moment → the car rotates (oversteer)
		const driftTorque = this.tireDynamics.computeDriftYawTorque(absSpeedMs, yawRate, this.steerAngle);
		if (Math.abs(driftTorque) > 0.01) {
			// Apply as torque impulse: τ = I * α, applied over dt
			this.carBody.applyTorqueImpulse({ x: 0, y: driftTorque * dt, z: 0 }, true);
		}

		// Store tire dynamics state for debug/telemetry
		this.tireDynState = this.tireDynamics.state;

		// ── Post-step world rebuilds ──
		// WHY: Rapier forbids modifying the physics world during step().
		// Terrain trimesh patches and guardrail cuboids are rebuilt here
		// when the car moves to a new region.
		if (this.pendingGroundRebuild) {
			this.rebuildGroundPatch(this.pendingGroundRebuild.x, this.pendingGroundRebuild.z);
			this.pendingGroundRebuild = null;
		}
		if (this.pendingGuardrailUpdate) {
			this.updateGuardrails(this.pendingGuardrailUpdate.x, this.pendingGuardrailUpdate.z);
			this.pendingGuardrailUpdate = null;
		}

		// Suppress micro-yaw from tire solver noise when not steering
		if (Math.abs(this.steerAngle) < 0.01) {
			const av = this.carBody.angvel();
			const yawDamp = Math.exp(-YAW_DAMP_RATE * dt);
			this.carBody.setAngvel({ x: av.x, y: av.y * yawDamp, z: av.z }, true);
		}

		// ── Update per-wheel spin angles ──
		this.updateWheelSpin(fc, dt, !!input.handbrake);

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

	/** Per-wheel spin angles (rad) for visual wheel rotation. */
	getWheelSpinAngles(): number[] {
		return this._wheelSpinAngles;
	}

	/**
	 * Update per-wheel spin angles based on drivetrain and handbrake state.
	 * Driven wheels follow engine output; undriven wheels free-roll at ground speed.
	 * Handbrake locks rear wheels with rapid deceleration.
	 */
	private updateWheelSpin(_fc: { engF: number }, dt: number, isHandbrake: boolean): void {
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

		// Force immediate ground + guardrail rebuild at reset position
		if (this.terrain) {
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
