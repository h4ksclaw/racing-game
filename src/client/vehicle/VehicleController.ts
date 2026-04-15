import * as CANNON from "cannon-es";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
	type CarConfig,
	RACE_CAR,
	type VehicleInput,
	type VehicleState,
	type WheelVisual,
} from "./types.ts";

/**
 * VehicleController — orchestrates physics and visuals for a car.
 *
 * Uses cannon-es RaycastVehicle for physics.
 * Syncs a Three.js Group (loaded GLB model) with the physics body.
 */
export class VehicleController {
	// Physics
	world: CANNON.World;
	vehicle: CANNON.RaycastVehicle;
	chassisBody: CANNON.Body;

	// Visual
	model: THREE.Group | null = null;
	wheelVisuals: WheelVisual[] = [];
	wheelMeshes: THREE.Object3D[] = []; // indexed same as cannon wheels

	// State
	state: VehicleState = {
		speed: 0,
		rpm: 800,
		gear: 0,
		steeringAngle: 0,
		throttle: 0,
		brake: 0,
		onGround: false,
	};

	// Internal
	private config: CarConfig;
	private currentGearIndex = 0;
	private terrainSampler: ((x: number, z: number) => number) | null = null;
	private groundBodies: CANNON.Body[] = [];
	private lastGroundY = 0;
	private fallFrames = 0;

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;

		// Physics world
		this.world = new CANNON.World({
			gravity: new CANNON.Vec3(0, -9.82, 0),
		});
		this.world.broadphase = new CANNON.NaiveBroadphase();
		(this.world.solver as unknown as { iterations: number }).iterations = 10;

		// Chassis
		this.chassisBody = new CANNON.Body({
			mass: config.mass,
			position: new CANNON.Vec3(0, 2, 0),
		});
		const [hw, hh, hd] = config.chassisHalfExtents;
		this.chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(hw, hh, hd)));
		this.chassisBody.angularDamping = 0.4;
		this.world.addBody(this.chassisBody);

		// Raycast vehicle
		this.vehicle = new CANNON.RaycastVehicle({
			chassisBody: this.chassisBody,
			indexRightAxis: 0,
			indexUpAxis: 1,
			indexForwardAxis: 2,
		});

		// Add wheels
		for (const wp of config.wheelPositions) {
			this.vehicle.addWheel({
				radius: config.wheelRadius,
				directionLocal: new CANNON.Vec3(0, -1, 0),
				suspensionStiffness: config.suspensionStiffness,
				suspensionRestLength: config.suspensionRestLength,
				frictionSlip: config.frictionSlip,
				dampingRelaxation: config.dampingRelaxation,
				dampingCompression: config.dampingCompression,
				maxSuspensionForce: 100000,
				rollInfluence: config.rollInfluence,
				axleLocal: new CANNON.Vec3(-1, 0, 0),
				chassisConnectionPointLocal: new CANNON.Vec3(wp.x, wp.y, wp.z),
				maxSuspensionTravel: config.maxSuspensionTravel,
				customSlidingRotationalSpeed: -30,
				useCustomSlidingRotationalSpeed: true,
			});
		}

		this.vehicle.addToWorld(this.world);
	}

	/** Load the GLB car model and extract wheel references */
	async loadModel(): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		const group = gltf.scene;
		this.model = group;

		// Find wheel meshes by name
		this.wheelMeshes = [];
		const wheelNames = [
			"wheel-front-left",
			"wheel-front-right",
			"wheel-back-left",
			"wheel-back-right",
		];

		for (const name of wheelNames) {
			const obj = group.getObjectByName(name);
			if (obj) {
				this.wheelMeshes.push(obj);
			}
		}

		// Store visual info
		this.wheelVisuals = this.config.wheelPositions.map((wp, i) => ({
			mesh: this.wheelMeshes[i] || new THREE.Object3D(),
			isFront: i < 2,
			connectionPoint: wp,
		}));

		return group;
	}

	/** Set a terrain height sampler for ground collision.
	 *  Creates a heightfield collider AND keeps the sampler for per-frame correction. */
	setTerrainSampler(
		sampler: (x: number, z: number) => number,
		worldSize: number,
		resolution: number,
	): void {
		this.terrainSampler = sampler;

		// Remove old ground bodies
		for (const b of this.groundBodies) {
			this.world.removeBody(b);
		}
		this.groundBodies = [];

		// Create heightfield collider — centered at origin like the terrain mesh
		const halfSize = worldSize / 2;
		const elementSize = worldSize / (resolution - 1);
		const matrix: number[][] = [];
		for (let i = 0; i < resolution; i++) {
			const row: number[] = [];
			for (let j = 0; j < resolution; j++) {
				// Heightfield data goes from -halfSize to +halfSize
				const x = (i / (resolution - 1) - 0.5) * worldSize;
				const z = (j / (resolution - 1) - 0.5) * worldSize;
				row.push(sampler(x, z));
			}
			matrix.push(row);
		}

		const hfShape = new CANNON.Heightfield(matrix, {
			elementSize,
		});

		// Heightfield origin is at the first data point corner (-halfSize, 0, -halfSize)
		// then rotated by -PI/2 around X to make it horizontal
		const hfBody = new CANNON.Body({
			mass: 0, // static
			position: new CANNON.Vec3(-halfSize, 0, -halfSize),
		});
		hfBody.addShape(hfShape);
		hfBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
		this.world.addBody(hfBody);
		this.groundBodies.push(hfBody);
	}

	/** Process input and update physics */
	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);

		// Per-frame terrain correction: if cannon's heightfield misses (too coarse),
		// snap the car to the terrain sampler height to prevent falling through
		if (this.terrainSampler) {
			const px = this.chassisBody.position.x;
			const pz = this.chassisBody.position.z;
			const groundY =
				this.terrainSampler(px, pz) +
				this.config.wheelRadius +
				this.config.suspensionRestLength * 0.5;
			this.lastGroundY = groundY;

			// If car is below terrain, push it up
			if (this.chassisBody.position.y < groundY) {
				this.chassisBody.position.y = groundY;
				// Kill downward velocity
				if (this.chassisBody.velocity.y < 0) {
					this.chassisBody.velocity.y *= 0.1;
				}
				this.fallFrames = 0;
			}

			// If car is way above terrain and falling, it's probably spawned wrong — teleport down
			if (this.chassisBody.position.y > groundY + 50) {
				this.chassisBody.position.y = groundY + 2;
				this.chassisBody.velocity.setZero();
			}
		}

		// Steering (speed-dependent: less at high speed)
		const speedFactor = 1 - (Math.abs(this.state.speed) / this.config.maxSpeed) * 0.5;
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedFactor;
		this.state.steeringAngle += (targetSteer - this.state.steeringAngle) * 8 * dt;

		// Apply steering to front wheels
		this.vehicle.setSteeringValue(this.state.steeringAngle, 0);
		this.vehicle.setSteeringValue(this.state.steeringAngle, 1);

		// Engine force
		const wantForward = input.forward;
		const wantBackward = input.backward || input.brake;

		if (wantForward) {
			const force = this.config.engineForce * this.getGearMultiplier();
			this.vehicle.applyEngineForce(force, 2);
			this.vehicle.applyEngineForce(force, 3);
			this.state.throttle = 1;
			this.state.brake = 0;
		} else if (wantBackward) {
			if (this.state.speed > 1) {
				// Braking
				this.vehicle.applyEngineForce(0, 2);
				this.vehicle.applyEngineForce(0, 3);
				this.vehicle.setBrake(this.config.brakeForce, 2);
				this.vehicle.setBrake(this.config.brakeForce, 3);
				this.state.brake = 1;
				this.state.throttle = 0;
			} else {
				// Reverse
				const force = -this.config.engineForce * 0.4;
				this.vehicle.applyEngineForce(force, 2);
				this.vehicle.applyEngineForce(force, 3);
				this.vehicle.setBrake(0, 2);
				this.vehicle.setBrake(0, 3);
				this.state.throttle = 0.5;
				this.state.brake = 0;
			}
		} else {
			this.vehicle.applyEngineForce(0, 2);
			this.vehicle.applyEngineForce(0, 3);
			this.vehicle.setBrake(0, 2);
			this.vehicle.setBrake(0, 3);
			this.state.throttle = 0;
			this.state.brake = 0;
		}

		// Handbrake (rear wheels only)
		if (input.handbrake) {
			this.vehicle.setBrake(this.config.brakeForce * 1.5, 2);
			this.vehicle.setBrake(this.config.brakeForce * 1.5, 3);
		}

		// Auto gear shifting
		this.updateGear();

		// Step physics
		this.world.step(1 / 60, dt, 3);

		// Update state
		const vel = this.chassisBody.velocity;
		const fwd = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
		this.state.speed = vel.dot(fwd);
		this.state.onGround = this.chassisBody.position.y < this.lastGroundY + 1.5;

		// Update RPM from wheel speed
		const wheelSpeed = Math.abs(this.state.speed) / this.config.wheelRadius;
		const wheelRPM = (wheelSpeed * 60) / (2 * Math.PI);
		const gearRatio = this.config.gearRatios[this.currentGearIndex] || 1;
		this.state.rpm = Math.max(
			this.config.idleRPM,
			Math.min(wheelRPM * gearRatio * 3.5, this.config.maxRPM),
		);
		if (this.state.throttle > 0 && this.state.speed < 1) {
			this.state.rpm =
				this.config.idleRPM +
				this.state.throttle * (this.config.maxRPM - this.config.idleRPM) * 0.5;
		}
	}

	/** Sync Three.js model with physics body */
	syncVisuals(): void {
		if (!this.model) return;

		// Sync chassis
		const pos = this.chassisBody.position;
		const quat = this.chassisBody.quaternion;
		this.model.position.set(pos.x, pos.y, pos.z);
		this.model.quaternion.set(quat.x, quat.y, quat.z, quat.w);

		// Sync wheels
		for (let i = 0; i < 4; i++) {
			this.vehicle.updateWheelTransform(i);
			const t = this.vehicle.wheelInfos[i].worldTransform;
			if (t && this.wheelMeshes[i]) {
				this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
				this.wheelMeshes[i].quaternion.set(
					t.quaternion.x,
					t.quaternion.y,
					t.quaternion.z,
					t.quaternion.w,
				);
			}
		}
	}

	/** Reset car to a position */
	reset(x: number, y: number, z: number, rotation = 0): void {
		this.chassisBody.position.set(x, y, z);
		this.chassisBody.quaternion.setFromEuler(0, rotation, 0);
		this.chassisBody.velocity.setZero();
		this.chassisBody.angularVelocity.setZero();
		this.state.speed = 0;
		this.state.rpm = this.config.idleRPM;
		this.currentGearIndex = 0;
	}

	/** Get chassis world position */
	getPosition(): { x: number; y: number; z: number } {
		return {
			x: this.chassisBody.position.x,
			y: this.chassisBody.position.y,
			z: this.chassisBody.position.z,
		};
	}

	/** Get forward direction in world space */
	getForward(): { x: number; y: number; z: number } {
		const fwd = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
		return { x: fwd.x, y: fwd.y, z: fwd.z };
	}

	dispose(): void {
		this.vehicle.removeFromWorld(this.world);
		this.world.removeBody(this.chassisBody);
		for (const b of this.groundBodies) {
			this.world.removeBody(b);
		}
	}

	private getGearMultiplier(): number {
		const ratio = this.config.gearRatios[this.currentGearIndex] || 1;
		return 1 / (ratio * 0.8 + 0.5);
	}

	private updateGear(): void {
		const ratios = this.config.gearRatios;
		if (this.state.speed < 0) {
			this.currentGearIndex = 0;
			return;
		}

		const wheelRPM = ((Math.abs(this.state.speed) / this.config.wheelRadius) * 60) / (2 * Math.PI);

		if (this.state.rpm > this.config.maxRPM * 0.85 && this.currentGearIndex < ratios.length - 1) {
			this.currentGearIndex++;
		} else if (this.state.rpm < this.config.maxRPM * 0.3 && this.currentGearIndex > 0) {
			this.currentGearIndex--;
		}
	}
}
