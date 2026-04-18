/**
 * RapierVehicleController — full physics replacement using Rapier3D.
 *
 * Replaces custom VehiclePhysics with Rapier's built-in:
 *   - DynamicRayCastVehicleController (suspension, tire friction, steering)
 *   - Rigid body dynamics (3D forces, inertia, collision)
 *   - Built-in collision detection (walls, guardrails, car-vs-car)
 *
 * Terrain collision uses a local trimesh patch sampled from TerrainProvider.getHeight().
 * The patch is a grid of triangles centered on the car, rebuilt when the car moves
 * far enough from the patch center. This gives smooth, seam-free driving over
 * the actual terrain geometry — no flat cuboids or height discontinuities.
 *
 * Keeps our game-feel modules:
 *   - EngineUnit (RPM, torque curves, rev limiter, turbo)
 *   - Gearbox (auto-shift, shift timing)
 *   - Brakes (brake + handbrake model)
 *
 * Coordinate convention matches Rapier: Y-up, Z-forward.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import type { CarConfig } from "./configs.ts";
import { EngineUnit } from "./engine/EngineUnit.ts";
import { Brakes } from "./suspension/Brakes.ts";
import type { EngineTelemetry, TerrainProvider, VehicleInput, VehicleState } from "./types.ts";

export type { TerrainProvider, VehicleInput } from "./types.ts";

/**
 * Build a trimesh from a terrain grid.
 * Creates a (cols+1)×(rows+1) vertex grid over [minX..maxX] × [minZ..maxZ],
 * samples getHeight at each vertex, then triangulates into two triangles per cell.
 */
function buildTerrainTrimesh(
	terrain: TerrainProvider,
	centerX: number,
	centerZ: number,
	size: number,
	resolution: number,
): { vertices: Float32Array; indices: Uint32Array } {
	const cols = Math.ceil(size / resolution);
	const rows = Math.ceil(size / resolution);
	const vertexCount = (cols + 1) * (rows + 1);
	const vertices = new Float32Array(vertexCount * 3);
	const indices = new Uint32Array(cols * rows * 6);

	const halfSize = size / 2;
	const minX = centerX - halfSize;
	const minZ = centerZ - halfSize;
	const step = size / cols;

	// Fill vertices
	let vi = 0;
	for (let row = 0; row <= rows; row++) {
		const z = minZ + row * step;
		for (let col = 0; col <= cols; col++) {
			const x = minX + col * step;
			const y = terrain.getHeight(x, z);
			vertices[vi++] = x;
			vertices[vi++] = y + 0.3; // offset: getHeight() subtracts 0.3, physics needs actual surface
			vertices[vi++] = z;
		}
	}

	// Fill indices (two triangles per cell)
	let ii = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const tl = row * (cols + 1) + col;
			const tr = tl + 1;
			const bl = tl + (cols + 1);
			const br = bl + 1;
			// Triangle 1: top-left, bottom-left, top-right
			indices[ii++] = tl;
			indices[ii++] = bl;
			indices[ii++] = tr;
			// Triangle 2: top-right, bottom-left, bottom-right
			indices[ii++] = tr;
			indices[ii++] = bl;
			indices[ii++] = br;
		}
	}

	return { vertices, indices };
}

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
	private readonly _config: CarConfig;

	private terrain: TerrainProvider | null = null;

	// ── Terrain trimesh patch ──
	private groundBody: RAPIER.RigidBody | null = null;
	private patchCenterX = Number.POSITIVE_INFINITY;
	private patchCenterZ = Number.POSITIVE_INFINITY;
	/** Patch size in meters (square). 200m = 100m in each direction. */
	private readonly PATCH_SIZE = 200;
	/** Grid resolution in meters per cell. 2m = smooth enough for road driving. */
	private readonly PATCH_RESOLUTION = 2;
	/** Rebuild when car moves this far from patch center. */
	private readonly PATCH_REBUILD_DIST = 60;
	/** Extra margin beyond patch edge before forcing rebuild. */
	private readonly PATCH_EDGE_MARGIN = 30;

	// ── Guardrails ──
	private guardrailBodies: RAPIER.RigidBody[] = [];
	private lastGuardrailHash = "";

	// ── Deferred rebuilds (applied AFTER world.step() to avoid WASM aliasing) ──
	private pendingGroundRebuild: { x: number; z: number } | null = null;
	private pendingGuardrailUpdate: { x: number; z: number } | null = null;

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
				{ x: 1, y: 0, z: 0 },
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

	/**
	 * Rebuild the terrain trimesh collider from a grid of getHeight() samples.
	 * This creates a smooth, continuous mesh that exactly matches the visual terrain.
	 * At 2m resolution over 200m: 101×101 = ~10K vertices, ~20K triangles.
	 */
	private rebuildGroundPatch(cx: number, cz: number): void {
		// Remove old ground body (collider is removed with it)
		if (this.groundBody) {
			this.world.removeRigidBody(this.groundBody);
			this.groundBody = null;
		}
		if (!this.terrain) return;

		const { vertices, indices } = buildTerrainTrimesh(this.terrain, cx, cz, this.PATCH_SIZE, this.PATCH_RESOLUTION);

		// Create a fixed body at origin — the trimesh vertices are in world space
		this.groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
		this.world.createCollider(
			RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8).setRestitution(0.0),
			this.groundBody,
		);

		this.patchCenterX = cx;
		this.patchCenterZ = cz;
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

		// ── Read physics state (copy values immediately, don't hold WASM refs) ──
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
		// Negated: model faces -Z (GLTF convention), so forward velocity is -Z in world space
		const localVelX = -(vz * Math.cos(heading) + vx * Math.sin(heading));
		const speedMs = Math.sqrt(vx * vx + vz * vz);
		const speedKmh = speedMs * 3.6;

		// ── Check if terrain patch needs rebuild ──
		const dx = pos.x - this.patchCenterX;
		const dz = pos.z - this.patchCenterZ;
		const distFromCenter = Math.sqrt(dx * dx + dz * dz);
		// Rebuild if car moved >60m from center, OR if car is within 30m of patch edge
		const distFromEdge = this.PATCH_SIZE / 2 - distFromCenter;
		if (distFromCenter > this.PATCH_REBUILD_DIST || distFromEdge < this.PATCH_EDGE_MARGIN) {
			this.pendingGroundRebuild = { x: pos.x, z: pos.z };
		}
		this.pendingGuardrailUpdate = { x: pos.x, z: pos.z };

		// ── Steering ──
		const speedRed = Math.max(0.15, 1 - (speedKmh / 140) ** 1.5);
		const targetSteer = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * chassis.maxSteerAngle * speedRed;
		const maxD = this.STEER_SPEED * dt;
		const sd = targetSteer - this.steerAngle;
		this.steerAngle = Math.abs(sd) < maxD ? targetSteer : this.steerAngle + Math.sign(sd) * maxD;
		this.state.steeringAngle = this.steerAngle;

		// ── Engine + gearbox ──
		const isReverse = !!input.backward && !input.forward && localVelX < 1.0;
		engine.throttle = input.forward ? 1 : isReverse ? 0.5 : 0;
		gearbox.update(dt, engine, localVelX, false);
		engine.update(localVelX, gearbox.effectiveRatio, chassis.wheelRadius, dt);

		// ── Brakes ──
		this.brakes.isBraking = !!input.backward && !input.forward && localVelX > 0.1;
		this.brakes.isHandbrake = !!input.handbrake;
		const brakeF = this.brakes.getForce(chassis.mass);

		// ── Engine force → rear wheels ──
		let engF = engine.getWheelForce(
			gearbox.effectiveRatio,
			chassis.wheelRadius,
			chassis.mass * tires.tractionPct * 9.82,
		);
		if (gearbox.isShifting) engF *= 0.3;
		if (isReverse) engF = -engineSpec.torqueNm * 0.4;
		const totalEngF = engF * 2;
		// Negate engine force: Rapier forward is +Z but model faces -Z
		this.vehicle.setWheelEngineForce(this.wheelRL, -totalEngF);
		this.vehicle.setWheelEngineForce(this.wheelRR, -totalEngF);

		// ── Brake force → all wheels ──
		const handF = input.handbrake ? 150 : 0;
		for (let i = 0; i < 4; i++) this.vehicle.setWheelBrake(i, -brakeF + handF);

		// ── Steering → front wheels ──
		this.vehicle.setWheelSteering(this.wheelFL, -this.steerAngle);
		this.vehicle.setWheelSteering(this.wheelFR, -this.steerAngle);

		// ── Step physics ──
		this.vehicle.updateVehicle(dt);
		this.world.step();

		// ── Post-step: rebuild ground/guardrails (safe after step) ──
		if (this.pendingGroundRebuild) {
			this.rebuildGroundPatch(this.pendingGroundRebuild.x, this.pendingGroundRebuild.z);
			this.pendingGroundRebuild = null;
		}
		if (this.pendingGuardrailUpdate) {
			this.updateGuardrails(this.pendingGuardrailUpdate.x, this.pendingGuardrailUpdate.z);
			this.pendingGuardrailUpdate = null;
		}

		// ── Post-step: gently kill roll/pitch, keep yaw ──
		const r2 = this.carBody.rotation();
		const yaw2 = Math.atan2(2 * (r2.w * r2.y + r2.z * r2.x), 1 - 2 * (r2.y * r2.y + r2.x * r2.x));
		const targetQ = { x: 0, y: Math.sin(yaw2 / 2), z: 0, w: Math.cos(yaw2 / 2) };
		const lf = 0.15;
		this.carBody.setRotation(
			{
				x: r2.x + (targetQ.x - r2.x) * lf,
				y: r2.y + (targetQ.y - r2.y) * lf,
				z: r2.z + (targetQ.z - r2.z) * lf,
				w: r2.w + (targetQ.w - r2.w) * lf,
			},
			true,
		);
		const av = this.carBody.angvel();
		this.carBody.setAngvel({ x: av.x * (1 - lf), y: av.y, z: av.z * (1 - lf) }, true);

		// ── Output state ──
		this.state.speed = localVelX;
		this.state.rpm = engine.rpm;
		this.state.gear = isReverse && localVelX < -0.1 ? -1 : gearbox.currentGear + 1;
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
		// Force immediate ground rebuild at reset position
		if (this.terrain) {
			this.rebuildGroundPatch(x, z);
		}
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
