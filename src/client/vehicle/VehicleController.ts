/**
 * VehicleController — arcade/bicycle-model physics.
 *
 * No physics engine. Ground collision = terrain.getHeight() sampling.
 * Steering = bicycle model (velocity rotates with car heading).
 * Suspension = simple spring interpolation on Y.
 *
 * Dropped cannon-es because:
 * - RaycastVehicle can't raycast Heightfield shapes
 * - Trimesh creates invisible walls at triangle edges
 * - Chassis Box + Trimesh causes clipping
 * - No lateral steering force without chassis shape
 * - All workarounds (manual yaw torque, plane moving) caused worse bugs
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

	// Position / orientation
	private pos = { x: 0, y: 2, z: 0 };
	private heading = 0; // yaw in radians
	private velocity = { x: 0, y: 0, z: 0 };

	// Steering
	private currentSteeringAngle = 0;
	private steeringSpeed = 3.0; // rad/s

	// Gears
	private currentGearIndex = 0;

	// Suspension spring
	private suspensionY = 0; // offset from rest height

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;
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

		// ── Steering ──
		const speedFactor = 1 - (Math.abs(this.state.speed) / this.config.maxSpeed) * 0.5;
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedFactor;

		const steerDelta = this.steeringSpeed * dt;
		if (this.currentSteeringAngle < targetSteer) {
			this.currentSteeringAngle = Math.min(targetSteer, this.currentSteeringAngle + steerDelta);
		} else if (this.currentSteeringAngle > targetSteer) {
			this.currentSteeringAngle = Math.max(targetSteer, this.currentSteeringAngle - steerDelta);
		}
		this.state.steeringAngle = this.currentSteeringAngle;

		// ── Bicycle-model turning ──
		// Turn rate = speed * tan(steerAngle) / wheelbase
		// Rotate both velocity vector and heading together
		if (Math.abs(this.currentSteeringAngle) > 0.001 && Math.abs(this.state.speed) > 0.5) {
			const turnRate =
				(Math.abs(this.state.speed) * Math.tan(this.currentSteeringAngle)) / this.config.wheelBase;
			const yawDelta = turnRate * dt;

			const cos = Math.cos(yawDelta);
			const sin = Math.sin(yawDelta);
			const vx = this.velocity.x;
			const vz = this.velocity.z;
			this.velocity.x = vx * cos - vz * sin;
			this.velocity.z = vx * sin + vz * cos;
			this.heading += yawDelta;
		}

		// ── Forward direction ──
		const fwdX = Math.sin(this.heading);
		const fwdZ = Math.cos(this.heading);

		// ── Engine / Brake ──
		const ef = this.config.engineForce / this.config.mass; // acceleration

		if (input.forward) {
			const speedRatio = Math.abs(this.state.speed) / this.config.maxSpeed;
			const limitedAccel = speedRatio > 0.8 ? ef * (1 - (speedRatio - 0.8) / 0.2) : ef;
			this.velocity.x += fwdX * limitedAccel * dt;
			this.velocity.z += fwdZ * limitedAccel * dt;
			this.state.throttle = 1;
			this.state.brake = 0;
		} else if (input.backward) {
			if (this.state.speed > 2) {
				// Brake
				const brakeDecel = this.config.brakeForce / this.config.mass;
				const fwdSpeed = this.velocity.x * fwdX + this.velocity.z * fwdZ;
				if (fwdSpeed > 0) {
					const brakeAmount = Math.min(brakeDecel * dt, fwdSpeed);
					this.velocity.x -= fwdX * brakeAmount;
					this.velocity.z -= fwdZ * brakeAmount;
				}
				this.state.brake = 1;
				this.state.throttle = 0;
			} else {
				// Reverse
				this.velocity.x -= fwdX * ef * 0.5 * dt;
				this.velocity.z -= fwdZ * ef * 0.5 * dt;
				this.state.throttle = 0.5;
				this.state.brake = 0;
			}
		} else {
			this.state.throttle = 0;
			this.state.brake = 0;
		}

		// Handbrake
		if (input.handbrake) {
			const brakeDecel = (this.config.brakeForce * 2) / this.config.mass;
			const fwdSpeed = this.velocity.x * fwdX + this.velocity.z * fwdZ;
			if (fwdSpeed > 0) {
				const brakeAmount = Math.min(brakeDecel * dt, fwdSpeed);
				this.velocity.x -= fwdX * brakeAmount;
				this.velocity.z -= fwdZ * brakeAmount;
			}
		}

		// ── Drag / friction ──
		// Simple linear drag (air resistance + rolling resistance)
		const dragCoeff = 0.3; // per second
		const drag = 1 - dragCoeff * dt;
		this.velocity.x *= drag;
		this.velocity.z *= drag;

		// Very slow → stop
		const hSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
		if (hSpeed < 0.1 && !input.forward && !input.backward) {
			this.velocity.x = 0;
			this.velocity.z = 0;
		}

		// ── Gravity ──
		this.velocity.y -= 9.82 * dt;

		// ── Apply velocity ──
		this.pos.x += this.velocity.x * dt;
		this.pos.y += this.velocity.y * dt;
		this.pos.z += this.velocity.z * dt;

		// ── Ground collision ──
		if (this.terrain) {
			const groundY = this.terrain.getHeight(this.pos.x, this.pos.z);
			const restHeight = this.config.wheelRadius + this.config.suspensionRestLength;

			if (this.pos.y < groundY + restHeight) {
				this.pos.y = groundY + restHeight;

				// Suspension spring: absorb impact, allow small bounce
				if (this.velocity.y < 0) {
					// Spring: push up proportional to penetration velocity
					const springForce = -this.velocity.y * this.config.suspensionStiffness * 0.01;
					this.velocity.y = Math.max(0, this.velocity.y + springForce * dt);

					// Damping: kill most downward velocity on contact
					this.velocity.y *= 0.1;
				}
				this.state.onGround = true;
			} else {
				this.state.onGround = false;
			}
		}

		// ── Update derived state ──
		// Speed = component of velocity along forward direction
		this.state.speed = this.velocity.x * fwdX + this.velocity.z * fwdZ;

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

		this.model.position.set(this.pos.x, this.pos.y, this.pos.z);
		this.model.quaternion.setFromEuler(new THREE.Euler(0, this.heading, 0));

		// Wheels: rotate them based on speed (spin) and steering angle
		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			// Steering: front wheels (0,1) rotate around Y
			if (i < 2) {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, this.currentSteeringAngle, 0));
			} else {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			}

			// Spin: rotate around local X axis based on speed
			const spinAngle = (this.state.speed / this.config.wheelRadius) * 0.016; // ~60fps
			const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spinAngle);
			mesh.quaternion.multiply(spinQ);
		}
	}

	getPosition(): { x: number; y: number; z: number } {
		return { ...this.pos };
	}

	getForward(): { x: number; y: number; z: number } {
		return {
			x: Math.sin(this.heading),
			y: 0,
			z: Math.cos(this.heading),
		};
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.pos = { x, y, z };
		this.heading = rotation;
		this.velocity = { x: 0, y: 0, z: 0 };
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

// Re-export for test compatibility
export const DEFAULT_INPUT_OBJ = DEFAULT_INPUT;
export const RACE_CAR_CONFIG = RACE_CAR;
