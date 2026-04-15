/**
 * VehicleController — cannon-es RaycastVehicle physics.
 *
 * Tuned based on analysis of 4 working implementations:
 * - pmndrs/cannon-es official raycast_vehicle.html
 * - tomo0613/offroadJS_v2 (real offroad racing game)
 * - cconsta1/threejs_car_demo (Mario Kart style)
 * - mslee98/cannon_car (tutorial)
 *
 * See RESEARCH_CAR_PHYSICS_V2.md for full research notes.
 */
import * as CANNON from "cannon-es";
import * as THREE from "three";
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

	// Steering (smooth interpolation like offroadJS)
	private currentSteeringAngle = 0;
	private steeringSpeed = 3.0; // rad/s — time-based, not per-frame

	// Manual yaw torque (cannon-es RaycastVehicle doesn't generate lateral
	// steering force without a chassis collision shape. We skip the chassis
	// shape to avoid trimesh/heightfield fighting, and apply yaw manually.)
	private yawFactor = 0.05;

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;

		// ── Physics world (offroadJS pattern) ──
		this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
		this.world.broadphase = new CANNON.SAPBroadphase(this.world);
		this.world.defaultContactMaterial.friction = 0.001;
		// @ts-expect-error cannon-es missing type for solver iterations
		this.world.solver.iterations = 10;

		// ── Materials (official example + offroadJS pattern) ──
		this.wheelMaterial = new CANNON.Material("wheel");
		this.groundMaterial = new CANNON.Material("ground");
		this.world.addContactMaterial(
			new CANNON.ContactMaterial(this.wheelMaterial, this.groundMaterial, {
				friction: 0.5,
				restitution: 0,
				contactEquationStiffness: 1e6,
			}),
		);

		// ── Chassis ──
		// NOTE: No collision shape on chassis body.
		// RaycastVehicle uses wheel raycasts for ground contact.
		// A chassis Box shape fights with the trimesh terrain, causing the car
		// to clip through the ground (cannon-es trimesh vs box is unreliable).
		this.chassisBody = new CANNON.Body({ mass: config.mass });
		this.chassisBody.angularDamping = 0.5; // prevent uncontrollable spin
		this.chassisBody.linearDamping = 0.1; // air resistance — helps coast to stop
		this.chassisBody.allowSleep = false;
		this.world.addBody(this.chassisBody);

		// ── RaycastVehicle (offroadJS + official pattern) ──
		this.vehicle = new CANNON.RaycastVehicle({
			chassisBody: this.chassisBody,
			indexRightAxis: 0,
			indexUpAxis: 1,
			indexForwardAxis: 2,
		});

		const wheelOpts: CANNON.WheelInfoOptions = {
			radius: config.wheelRadius,
			directionLocal: new CANNON.Vec3(0, -1, 0),
			suspensionStiffness: config.suspensionStiffness,
			suspensionRestLength: config.suspensionRestLength,
			frictionSlip: config.frictionSlip,
			dampingRelaxation: config.dampingRelaxation,
			dampingCompression: config.dampingCompression,
			maxSuspensionForce: Number.MAX_VALUE, // offroadJS uses MAX_VALUE
			rollInfluence: config.rollInfluence,
			axleLocal: new CANNON.Vec3(-1, 0, 0),
			chassisConnectionPointLocal: new CANNON.Vec3(),
			maxSuspensionTravel: config.maxSuspensionTravel,
			// offroadJS pattern: correct sliding rotation
			customSlidingRotationalSpeed: -30,
			useCustomSlidingRotationalSpeed: true,
			// offroadJS pattern: tire response curves
			forwardAcceleration: 0.5,
			sideAcceleration: 1.0,
		};

		for (const wp of config.wheelPositions) {
			wheelOpts.chassisConnectionPointLocal!.set(wp.x, wp.y, wp.z);
			this.vehicle.addWheel(wheelOpts);

			// Kinematic wheel bodies for visual sync (official example pattern)
			const cylShape = new CANNON.Cylinder(
				config.wheelRadius,
				config.wheelRadius,
				config.wheelRadius / 2,
				20,
			);
			const wheelBody = new CANNON.Body({ mass: 0, material: this.wheelMaterial });
			wheelBody.type = CANNON.Body.KINEMATIC;
			wheelBody.collisionFilterGroup = 0;
			const q = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
			wheelBody.addShape(cylShape, new CANNON.Vec3(), q);
			this.wheelBodies.push(wheelBody);
			this.world.addBody(wheelBody);
		}

		this.vehicle.addToWorld(this.world);

		// Sync wheel visuals in postStep (official + offroadJS pattern)
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

	/** Build ground collider.
	 *
	 * Uses a Trimesh built from terrain heights.
	 *
	 * NOTE: cannon-es RaycastVehicle CANNOT raycast against Heightfield shapes.
	 * Trimesh works for wheel raycasts. Steering uses manual yaw torque
	 * (RaycastVehicle doesn't generate lateral force without a chassis collision
	 * shape, and chassis shape + trimesh creates massive drag).
	 */
	setTerrain(terrain: TerrainProvider, worldSize: number, resolution = 128): void {
		this.terrain = terrain;

		for (const b of this.groundBodies) this.world.removeBody(b);
		this.groundBodies = [];

		// Build triangle mesh from terrain heights
		const spacing = worldSize / resolution;
		const vertices: number[] = [];
		const indices: number[] = [];

		for (let j = 0; j <= resolution; j++) {
			for (let i = 0; i <= resolution; i++) {
				const x = i * spacing - worldSize / 2;
				const z = j * spacing - worldSize / 2;
				vertices.push(x, terrain.getHeight(x, z), z);
			}
		}

		for (let j = 0; j < resolution; j++) {
			for (let i = 0; i < resolution; i++) {
				const a = j * (resolution + 1) + i;
				const b = a + 1;
				const c = a + (resolution + 1);
				const d = c + 1;
				indices.push(a, c, b, b, c, d);
			}
		}

		const trimesh = new CANNON.Trimesh(vertices, indices);
		const groundBody = new CANNON.Body({ mass: 0, material: this.groundMaterial });
		groundBody.addShape(trimesh);
		this.world.addBody(groundBody);
		this.groundBodies.push(groundBody);
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);

		// ── Steering (offroadJS smooth interpolation) ──
		const speedFactor = 1 - (Math.abs(this.state.speed) / this.config.maxSpeed) * 0.5;
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedFactor;

		// Smooth steering (offroadJS pattern, time-based)
		const steerDelta = this.steeringSpeed * dt;
		if (this.currentSteeringAngle < targetSteer) {
			this.currentSteeringAngle = Math.min(targetSteer, this.currentSteeringAngle + steerDelta);
		} else if (this.currentSteeringAngle > targetSteer) {
			this.currentSteeringAngle = Math.max(targetSteer, this.currentSteeringAngle - steerDelta);
		}

		// Ackermann steering
		// Critical angle: atan(tw / (2*wb)) ≈ 13°. Beyond this, the inner
		// wheel denominator goes negative and the formula breaks down.
		const wb = this.config.wheelBase;
		const tw = Math.abs(this.config.wheelPositions[0].x - this.config.wheelPositions[1].x);
		const sa = this.currentSteeringAngle;
		const sin = Math.sin(sa);
		const cos = Math.cos(sa);
		const wb2 = wb * 2;
		const ackermannLimit = Math.atan(tw / wb2);

		if (Math.abs(sa) > 0.001 && Math.abs(sa) < ackermannLimit) {
			// Ackermann: inner wheel turns more than outer
			const steerLeft = Math.atan((wb2 * sin) / (wb2 * cos - tw * sin));
			const steerRight = Math.atan((wb2 * sin) / (wb2 * cos + tw * sin));
			this.vehicle.setSteeringValue(steerLeft, 0); // front-left
			this.vehicle.setSteeringValue(steerRight, 1); // front-right
		} else if (Math.abs(sa) >= ackermannLimit) {
			// Past Ackermann limit: equal steering (avoid NaN)
			this.vehicle.setSteeringValue(sa, 0);
			this.vehicle.setSteeringValue(sa, 1);
		} else {
			this.vehicle.setSteeringValue(0, 0);
			this.vehicle.setSteeringValue(0, 1);
		}
		this.state.steeringAngle = this.currentSteeringAngle;

		// ── Engine (official: negative = forward) ──
		const ef = this.config.engineForce;
		if (input.forward) {
			// Speed limiter: reduce engine force as speed approaches maxSpeed
			const speedRatio = Math.abs(this.state.speed) / this.config.maxSpeed;
			const limitedForce = speedRatio > 0.8 ? ef * (1 - (speedRatio - 0.8) / 0.2) : ef;
			this.vehicle.applyEngineForce(-limitedForce, 2);
			this.vehicle.applyEngineForce(-limitedForce, 3);
			this.state.throttle = 1;
			this.state.brake = 0;
			this.vehicle.setBrake(0, 0);
			this.vehicle.setBrake(0, 1);
			this.vehicle.setBrake(0, 2);
			this.vehicle.setBrake(0, 3);
		} else if (input.backward) {
			if (this.state.speed > 2) {
				// Brake (rear wheels only, offroadJS pattern)
				this.vehicle.applyEngineForce(0, 2);
				this.vehicle.applyEngineForce(0, 3);
				this.vehicle.setBrake(this.config.brakeForce, 2);
				this.vehicle.setBrake(this.config.brakeForce, 3);
				this.state.brake = 1;
				this.state.throttle = 0;
			} else {
				// Reverse
				this.vehicle.applyEngineForce(ef * 0.5, 2);
				this.vehicle.applyEngineForce(ef * 0.5, 3);
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

		// Handbrake (rear wheels only, higher force)
		if (input.handbrake) {
			this.vehicle.setBrake(this.config.brakeForce * 2, 2);
			this.vehicle.setBrake(this.config.brakeForce * 2, 3);
		}

		// ── Auto gears ──
		this.updateGear();

		// ── Manual yaw torque ──
		// cannon-es RaycastVehicle without a chassis collision shape doesn't
		// generate lateral steering force. Apply yaw proportional to speed × steering.
		const speed = Math.sqrt(this.chassisBody.velocity.x ** 2 + this.chassisBody.velocity.z ** 2);
		this.chassisBody.angularVelocity.y += speed * this.currentSteeringAngle * this.yawFactor * dt;

		// ── Physics step ──
		this.world.step(1 / 60, dt, 3);

		// ── Safety net ──
		if (this.terrain) {
			const px = this.chassisBody.position.x;
			const pz = this.chassisBody.position.z;
			const terrainY = this.terrain.getHeight(px, pz);
			if (this.chassisBody.position.y < terrainY - 3) {
				this.chassisBody.position.y = terrainY + 2;
				if (this.chassisBody.velocity.y < 0) this.chassisBody.velocity.y = 0;
			}
			if (this.chassisBody.position.y > terrainY + 50) {
				this.chassisBody.position.y = terrainY + 5;
				this.chassisBody.velocity.setZero();
			}
		}

		// ── Update state ──
		const vel = this.chassisBody.velocity;
		const fwd = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
		this.state.speed = vel.dot(fwd);

		// Ground check (any wheel in contact)
		this.state.onGround = this.vehicle.wheelInfos.some((w) => w.isInContact);

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

		const pos = this.chassisBody.position;
		const quat = this.chassisBody.quaternion;
		this.model.position.set(pos.x, pos.y, pos.z);
		this.model.quaternion.set(quat.x, quat.y, quat.z, quat.w);

		// Wheels are children of the model group but cannon gives us world-space
		// positions. Convert to model-local space by inverse-transforming.
		this.model.updateMatrixWorld(true);
		const invQ = this.model.quaternion.clone().invert();
		const invP = this.model.position.clone();

		for (let i = 0; i < 4; i++) {
			if (!this.wheelMeshes[i]) continue;
			const wb = this.wheelBodies[i];
			// World pos → model-local pos
			const wx = wb.position.x - invP.x;
			const wy = wb.position.y - invP.y;
			const wz = wb.position.z - invP.z;
			this.wheelMeshes[i].position.set(wx, wy, wz).applyQuaternion(invQ);
			// World quat → model-local quat
			const wq = new THREE.Quaternion(
				wb.quaternion.x,
				wb.quaternion.y,
				wb.quaternion.z,
				wb.quaternion.w,
			);
			wq.premultiply(invQ);
			this.wheelMeshes[i].quaternion.copy(wq);
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
		this.state.steeringAngle = 0;
		this.state.throttle = 0;
		this.state.brake = 0;
		this.currentGearIndex = 0;
		this.currentSteeringAngle = 0;
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
