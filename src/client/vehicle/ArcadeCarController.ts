/**
 * ArcadeCarController — no physics engine, just terrain raycasting + car math.
 *
 * This is how most racing games actually work:
 * - Raycast down to terrain for ground contact
 * - Simple spring/damper suspension
 * - Velocity-based movement with steering
 * - No rigid body, no collision detection engine
 * - Just car physics math
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig, VehicleInput, VehicleState, WheelVisual } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR } from "./types.ts";

export interface TerrainProvider {
	getHeight(x: number, z: number): number;
	getNormal?(x: number, z: number): THREE.Vector3;
}

export class ArcadeCarController {
	// Car config
	private config: CarConfig;

	// Visual
	model: THREE.Group | null = null;
	private wheelMeshes: THREE.Object3D[] = [];

	// State
	state: VehicleState = {
		speed: 0,
		rpm: 800,
		gear: 0,
		steeringAngle: 0,
		throttle: 0,
		brake: 0,
		onGround: true,
	};

	// Position & orientation
	position = new THREE.Vector3(0, 2, 0);
	rotation = 0; // Y-axis rotation (heading)
	velocity = new THREE.Vector3(0, 0, 0);
	angularVelocity = 0;

	// Suspension
	private suspensionLength = 0.35;
	private suspensionStiffness = 80;
	private suspensionDamping = 12;
	private wheelContact = [false, false, false, false];
	private wheelCompression = [0, 0, 0, 0];

	// Terrain
	private terrain: TerrainProvider | null = null;

	// Gears
	private currentGearIndex = 0;

	// Steering smoothing
	private currentSteer = 0;

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
		if (!this.terrain) return;

		// ── Steering ──
		const speedFactor = 1 - (Math.abs(this.state.speed) / this.config.maxSpeed) * 0.6;
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedFactor;
		this.currentSteer += (targetSteer - this.currentSteer) * Math.min(1, 10 * dt);
		this.state.steeringAngle = this.currentSteer;

		// ── Engine / Brake ──
		const wantForward = input.forward;
		const wantBackward = input.backward || input.brake;

		if (wantForward) {
			const gearMult = 1 / (this.config.gearRatios[this.currentGearIndex] * 0.6 + 0.4);
			const force = this.config.engineForce * gearMult;
			// Apply force in forward direction
			const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));
			this.velocity.x += forward.x * force * dt;
			this.velocity.z += forward.z * force * dt;
			this.state.throttle = 1;
			this.state.brake = 0;
		} else if (wantBackward) {
			if (this.state.speed > 2) {
				// Brake
				this.velocity.x *= Math.max(0, 1 - 5 * dt);
				this.velocity.z *= Math.max(0, 1 - 5 * dt);
				this.state.brake = 1;
				this.state.throttle = 0;
			} else {
				// Reverse
				const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));
				this.velocity.x -= forward.x * this.config.engineForce * 0.4 * dt;
				this.velocity.z -= forward.z * this.config.engineForce * 0.4 * dt;
				this.state.throttle = 0.5;
				this.state.brake = 0;
			}
		} else {
			this.state.throttle = 0;
			this.state.brake = 0;
			// Engine braking / drag
			this.velocity.x *= Math.max(0, 1 - 1.5 * dt);
			this.velocity.z *= Math.max(0, 1 - 1.5 * dt);
		}

		// Handbrake
		if (input.handbrake) {
			this.velocity.x *= Math.max(0, 1 - 8 * dt);
			this.velocity.z *= Math.max(0, 1 - 8 * dt);
		}

		// Air drag (quadratic)
		const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
		if (speed > 0.1) {
			const dragForce = 0.0005 * speed * speed;
			const drag = Math.min(1, (dragForce * dt) / speed);
			this.velocity.x *= 1 - drag;
			this.velocity.z *= 1 - drag;
		}

		// Speed cap
		if (speed > this.config.maxSpeed) {
			const scale = this.config.maxSpeed / speed;
			this.velocity.x *= scale;
			this.velocity.z *= scale;
		}

		// ── Turning ──
		if (speed > 0.5 && this.state.onGround) {
			// Bicycle model steering
			const steerAngle = this.currentSteer;
			const turnRadius = this.config.wheelBase / Math.tan(Math.abs(steerAngle) + 0.001);
			const angularSpeed = (speed / turnRadius) * Math.sign(steerAngle);

			// Handbrake = more aggressive turn
			const handbrakeMult = input.handbrake ? 2.5 : 1;

			this.angularVelocity = angularSpeed * handbrakeMult;
			this.rotation += this.angularVelocity * dt;

			// Rotate velocity to match new heading
			const rotAmount = this.angularVelocity * dt;
			const cos = Math.cos(rotAmount);
			const sin = Math.sin(rotAmount);
			const vx = this.velocity.x * cos - this.velocity.z * sin;
			const vz = this.velocity.x * sin + this.velocity.z * cos;
			this.velocity.x = vx;
			this.velocity.z = vz;
		} else {
			this.angularVelocity *= 0.9;
		}

		// ── Terrain / Suspension ──
		const groundY = this.terrain.getHeight(this.position.x, this.position.z);
		const restY = groundY + this.config.wheelRadius + this.suspensionLength;

		// Simple spring-damper for vertical
		const springError = restY - this.position.y;
		const springForce = springError * this.suspensionStiffness;
		const damperForce = -this.velocity.y * this.suspensionDamping;
		const totalForce = springForce + damperForce;

		// Only push up (terrain supports, doesn't pull)
		this.velocity.y += Math.max(0, totalForce) * dt;
		this.velocity.y -= 9.82 * dt; // gravity

		// Prevent sinking
		if (this.position.y < groundY + this.config.wheelRadius) {
			this.position.y = groundY + this.config.wheelRadius;
			if (this.velocity.y < 0) this.velocity.y = 0;
		}

		this.state.onGround = this.position.y < restY + 0.5;

		// ── Apply velocity ──
		this.position.x += this.velocity.x * dt;
		this.position.y += this.velocity.y * dt;
		this.position.z += this.velocity.z * dt;

		// ── Update state ──
		const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));
		this.state.speed = this.velocity.x * forward.x + this.velocity.z * forward.z;

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

		// Update wheel visuals
		for (let i = 0; i < this.wheelMeshes.length; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			// Spin wheel
			const spinSpeed = this.state.speed / this.config.wheelRadius;
			mesh.rotation.x += spinSpeed * dt;

			// Steer front wheels
			if (i < 2) {
				mesh.rotation.y = this.currentSteer;
			}
		}
	}

	syncVisuals(): void {
		if (!this.model) return;
		this.model.position.copy(this.position);
		this.model.rotation.set(0, this.rotation, 0);

		// Body roll (visual only)
		if (Math.abs(this.angularVelocity) > 0.1) {
			const rollAngle = -this.angularVelocity * 0.03;
			this.model.rotation.z = rollAngle;
		} else {
			this.model.rotation.z *= 0.9;
		}

		// Sync wheel transforms (for models where wheels are in world space)
		for (let i = 0; i < 4; i++) {
			this.updateWheelTransform(i);
		}
	}

	getPosition(): { x: number; y: number; z: number } {
		return { x: this.position.x, y: this.position.y, z: this.position.z };
	}

	getForward(): { x: number; y: number; z: number } {
		return {
			x: Math.sin(this.rotation),
			y: 0,
			z: Math.cos(this.rotation),
		};
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.position.set(x, y, z);
		this.rotation = rotation;
		this.velocity.set(0, 0, 0);
		this.angularVelocity = 0;
		this.currentSteer = 0;
		this.state.speed = 0;
		this.state.rpm = this.config.idleRPM;
		this.currentGearIndex = 0;
	}

	dispose(): void {
		// Nothing to clean up — no physics world
	}

	private updateWheelTransform(index: number): void {
		if (!this.model || !this.wheelMeshes[index]) return;

		const wp = this.config.wheelPositions[index];
		if (!wp) return;

		// Wheel position in car local space
		const localPos = new THREE.Vector3(wp.x, wp.y, wp.z);

		// Transform to world space
		const cos = Math.cos(this.rotation);
		const sin = Math.sin(this.rotation);
		const worldX = this.position.x + localPos.x * cos - localPos.z * sin;
		const worldZ = this.position.z + localPos.x * sin + localPos.z * cos;
		const worldY = this.position.y + localPos.y;

		this.wheelMeshes[index].position.set(worldX, worldY, worldZ);
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
