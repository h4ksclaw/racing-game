/**
 * VehicleController — arcade/bicycle-model physics.
 *
 * Proper bicycle model with:
 * - Slip angles (front + rear computed from local velocities)
 * - Tire lateral forces with grip limit (tire circle)
 * - Weight transfer under acceleration/braking
 * - Yaw torque from tire force differentials
 * - Ground collision via terrain.getHeight() sampling
 *
 * References:
 * - Marco Monster "Car Physics for Games"
 * - https://www.xarg.org/book/vehicle-physics/
 * - Gillespie "Fundamentals of Vehicle Dynamics"
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig, VehicleInput, VehicleState } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR } from "./types.ts";

export interface TerrainProvider {
	getHeight(x: number, z: number): number;
}

export class VehicleController {
	model: THREE.Group | null = null;
	private wheelMeshes: THREE.Object3D[] = [];
	private terrain: TerrainProvider | null = null;

	state: VehicleState = {
		speed: 0,
		rpm: 800,
		gear: 0,
		steeringAngle: 0,
		throttle: 0,
		brake: 0,
		onGround: true,
	};

	private config: CarConfig;

	// Position / orientation (world space)
	private posX = 0;
	private posY = 2;
	private posZ = 0;
	private heading = 0; // yaw radians (0 = facing +Z)

	// Velocities in LOCAL frame (forward=lateral)
	// localX = forward speed, localY = lateral speed (right-positive)
	private localVelX = 0;
	private localVelY = 0;
	private angularVelocity = 0; // yaw rate rad/s

	// Steering
	private currentSteeringAngle = 0;
	private steeringSpeed = 3.0; // rad/s interpolation

	// Gears
	private currentGearIndex = 0;

	// ── Derived car dimensions from config ──
	private cgToFront: number;
	private cgToRear: number;
	private cgHeight: number;
	private inertia: number; // rotational inertia about yaw axis

	// ── Tire model parameters ──
	private corneringStiffnessFront: number;
	private corneringStiffnessRear: number;

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;

		// CG position: slightly forward of center (front-heavy for RWD)
		const wb = config.wheelBase;
		this.cgToFront = wb * 0.55;
		this.cgToRear = wb * 0.45;
		this.cgHeight = config.wheelRadius * 1.5;

		// Rotational inertia: I = m * a * b (simplified)
		this.inertia = config.mass * this.cgToFront * this.cgToRear;

		// Cornering stiffness: higher = more grip, more responsive steering
		// Scales with mass so heavier cars don't feel sluggish
		const baseStiffness = config.frictionSlip * 50;
		this.corneringStiffnessFront = baseStiffness;
		this.corneringStiffnessRear = baseStiffness * 0.95; // slightly less rear grip
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

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);
		const mass = this.config.mass;

		// ── Steering input (smooth, speed-dependent) ──
		const speedFactor = 1 - (Math.abs(this.localVelX) / this.config.maxSpeed) * 0.5;
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedFactor;

		const steerDelta = this.steeringSpeed * dt;
		if (this.currentSteeringAngle < targetSteer) {
			this.currentSteeringAngle = Math.min(targetSteer, this.currentSteeringAngle + steerDelta);
		} else if (this.currentSteeringAngle > targetSteer) {
			this.currentSteeringAngle = Math.max(targetSteer, this.currentSteeringAngle - steerDelta);
		}
		this.state.steeringAngle = this.currentSteeringAngle;

		// ── Weight transfer ──
		const weight = mass * 9.82;
		const accelForce = input.forward ? this.config.engineForce : 0;
		const brakeForce = input.backward && this.localVelX > 2 ? this.config.brakeForce : 0;
		const weightTransfer =
			(accelForce * this.config.wheelRadius - brakeForce * this.cgHeight) / this.config.wheelBase;
		const weightFront = Math.max(weight * 0.1, weight * 0.5 - weightTransfer);
		const weightRear = Math.max(weight * 0.1, weight * 0.5 + weightTransfer);

		// ── Slip angles ──
		// Front axle velocity in local frame
		const frontLocalX = this.localVelX;
		const frontLocalY = this.localVelY + this.angularVelocity * this.cgToFront;

		let slipAngleFront = 0;
		if (Math.abs(frontLocalX) > 0.5) {
			slipAngleFront =
				Math.atan2(frontLocalY, Math.abs(frontLocalX)) -
				Math.sign(frontLocalX) * this.currentSteeringAngle;
		}

		// Rear axle velocity in local frame
		const rearLocalX = this.localVelX;
		const rearLocalY = this.localVelY - this.angularVelocity * this.cgToRear;

		let slipAngleRear = 0;
		if (Math.abs(rearLocalX) > 0.5) {
			slipAngleRear = Math.atan2(rearLocalY, Math.abs(rearLocalX));
		}

		// ── Tire lateral forces ──
		let latForceFront = this.corneringStiffnessFront * slipAngleFront;
		let latForceRear = this.corneringStiffnessRear * slipAngleRear;

		// Grip limit (friction circle): F_max = mu * N
		const mu = this.config.frictionSlip;
		const maxLatFront = mu * weightFront;
		const maxLatRear = mu * weightRear;
		latForceFront = Math.max(-maxLatFront, Math.min(maxLatFront, latForceFront));
		latForceRear = Math.max(-maxLatRear, Math.min(maxLatRear, latForceRear));

		// ── Longitudinal forces ──
		let driveForce = 0;
		if (input.forward) {
			driveForce = this.config.engineForce;
			// Speed limiter
			const speedRatio = Math.abs(this.localVelX) / this.config.maxSpeed;
			if (speedRatio > 0.8) driveForce *= 1 - (speedRatio - 0.8) / 0.2;
		} else if (input.backward) {
			if (this.localVelX > 2) {
				// Braking
				driveForce = -this.config.brakeForce;
			} else {
				// Reverse (half power)
				driveForce = this.config.engineForce * 0.5;
			}
		}

		// Handbrake
		if (input.handbrake) {
			driveForce = -this.config.brakeForce * 2;
			// Handbrake reduces rear grip (simulates locked rear wheels)
			latForceRear *= 0.3;
		}

		// Rolling resistance + aero drag
		driveForce -= this.localVelX * (15 + Math.abs(this.localVelX) * 0.1);

		// ── Total forces in local frame ──
		// Front tire force contributes to both X and Y (steered)
		const forceX = driveForce + latForceFront * Math.sin(this.currentSteeringAngle);
		const forceY = latForceFront * Math.cos(this.currentSteeringAngle) + latForceRear;

		// ── Yaw torque ──
		// Torque = front_lat * cgToFront - rear_lat * cgToRear
		const yawTorque =
			latForceFront * this.cgToFront * Math.cos(this.currentSteeringAngle) -
			latForceRear * this.cgToRear;

		// ── Integration (local frame) ──
		this.localVelX += (forceX / mass) * dt;
		this.localVelY += (forceY / mass) * dt;
		this.angularVelocity += (yawTorque / this.inertia) * dt;

		// Damping
		this.angularVelocity *= 1 - 3.0 * dt;
		this.localVelY *= 1 - 2.0 * dt;

		// Kill tiny velocities
		if (Math.abs(this.localVelX) < 0.05 && !input.forward && !input.backward) {
			this.localVelX = 0;
		}
		if (Math.abs(this.localVelY) < 0.01) this.localVelY = 0;
		if (Math.abs(this.angularVelocity) < 0.001) this.angularVelocity = 0;

		// ── Convert local velocity to world and integrate position ──
		// heading=0 means car faces +Z, so we offset by -PI/2 from standard math
		const sinH = Math.sin(this.heading);
		const cosH = Math.cos(this.heading);
		const worldVelX = this.localVelX * sinH - this.localVelY * cosH;
		const worldVelZ = this.localVelX * cosH + this.localVelY * sinH;

		this.posX += worldVelX * dt;
		this.posZ += worldVelZ * dt;

		// Gravity
		const verticalVel = -9.82 * dt;
		this.posY += verticalVel * dt;

		// ── Ground collision ──
		if (this.terrain) {
			const groundY = this.terrain.getHeight(this.posX, this.posZ);
			const restHeight = this.config.wheelRadius + this.config.suspensionRestLength;

			if (this.posY < groundY + restHeight) {
				this.posY = groundY + restHeight;
				// Simple landing: just kill downward velocity
			}
			this.state.onGround = this.posY <= groundY + restHeight + 0.1;
		}

		// ── Update heading ──
		this.heading += this.angularVelocity * dt;

		// ── Update state ──
		this.state.speed = this.localVelX;
		this.state.throttle = input.forward ? 1 : input.backward ? 0.5 : 0;
		this.state.brake = (input.backward && this.localVelX > 2) || input.handbrake ? 1 : 0;

		// Auto gears
		this.updateGear();

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

		this.model.position.set(this.posX, this.posY, this.posZ);
		this.model.quaternion.setFromEuler(new THREE.Euler(0, this.heading, 0));

		// Wheels: spin + steer
		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			// Steering: front wheels rotate around Y
			if (i < 2) {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, this.currentSteeringAngle, 0));
			} else {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			}

			// Spin around local X
			const spinAngle = (this.state.speed / this.config.wheelRadius) * 0.016;
			const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spinAngle);
			mesh.quaternion.multiply(spinQ);
		}
	}

	getPosition(): { x: number; y: number; z: number } {
		return { x: this.posX, y: this.posY, z: this.posZ };
	}

	getForward(): { x: number; y: number; z: number } {
		return {
			x: Math.sin(this.heading),
			y: 0,
			z: Math.cos(this.heading),
		};
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.posX = x;
		this.posY = y;
		this.posZ = z;
		this.heading = rotation;
		this.localVelX = 0;
		this.localVelY = 0;
		this.angularVelocity = 0;
		this.state.speed = 0;
		this.state.rpm = this.config.idleRPM;
		this.state.steeringAngle = 0;
		this.state.throttle = 0;
		this.state.brake = 0;
		this.currentGearIndex = 0;
		this.currentSteeringAngle = 0;
	}

	dispose(): void {
		// No physics bodies to clean up
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
