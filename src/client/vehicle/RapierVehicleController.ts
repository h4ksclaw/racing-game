/**
 * RapierVehicleController — full physics replacement using Rapier3D.
 *
 * Replaces custom VehiclePhysics with Rapier's built-in:
 *   - DynamicRayCastVehicleController (suspension, tire friction, steering)
 *   - Rigid body dynamics (3D forces, inertia, collision)
 *   - Built-in collision detection (walls, guardrails, car-vs-car)
 *
 * Keeps our game-feel modules:
 *   - EngineUnit (RPM, torque curves, rev limiter, turbo)
 *   - Gearbox (auto-shift, shift timing)
 *   - Brakes (brake + handbrake model)
 *   - DragModel (aero + rolling resistance)
 *
 * Coordinate convention matches Rapier: Y-up, Z-forward.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import { DragModel } from "./aero/DragModel.ts";
import type { CarConfig } from "./configs.ts";
import { EngineUnit } from "./engine/EngineUnit.ts";
import { Brakes } from "./suspension/Brakes.ts";
import type { EngineTelemetry, TerrainProvider, VehicleInput, VehicleState } from "./types.ts";

export type { TerrainProvider, VehicleInput } from "./types.ts";

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
	private groundBody: RAPIER.RigidBody | null = null;
	private lastGroundX = Number.POSITIVE_INFINITY;
	private lastGroundZ = Number.POSITIVE_INFINITY;
	private readonly GROUND_SIZE = 100; // meters per side
	private readonly GROUND_RESAMPLE_DIST = 5; // rebuild when car moves this far
	private guardrailBodies: RAPIER.RigidBody[] = [];
	private lastGuardrailHash = "";

	state: VehicleState;
	telemetry: EngineTelemetry;
	private simBoostNorm = 0;
	private steerAngle = 0;
	private readonly STEER_SPEED = 4.0;
	private initialized = false;

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

		// Car body
		this.carBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0).setLinearDamping(0.05).setAngularDamping(0.8),
		);
		this.world.createCollider(
			RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD)
				.setDensity(mass / (halfW * 2 * halfH * 2 * halfD * 2))
				.setFriction(0.0)
				.setRestitution(0.1),
			this.carBody,
		);
		// Low ballast for stable COM
		this.world.createCollider(
			RAPIER.ColliderDesc.cuboid(halfW * 0.7, 0.1, halfD * 0.7)
				.setDensity((mass * 0.5) / (halfW * 1.4 * 0.2 * halfD * 1.4))
				.setTranslation(0, -halfH - 0.05, 0)
				.setFriction(0.0),
			this.carBody,
		);

		// Vehicle controller
		this.vehicle = this.world.createVehicleController(this.carBody);
		const susRest = chassis.suspensionRestLength;
		const susTravel = 0.3;
		const wl = halfW * 0.85;
		const wy = -halfH * 0.5;
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
				{ x: -1, y: 0, z: 0 },
				susRest,
				wheelRadius,
			);
		}

		for (let i = 0; i < 4; i++) {
			this.vehicle.setWheelSuspensionStiffness(i, chassis.suspensionStiffness);
			this.vehicle.setWheelSuspensionCompression(i, chassis.dampingCompression);
			this.vehicle.setWheelSuspensionRelaxation(i, chassis.dampingRelaxation);
			this.vehicle.setWheelMaxSuspensionTravel(i, susTravel);
			this.vehicle.setWheelMaxSuspensionForce(i, 100000);
			this.vehicle.setWheelFrictionSlip(i, 3.0);
			this.vehicle.setWheelSideFrictionStiffness(i, 4.0);
		}

		this.rebuildGroundPatch(0, 0);
	}

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
		if (this.initialized) {
			const p = this.carBody.translation();
			this.rebuildGroundPatch(p.x, p.z);
		}
	}

	private rebuildGroundPatch(cx: number, cz: number): void {
		if (this.groundBody) {
			this.world.removeRigidBody(this.groundBody);
			this.groundBody = null;
		}
		if (!this.terrain) return;

		// Use a flat cuboid positioned at the terrain height under the car.
		// This is simple and works for relatively flat terrain.
		// The car drives on the road, so getHeight returns the road height.
		const h = this.terrain.getHeight(cx, cz);
		const half = this.GROUND_SIZE / 2;

		this.groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, h - 0.5, cz));
		this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.5, half).setFriction(0.8), this.groundBody);

		this.lastGroundX = cx;
		this.lastGroundZ = cz;
	}

	private updateGuardrails(cx: number, cz: number): void {
		if (!this.terrain?.getRoadBoundary) return;
		const rb = this.terrain.getRoadBoundary(cx, cz);
		if (!rb) return;

		const segs: Array<{ p1: { x: number; y: number; z: number }; p2: { x: number; y: number; z: number } }> = [];
		if (rb.prevGrassLeft && rb.grassLeft) segs.push({ p1: rb.prevGrassLeft, p2: rb.grassLeft });
		if (rb.prevGrassRight && rb.grassRight) segs.push({ p1: rb.prevGrassRight, p2: rb.grassRight });
		if (rb.nextGrassLeft && rb.grassLeft) segs.push({ p1: rb.grassLeft, p2: rb.nextGrassLeft });
		if (rb.nextGrassRight && rb.grassRight) segs.push({ p1: rb.grassRight, p2: rb.nextGrassRight });

		const hash = segs
			.map((s) => `${s.p1.x.toFixed(1)},${s.p1.z.toFixed(1)}-${s.p2.x.toFixed(1)},${s.p2.z.toFixed(1)}`)
			.join("|");
		if (hash === this.lastGuardrailHash) return;
		this.lastGuardrailHash = hash;

		for (const b of this.guardrailBodies) this.world.removeRigidBody(b);
		this.guardrailBodies = [];

		for (const seg of segs) {
			const mx = (seg.p1.x + seg.p2.x) / 2;
			const my = (seg.p1.y + seg.p2.y) / 2 + 0.4;
			const mz = (seg.p1.z + seg.p2.z) / 2;
			const hl = Math.sqrt((seg.p2.x - seg.p1.x) ** 2 + (seg.p2.z - seg.p1.z) ** 2) / 2;
			if (hl < 0.1) continue;
			const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(mx, my, mz));
			const angle = Math.atan2(seg.p2.x - seg.p1.x, seg.p2.z - seg.p1.z);
			body.setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }, true);
			this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 0.5, hl).setFriction(0.3).setRestitution(0.2), body);
			this.guardrailBodies.push(body);
		}
	}

	update(input: VehicleInput, delta: number): void {
		if (!this.initialized) return;
		const dt = Math.min(delta, 1 / 30);
		const { chassis, engine: engineSpec, tires } = this._config;
		const engine = this.engineUnit.engine;
		const gearbox = this.engineUnit.gearbox;

		// 1. Steering
		const vel = this.carBody.linvel();
		const speedKmh = Math.sqrt(vel.x ** 2 + vel.z ** 2) * 3.6;
		const speedRed = Math.max(0.15, 1 - (speedKmh / 140) ** 1.5);
		const targetSteer = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * chassis.maxSteerAngle * speedRed;
		const maxD = this.STEER_SPEED * dt;
		const sd = targetSteer - this.steerAngle;
		this.steerAngle = Math.abs(sd) < maxD ? targetSteer : this.steerAngle + Math.sign(sd) * maxD;
		this.state.steeringAngle = this.steerAngle;

		// 2. Engine + gearbox
		const heading = this.getHeading();
		const localVelX = vel.z * Math.cos(heading) + vel.x * Math.sin(heading);
		const isReverse = !!input.backward && !input.forward && localVelX < 1.0;
		engine.throttle = input.forward ? 1 : isReverse ? 0.5 : 0;
		gearbox.update(dt, engine, localVelX, false);
		engine.update(localVelX, gearbox.effectiveRatio, chassis.wheelRadius, dt);

		// 3. Brakes
		this.brakes.isBraking = !!input.backward && !input.forward && localVelX > 0.1;
		this.brakes.isHandbrake = !!input.handbrake;
		const brakeF = this.brakes.getForce(chassis.mass);

		// 4. Engine force → rear wheels
		let engF = engine.getWheelForce(
			gearbox.effectiveRatio,
			chassis.wheelRadius,
			chassis.mass * tires.tractionPct * 9.82,
		);
		if (gearbox.isShifting) engF *= 0.3;
		if (isReverse) engF = -engineSpec.torqueNm * 0.4;
		const rEngF = engF * 5;
		this.vehicle.setWheelEngineForce(this.wheelRL, rEngF);
		this.vehicle.setWheelEngineForce(this.wheelRR, rEngF);

		// 5. Brake force → all wheels
		const handF = input.handbrake ? 150 : 0;
		for (let i = 0; i < 4; i++) this.vehicle.setWheelBrake(i, brakeF * 2 + handF);

		// 6. Steering → front wheels
		this.vehicle.setWheelSteering(this.wheelFL, this.steerAngle);
		this.vehicle.setWheelSteering(this.wheelFR, this.steerAngle);

		// 7. Aero drag
		const dragF = -this.drag.getForce(localVelX);
		this.carBody.addForce({ x: dragF * Math.sin(heading), y: 0, z: dragF * Math.cos(heading) }, true);

		// 8. Step physics
		this.vehicle.updateVehicle(dt);
		this.world.step();

		// 9. Kill roll/pitch — keep only yaw
		const r = this.carBody.rotation();
		const yaw = Math.atan2(2 * (r.w * r.y + r.z * r.x), 1 - 2 * (r.y * r.y + r.x * r.x));
		this.carBody.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
		const av = this.carBody.angvel();
		this.carBody.setAngvel({ x: 0, y: av.y, z: 0 }, true);

		// 10. Follow car with ground (only rebuild when moved far enough)
		const np = this.carBody.translation();
		const dx = np.x - this.lastGroundX;
		const dz = np.z - this.lastGroundZ;
		if (dx * dx + dz * dz > this.GROUND_RESAMPLE_DIST * this.GROUND_RESAMPLE_DIST) {
			this.rebuildGroundPatch(np.x, np.z);
		}
		this.updateGuardrails(np.x, np.z);

		// 11. Output state
		const nv = this.carBody.linvel();
		const nlv = nv.z * Math.cos(this.getHeading()) + nv.x * Math.sin(this.getHeading());
		this.state.speed = nlv;
		this.state.rpm = engine.rpm;
		this.state.gear = isReverse && nlv < -0.1 ? -1 : gearbox.currentGear + 1;
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
			speed: nlv,
			isShifting: gearbox.isShifting,
			revLimited: engine.revLimited,
			isTurbo: this.engineUnit.isTurbo,
			grade: 0,
			clutchEngaged: !gearbox.isShifting,
		};
	}

	private countContacts(): number {
		let c = 0;
		for (let i = 0; i < 4; i++) if (this.vehicle.wheelIsInContact(i)) c++;
		return c;
	}

	getHeading(): number {
		const r = this.carBody.rotation();
		return Math.atan2(2 * (r.w * r.y + r.z * r.x), 1 - 2 * (r.y * r.y + r.x * r.x));
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
		if (this.terrain) this.rebuildGroundPatch(x, z);
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
	get config(): CarConfig {
		return this._config;
	}
	initAudio(): void {}
	async loadModel(): Promise<null> {
		return null;
	}
	syncVisuals(): void {}
	dispose(): void {}
}
