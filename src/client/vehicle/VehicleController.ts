/**
 * VehicleController — cannon-es RaycastVehicle physics.
 *
 * Based on the official cannon-es raycast_vehicle.html example:
 * - SAPBroadphase (not Naive)
 * - ContactMaterial for wheel-ground friction
 * - KINEMATIC wheel bodies with collisionFilterGroup=0
 * - Heightfield body positioned at (-halfX, Y, +halfZ) with -PI/2 rotation
 * - Engine force sign convention: negative = forward (Z-forward axis)
 */
import * as CANNON from "cannon-es";
import type * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig, VehicleInput, VehicleState } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR } from "./types.ts";

export interface TerrainProvider {
	getHeight(x: number, z: number): number;
}

export class VehicleController {
	world: CANNON.World;
	vehicle: CANNON.RaycastVehicle;
	chassisBody: CANNON.Body;
	private wheelBodies: CANNON.Body[] = [];

	model: THREE.Group | null = null;
	private wheelMeshes: THREE.Object3D[] = [];

	state: VehicleState = {
		speed: 0,
		rpm: 800,
		gear: 0,
		steeringAngle: 0,
		throttle: 0,
		brake: 0,
		onGround: false,
	};

	private config: CarConfig;
	private currentGearIndex = 0;
	private terrain: TerrainProvider | null = null;
	private groundBodies: CANNON.Body[] = [];
	private wheelMaterial: CANNON.Material;
	private groundMaterial: CANNON.Material;

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;

		// Physics world — matching official example
		this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -10, 0) });
		this.world.broadphase = new CANNON.SAPBroadphase(this.world);
		this.world.defaultContactMaterial.friction = 0; // friction only via ContactMaterial

		// Materials for wheel-ground interaction
		this.wheelMaterial = new CANNON.Material("wheel");
		this.groundMaterial = new CANNON.Material("ground");
		this.world.addContactMaterial(
			new CANNON.ContactMaterial(this.wheelMaterial, this.groundMaterial, {
				friction: 0.3,
				restitution: 0,
				contactEquationStiffness: 1e6,
			}),
		);

		// Chassis
		const [hw, hh, hd] = config.chassisHalfExtents;
		this.chassisBody = new CANNON.Body({ mass: config.mass });
		this.chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(hw, hh, hd)));
		this.chassisBody.position.set(0, 4, 0);
		this.chassisBody.angularDamping = 0.4;
		this.world.addBody(this.chassisBody);

		// Raycast vehicle — official example uses Z-forward axis
		this.vehicle = new CANNON.RaycastVehicle({
			chassisBody: this.chassisBody,
			indexRightAxis: 0,
			indexUpAxis: 1,
			indexForwardAxis: 2,
		});

		const wheelOpts = {
			radius: config.wheelRadius,
			directionLocal: new CANNON.Vec3(0, -1, 0),
			suspensionStiffness: 30,
			suspensionRestLength: 0.3,
			frictionSlip: 1.4,
			dampingRelaxation: 2.3,
			dampingCompression: 4.4,
			maxSuspensionForce: 100000,
			rollInfluence: 0.01,
			axleLocal: new CANNON.Vec3(-1, 0, 0),
			chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
			maxSuspensionTravel: 0.3,
			customSlidingRotationalSpeed: -30,
			useCustomSlidingRotationalSpeed: true,
		};

		for (const wp of config.wheelPositions) {
			wheelOpts.chassisConnectionPointLocal.set(wp.x, wp.y, wp.z);
			this.vehicle.addWheel(wheelOpts);

			// Kinematic wheel body for visual sync (official example pattern)
			const cylShape = new CANNON.Cylinder(
				config.wheelRadius,
				config.wheelRadius,
				config.wheelRadius / 2,
				20,
			);
			const wheelBody = new CANNON.Body({
				mass: 0,
				material: this.wheelMaterial,
			});
			wheelBody.type = CANNON.Body.KINEMATIC;
			wheelBody.collisionFilterGroup = 0; // no collision with world
			const q = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
			wheelBody.addShape(cylShape, new CANNON.Vec3(), q);
			this.wheelBodies.push(wheelBody);
			this.world.addBody(wheelBody);
		}

		this.vehicle.addToWorld(this.world);

		// Sync kinematic wheel bodies after each physics step
		this.world.addEventListener("postStep", () => {
			for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
				this.vehicle.updateWheelTransform(i);
				const t = this.vehicle.wheelInfos[i].worldTransform;
				this.wheelBodies[i].position.copy(t.position);
				this.wheelBodies[i].quaternion.copy(t.quaternion);
			}
		});
	}

	async loadModel(): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		const group = gltf.scene;
		this.model = group;

		this.wheelMeshes = [];
		const wheelNames = [
			"wheel-front-left",
			"wheel-front-right",
			"wheel-back-left",
			"wheel-back-right",
		];
		for (const name of wheelNames) {
			const obj = group.getObjectByName(name);
			if (obj) this.wheelMeshes.push(obj);
		}

		return group;
	}

	/** Build terrain heightfield collider. Resolution controls grid density. */
	setTerrain(terrain: TerrainProvider, worldSize: number, resolution = 128): void {
		this.terrain = terrain;

		// Remove old ground
		for (const b of this.groundBodies) this.world.removeBody(b);
		this.groundBodies = [];

		const halfSize = worldSize / 2;
		const elSize = worldSize / (resolution - 1);

		// Build height data
		const matrix: number[][] = [];
		for (let i = 0; i < resolution; i++) {
			const row: number[] = [];
			for (let j = 0; j < resolution; j++) {
				const x = (j / (resolution - 1) - 0.5) * worldSize;
				const z = (i / (resolution - 1) - 0.5) * worldSize;
				row.push(terrain.getHeight(x, z));
			}
			matrix.push(row);
		}

		const hfShape = new CANNON.Heightfield(matrix, { elementSize: elSize });

		// Position: official example uses (-halfX, Y, +halfZ) with -PI/2 rotation
		const hfBody = new CANNON.Body({
			mass: 0,
			material: this.groundMaterial,
		});
		hfBody.addShape(hfShape);
		hfBody.position.set(-halfSize, 0, halfSize);
		hfBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
		this.world.addBody(hfBody);
		this.groundBodies.push(hfBody);
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);

		// Steering
		const speedFactor = 1 - (Math.abs(this.state.speed) / this.config.maxSpeed) * 0.5;
		const maxSteer = this.config.maxSteerAngle * speedFactor;
		if (input.left) {
			this.vehicle.setSteeringValue(maxSteer, 0);
			this.vehicle.setSteeringValue(maxSteer, 1);
			this.state.steeringAngle = maxSteer;
		} else if (input.right) {
			this.vehicle.setSteeringValue(-maxSteer, 0);
			this.vehicle.setSteeringValue(-maxSteer, 1);
			this.state.steeringAngle = -maxSteer;
		} else {
			this.vehicle.setSteeringValue(0, 0);
			this.vehicle.setSteeringValue(0, 1);
			this.state.steeringAngle = 0;
		}

		// Engine (official example: negative force = forward on Z axis)
		const engineForce = this.config.engineForce;
		if (input.forward) {
			this.vehicle.applyEngineForce(-engineForce, 2);
			this.vehicle.applyEngineForce(-engineForce, 3);
			this.state.throttle = 1;
			this.state.brake = 0;
			this.vehicle.setBrake(0, 0);
			this.vehicle.setBrake(0, 1);
			this.vehicle.setBrake(0, 2);
			this.vehicle.setBrake(0, 3);
		} else if (input.backward || input.brake) {
			if (this.state.speed > 1) {
				this.vehicle.applyEngineForce(0, 2);
				this.vehicle.applyEngineForce(0, 3);
				this.vehicle.setBrake(this.config.brakeForce, 0);
				this.vehicle.setBrake(this.config.brakeForce, 1);
				this.vehicle.setBrake(this.config.brakeForce, 2);
				this.vehicle.setBrake(this.config.brakeForce, 3);
				this.state.brake = 1;
				this.state.throttle = 0;
			} else {
				this.vehicle.applyEngineForce(engineForce * 0.5, 2);
				this.vehicle.applyEngineForce(engineForce * 0.5, 3);
				this.state.throttle = 0.5;
				this.state.brake = 0;
			}
		} else {
			this.vehicle.applyEngineForce(0, 2);
			this.vehicle.applyEngineForce(0, 3);
			this.vehicle.setBrake(0, 0);
			this.vehicle.setBrake(0, 1);
			this.vehicle.setBrake(0, 2);
			this.vehicle.setBrake(0, 3);
			this.state.throttle = 0;
			this.state.brake = 0;
		}

		// Handbrake
		if (input.handbrake) {
			this.vehicle.setBrake(this.config.brakeForce * 2, 2);
			this.vehicle.setBrake(this.config.brakeForce * 2, 3);
		}

		// Auto gears
		this.updateGear();

		// Step physics
		this.world.step(1 / 60, dt, 3);

		// Safety net: terrain sampler correction (only if >2m below expected)
		if (this.terrain) {
			const px = this.chassisBody.position.x;
			const pz = this.chassisBody.position.z;
			const groundY = this.terrain.getHeight(px, pz) + this.config.wheelRadius + 0.5;
			if (this.chassisBody.position.y < groundY - 2) {
				this.chassisBody.position.y = groundY;
				if (this.chassisBody.velocity.y < 0) this.chassisBody.velocity.y = 0;
			}
			if (this.chassisBody.position.y > groundY + 50) {
				this.chassisBody.position.y = groundY + 2;
				this.chassisBody.velocity.setZero();
			}
		}

		// Update state
		const vel = this.chassisBody.velocity;
		const fwd = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
		this.state.speed = vel.dot(fwd);
		this.state.onGround = this.chassisBody.position.y < 10;

		// RPM
		const wheelRPM = ((Math.abs(this.state.speed) / this.config.wheelRadius) * 60) / (2 * Math.PI);
		const gearRatio = this.config.gearRatios[this.currentGearIndex] || 1;
		this.state.rpm = Math.max(
			this.config.idleRPM,
			Math.min(wheelRPM * gearRatio * 3.5, this.config.maxRPM),
		);
		if (this.state.throttle > 0 && Math.abs(this.state.speed) < 1) {
			this.state.rpm =
				this.config.idleRPM +
				this.state.throttle * (this.config.maxRPM - this.config.idleRPM) * 0.5;
		}
	}

	syncVisuals(): void {
		if (!this.model) return;

		// Chassis
		const pos = this.chassisBody.position;
		const quat = this.chassisBody.quaternion;
		this.model.position.set(pos.x, pos.y, pos.z);
		this.model.quaternion.set(quat.x, quat.y, quat.z, quat.w);

		// Wheels — use kinematic body positions (already synced in postStep)
		for (let i = 0; i < 4; i++) {
			if (!this.wheelMeshes[i]) continue;
			const wb = this.wheelBodies[i];
			this.wheelMeshes[i].position.set(wb.position.x, wb.position.y, wb.position.z);
			this.wheelMeshes[i].quaternion.set(
				wb.quaternion.x,
				wb.quaternion.y,
				wb.quaternion.z,
				wb.quaternion.w,
			);
		}
	}

	getPosition(): { x: number; y: number; z: number } {
		return {
			x: this.chassisBody.position.x,
			y: this.chassisBody.position.y,
			z: this.chassisBody.position.z,
		};
	}

	getForward(): { x: number; y: number; z: number } {
		const fwd = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
		return { x: fwd.x, y: fwd.y, z: fwd.z };
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.chassisBody.position.set(x, y, z);
		this.chassisBody.quaternion.setFromEuler(0, rotation, 0);
		this.chassisBody.velocity.setZero();
		this.chassisBody.angularVelocity.setZero();
		this.state.speed = 0;
		this.state.rpm = this.config.idleRPM;
		this.currentGearIndex = 0;
		// Reset all forces
		for (let i = 0; i < 4; i++) {
			this.vehicle.setSteeringValue(0, i);
			this.vehicle.setBrake(0, i);
			this.vehicle.applyEngineForce(0, i);
		}
	}

	dispose(): void {
		this.vehicle.removeFromWorld(this.world);
		this.world.removeBody(this.chassisBody);
		for (const b of this.wheelBodies) this.world.removeBody(b);
		for (const b of this.groundBodies) this.world.removeBody(b);
	}

	private updateGear(): void {
		const ratios = this.config.gearRatios;
		if (this.state.speed < 0) {
			this.currentGearIndex = 0;
			return;
		}
		if (this.state.rpm > this.config.maxRPM * 0.85 && this.currentGearIndex < ratios.length - 1) {
			this.currentGearIndex++;
		} else if (this.state.rpm < this.config.maxRPM * 0.3 && this.currentGearIndex > 0) {
			this.currentGearIndex--;
		}
	}
}
