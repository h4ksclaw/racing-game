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
import { EngineUnit } from "./engine/EngineUnit.ts";
import { Guardrails } from "./rapier-guardrails.ts";
import { TerrainCollider } from "./rapier-terrain-collider.ts";
import { Brakes } from "./suspension/Brakes.ts";
import type { EngineTelemetry, TerrainProvider, VehicleInput, VehicleState } from "./types.ts";

export type { TerrainProvider, VehicleInput } from "./types.ts";

// ── Vehicle controller tuning constants ──
const STEER_SPEED = 6.0;
const SUS_TRAVEL = 0.3;
const MAX_SUS_FORCE = 100000;
const WHEEL_FRICTION_SLIP = 2.0;
const WHEEL_SIDE_FRICTION = 2.5;
const ANGULAR_DAMPING = 5.0;
const PHYSICS_SUBSTEPS = 2;
const YAW_DAMP_RATE = 15.0;

// ── Real-world braking physics ──
// Tire-road friction coefficient (dry asphalt, performance tires)
const TIRE_MU = 0.85;
// Rolling resistance coefficient (performance tires on asphalt)
const CRR = 0.012;

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
	private _prevReverse = false;
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

		// Car body — high angular damping suppresses unwanted roll/pitch
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

		// Vehicle controller with 4 wheels
		this.vehicle = this.world.createVehicleController(this.carBody);
		const susRest = chassis.suspensionRestLength;
		const wl = halfW * 0.85;
		const wy = -halfH;
		const wheelOpts = [
			{ x: -wl, z: halfD * 0.7 },
			{ x: wl, z: halfD * 0.7 },
			{ x: -wl, z: -halfD * 0.7 },
			{ x: wl, z: -halfD * 0.7 },
		];
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

		// ── Drive state: Forward / Neutral / Reverse / Braking ──
		// W = forward throttle, S = brake (if moving forward) or reverse (if slow/stopped)
		// Nothing held = neutral coast (auto-stop via wheel brakes)
		const wantsForward = !!input.forward && !input.backward;
		const wantsBackward = !!input.backward && !input.forward;
		const BRAKE_HYSTERESIS = 0.3; // m/s — above this while holding S = braking

		let isBraking = false;
		let isReverse = false;
		const wantsNeutral = !wantsForward && !wantsBackward;
		if (wantsBackward) {
			if (localVelX > BRAKE_HYSTERESIS) {
				isBraking = true;
			} else {
				isReverse = true;
			}
		}

		engine.throttle = wantsForward ? 1 : isReverse ? 0.5 : 0;
		if (wantsNeutral) {
			gearbox.effectiveRatio = 0; // neutral = no gear ratio = no engine braking
		} else {
			gearbox.update(dt, engine, localVelX, isBraking);
		}
		engine.update(localVelX, gearbox.effectiveRatio, chassis.wheelRadius, dt);

		// ── Wheel brake force (Rapier native) ──
		let rapierBrakeForce = 0;
		let coastBodyBrakeN = 0; // body impulse for neutral coast deceleration
		let brakeBodyN = 0; // body impulse for active braking
		if (isBraking || input.handbrake) {
			rapierBrakeForce = input.handbrake ? 8.0 : 5.0;

			// Speed-dependent braking model (Pacejka-lite)
			// Peak tire grip occurs at moderate slip ratios. At very low speed,
			// tires approach lock-up — ABS-like modulation reduces peak slightly.
			// Weight transfer: front axle gains load under braking (front-biased).
			const absKmh = 5; // below this, ABS-like taper to prevent jerk
			const isHandbrake = !!input.handbrake;
			const baseMu = isHandbrake ? this._config.brakes.handbrakeG : this._config.brakes.maxBrakeG;

			// Weight transfer factor: at high decel, ~60/40 front/rear split
			// Effective mu is slightly less than baseMu due to load sensitivity
			// mu_eff ~ mu * (Fz / Fz0)^0.85 — since total Fz doesn't change,
			// but distribution does. We use an average: front gets more, rear less.
			// Net effect: ~5% reduction from ideal for the average axle.
			const loadSensitivityFactor = 0.95;

			// Speed-dependent grip: tires have slightly less grip at very low speed
			// due to reduced aero downforce and thermal effects (minor for street cars)
			// But more importantly: at very low speed, the ratio of brake torque
			// to vehicle KE is high, so small changes feel large.
			const speedKmh = Math.abs(localVelX) * 3.6;
			const lowSpeedFactor =
				speedKmh < absKmh
					? 0.6 + 0.4 * (speedKmh / absKmh) // taper from 0.6g to 1.0g
					: 1.0;

			// High-speed aero effect: slight downforce increase at speed helps braking
			const highSpeedFactor =
				speedKmh > 100
					? 1.0 + 0.1 * Math.min(1.0, (speedKmh - 100) / 100) // up to +10% at 200 km/h
					: 1.0;

			brakeBodyN = baseMu * loadSensitivityFactor * lowSpeedFactor * highSpeedFactor * chassis.mass * 9.81;
		} else if (!wantsForward && !wantsBackward && localVelX > 0.1) {
			// Neutral coast (forward only): moderate body impulse for auto creep-stop
			const speedFactor = Math.min(1.0, localVelX / 5.0);
			coastBodyBrakeN = 0.3 * chassis.mass * 9.81 * speedFactor;
		}

		// Brake lights: ONLY active braking (S while moving forward, handbrake)
		this.brakes.isBraking = isBraking;
		this.brakes.isHandbrake = !!input.handbrake;
		this.brakes.brakePressure = isBraking || input.handbrake ? 1 : 0;

		// ── Engine force → rear wheels ──
		const tractionPerWheel = (chassis.mass * tires.tractionPct * 9.82) / 2;
		let engF = 0;
		if (wantsForward) {
			engF = engine.getWheelForce(gearbox.effectiveRatio, chassis.wheelRadius, tractionPerWheel);
			if (gearbox.isShifting) engF *= 0.3;
		} else if (isReverse) {
			// Reverse: 1st gear ratio * final drive, reduced for realistic feel
			const firstGearRatio = this._config.gearbox.gearRatios[0] || 3.5;
			const reverseRatio = engineSpec.finalDrive * firstGearRatio;
			engF = -(engineSpec.torqueNm * 0.3 * reverseRatio * engine.getTorqueMultiplier()) / chassis.wheelRadius;
			engF = Math.max(engF, -tractionPerWheel * 0.6);
		}
		// else: neutral — engF stays 0

		// Negate because Rapier's rolling direction = -Z, our car faces +Z
		this.vehicle.setWheelEngineForce(this.wheelRL, -engF);
		this.vehicle.setWheelEngineForce(this.wheelRR, -engF);

		// ── Apply wheel brakes (all 4, front-biased) ──
		this.vehicle.setWheelBrake(this.wheelFL, rapierBrakeForce * 1.2);
		this.vehicle.setWheelBrake(this.wheelFR, rapierBrakeForce * 1.2);
		this.vehicle.setWheelBrake(this.wheelRL, rapierBrakeForce * 0.8);
		this.vehicle.setWheelBrake(this.wheelRR, rapierBrakeForce * 0.8);

		// ── Rolling + aero drag as light body impulse (NEVER during reverse) ──
		let totalRetard = 0;
		let debugRolling = 0;
		let debugAero = 0;
		let debugEngineBrake = 0;
		if (!isReverse && !wantsBackward) {
			debugRolling = CRR * chassis.mass * 9.81 * 0.5;
			debugAero = this.drag.config.aeroDrag * localVelX * localVelX;
			debugEngineBrake =
				localVelX > 0.1
					? (engine.config.engineBraking *
							engineSpec.torqueNm *
							gearbox.effectiveRatio *
							(engine.rpm / engine.config.maxRPM)) /
						chassis.wheelRadius
					: 0;
			totalRetard = debugEngineBrake + debugRolling + debugAero + coastBodyBrakeN + brakeBodyN;
			totalRetard = Math.min(totalRetard, TIRE_MU * chassis.mass * 9.81);
		}
		if (totalRetard > 0 && Math.abs(localVelX) > 0.01) {
			const fx = -totalRetard * Math.sin(heading) * Math.sign(localVelX);
			const fz = -totalRetard * Math.cos(heading) * Math.sign(localVelX);
			this.carBody.applyImpulse({ x: fx * dt, y: 0, z: fz * dt }, true);
		}

		// Record forces for debug visualization (positive = forward, negative = backward)
		const fsign = localVelX >= 0 ? 1 : -1;
		this.forces.engine = engF * fsign;
		this.forces.brake = brakeBodyN * -fsign;
		this.forces.wheelBrake = rapierBrakeForce > 0 ? -rapierBrakeForce * 500 * fsign : 0;
		this.forces.rolling = -debugRolling * fsign;
		this.forces.aero = -debugAero * fsign;
		this.forces.engineBrake = -debugEngineBrake * fsign;
		this.forces.coast = -coastBodyBrakeN * fsign;
		this.forces.total =
			this.forces.engine +
			this.forces.brake +
			this.forces.wheelBrake +
			this.forces.rolling +
			this.forces.aero +
			this.forces.engineBrake +
			this.forces.coast;

		// DIAG
		if (!this._diagTimer) this._diagTimer = 0;
		this._diagTimer += dt * 1000;
		if (this._diagTimer >= 200) {
			this._diagTimer = 0;
			if (wantsBackward || this._prevReverse) {
				console.log(
					`[DRIVE] vel=${localVelX.toFixed(3)} state=${isReverse ? "REV" : isBraking ? "BRK" : wantsForward ? "FWD" : "---"} ` +
						`engF=${engF.toFixed(0)}N wheelBrk=${rapierBrakeForce.toFixed(1)} bodyRetard=${totalRetard.toFixed(0)}N`,
				);
			}
		}
		this._prevReverse = isReverse;

		// ── Steering → front wheels ──
		this.vehicle.setWheelSteering(this.wheelFL, this.steerAngle);
		this.vehicle.setWheelSteering(this.wheelFR, this.steerAngle);

		// ── Step physics (substeps for stability) ──
		const substepDt = dt / PHYSICS_SUBSTEPS;
		for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
			this.vehicle.updateVehicle(substepDt);
			this.world.step();
		}

		// ── Post-step rebuilds (safe after step) ──
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

		// ── Output state ──
		this.state.speed = localVelX;
		this.state.rpm = engine.rpm;
		this.state.gear = isReverse ? -1 : wantsForward || wantsBackward ? gearbox.currentGear + 1 : 0;
		this.state.throttle = engine.throttle;
		this.state.brake = this.brakes.brakePressure;
		this.state.onGround = this.countContacts() > 0;

		const maxF = (engineSpec.torqueNm * gearbox.effectiveRatio * engineSpec.finalDrive) / chassis.wheelRadius;
		engine.load = maxF > 0 ? Math.min(1, Math.abs(engF) / maxF) : 0;

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

	getPitch(): number {
		return 0;
	}
	getRoll(): number {
		return 0;
	}
	getSteerAngle(): number {
		return this.steerAngle;
	}

	/** Debug info for the ?debug overlay. */
	getDebugInfo(): Record<string, unknown> {
		const pos = this.carBody.translation();
		const vel = this.carBody.linvel();
		const av = this.carBody.angvel();
		const contacts = this.countContacts();
		const wheelData: string[] = [];
		for (let i = 0; i < 4; i++) {
			wheelData.push(this.vehicle.wheelIsInContact(i) ? "●" : "○");
		}
		return {
			pos: `${pos.x.toFixed(1)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(1)}`,
			vel: `${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}`,
			angvel: `${av.x.toFixed(3)}, ${av.y.toFixed(3)}, ${av.z.toFixed(3)}`,
			heading: `${((this.getHeading() * 180) / Math.PI).toFixed(1)}°`,
			speed: this.state.speed.toFixed(1),
			speedKmh: `${(Math.abs(this.state.speed) * 3.6).toFixed(0)}`,
			rpm: this.state.rpm.toFixed(0),
			gear: this.state.gear,
			steer: `${((this.steerAngle * 180) / Math.PI).toFixed(1)}°`,
			contacts: `${contacts}/4 [${wheelData.join(" ")}]`,
			suspRest: this._config.chassis.suspensionRestLength,
			wheelRadius: this._config.chassis.wheelRadius,
			wheelY: -this._config.chassis.halfExtents[1] * 0.5,
			patchCenter: `${this.terrainCollider?.patchCenterX.toFixed(0) ?? "?"}, ${this.terrainCollider?.patchCenterZ.toFixed(0) ?? "?"}`,
			guardrails: this.guardrails?.bodyCount ?? 0,
		};
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
