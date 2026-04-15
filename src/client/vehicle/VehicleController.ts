/**
 * VehicleController — proper bicycle-model car physics.
 *
 * Uses the dynamic bicycle model from vehicle dynamics:
 * - Slip angles computed at front and rear axles from local velocities
 * - Tire lateral forces via linear cornering stiffness, clamped to grip circle
 * - Yaw torque from front/rear lateral force differential × CG distances
 * - Weight transfer under longitudinal acceleration
 * - Ground collision via terrain.getHeight() sampling
 *
 * Coordinate convention:
 * - heading=0 → car faces +Z (matching GLTF model forward)
 * - +heading → CCW turn from top (left turn)
 * - local frame: X=forward, Y=lateral (right-positive)
 *
 * References:
 * - Marco Monster "Car Physics for Games" (tut05.pdf)
 * - Gillespie "Fundamentals of Vehicle Dynamics"
 * - https://www.xarg.org/book/vehicle-physics/
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

	// World-space state
	private posX = 0;
	private posY = 2;
	private posZ = 0;
	private heading = 0; // rad, 0 = +Z forward, positive = CCW from top

	// Local-frame velocities
	private localVelX = 0; // forward (along car heading)
	private localVelY = 0; // lateral (right-positive in car frame)
	private yawRate = 0; // rad/s

	// Steering
	private steerAngle = 0; // current wheel angle (rad)
	private readonly STEER_SPEED = 4.0; // rad/s interpolation rate

	// Gears
	private gearIndex = 0;

	// ── Derived geometry ──
	private readonly cgToAxleFront: number;
	private readonly cgToAxleRear: number;
	private readonly cgHeight: number;
	private readonly yawInertia: number;

	// ── Tire model ──
	private readonly cfFront: number; // cornering stiffness front (N/rad)
	private readonly cfRear: number; // cornering stiffness rear (N/rad)

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;

		// CG splits the wheelbase: 55% front, 45% rear
		const wb = config.wheelBase;
		this.cgToAxleFront = wb * 0.55;
		this.cgToAxleRear = wb * 0.45;
		this.cgHeight = config.wheelRadius * 1.5;

		// Yaw inertia (simplified point-mass approximation)
		this.yawInertia = config.mass * this.cgToAxleFront * this.cgToAxleRear;

		// Cornering stiffness: tuned for arcade feel
		// Real cars: ~50000-100000 N/rad per tire (mass ~1500kg)
		// Scaled down proportionally for our 150kg mass
		// Higher stiffness = more responsive steering, higher grip before sliding
		const base = config.frictionSlip * 400;
		this.cfFront = base;
		this.cfRear = base * 0.92; // slightly less rear grip → understeer bias
	}

	async loadModel(): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		this.model = gltf.scene;

		this.wheelMeshes = [];
		for (const name of [
			"wheel-front-left",
			"wheel-front-right",
			"wheel-back-left",
			"wheel-back-right",
		]) {
			const obj = this.model.getObjectByName(name);
			if (obj) this.wheelMeshes.push(obj);
		}
		return this.model;
	}

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);
		const { mass, wheelBase, wheelRadius } = this.config;

		// ═══════════════════════════════════════════════════════════
		// 1. STEERING — smooth input with speed-dependent max angle
		// ═══════════════════════════════════════════════════════════
		const speedKmh = Math.abs(this.localVelX) * 3.6;
		// Reduce max steer at high speed (realistic: less steering input needed)
		const speedReduction = Math.max(0.3, 1 - (speedKmh / 300) * 0.7);
		// Positive steerAngle = wheels point LEFT = car turns LEFT (CCW from top)
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * this.config.maxSteerAngle * speedReduction;

		// Smooth interpolation toward target
		const maxDelta = this.STEER_SPEED * dt;
		const steerDiff = targetSteer - this.steerAngle;
		if (Math.abs(steerDiff) < maxDelta) {
			this.steerAngle = targetSteer;
		} else {
			this.steerAngle += Math.sign(steerDiff) * maxDelta;
		}
		this.state.steeringAngle = this.steerAngle;

		// ═══════════════════════════════════════════════════════════
		// 2. WEIGHT DISTRIBUTION (static + transfer)
		// ═══════════════════════════════════════════════════════════
		const g = 9.82;
		const totalWeight = mass * g;
		// Longitudinal acceleration causes weight transfer
		// Accelerating → weight shifts rear, braking → shifts front
		const longAccel = input.forward
			? this.config.engineForce / mass
			: input.handbrake
				? -(this.config.brakeForce * 2) / mass
				: 0;
		const weightTransfer = (mass * longAccel * this.cgHeight) / wheelBase;
		const normalFront = Math.max(
			totalWeight * 0.1,
			(totalWeight * this.cgToAxleRear) / wheelBase - weightTransfer,
		);
		const normalRear = Math.max(
			totalWeight * 0.1,
			(totalWeight * this.cgToAxleFront) / wheelBase + weightTransfer,
		);

		// ═══════════════════════════════════════════════════════════
		// 3. SLIP ANGLES (bicycle model core)
		// ═══════════════════════════════════════════════════════════
		// Velocity at front axle in local frame
		const vFrontX = this.localVelX;
		const vFrontY = this.localVelY + this.yawRate * this.cgToAxleFront;
		// Velocity at rear axle in local frame
		const vRearX = this.localVelX;
		const vRearY = this.localVelY - this.yawRate * this.cgToAxleRear;

		// Slip angle = angle between tire heading and velocity vector
		// Front tire is steered, so we subtract steer angle
		// Only compute when car has meaningful forward speed
		let alphaFront = 0;
		if (Math.abs(this.localVelX) > 2.0) {
			alphaFront = Math.atan2(vFrontY, Math.abs(vFrontX)) - this.steerAngle;
		}
		let alphaRear = 0;
		if (Math.abs(this.localVelX) > 2.0) {
			alphaRear = Math.atan2(vRearY, Math.abs(vRearX));
		}

		// ═══════════════════════════════════════════════════════════
		// 4. TIRE LATERAL FORCES
		// ═══════════════════════════════════════════════════════════
		// Linear model: F = -Cα × α (force opposes slip)
		// The sign: positive alpha → tire pushed right → force acts LEFT → negative
		let fLatFront = -this.cfFront * alphaFront;
		let fLatRear = -this.cfRear * alphaRear;

		// Grip limit: tire can only generate μ × N lateral force
		const mu = this.config.frictionSlip;
		const maxGripFront = mu * normalFront;
		const maxGripRear = mu * normalRear;
		fLatFront = Math.max(-maxGripFront, Math.min(maxGripFront, fLatFront));
		fLatRear = Math.max(-maxGripRear, Math.min(maxGripRear, fLatRear));

		// Handbrake: rear wheels lock → lose most lateral grip
		if (input.handbrake) {
			fLatRear *= 0.2;
		}

		// ═══════════════════════════════════════════════════════════
		// 5. LONGITUDINAL FORCE
		// ═══════════════════════════════════════════════════════════
		let fLong = 0;

		if (input.forward) {
			fLong = this.config.engineForce;
			// Speed limiter: taper force above 80% maxSpeed
			const ratio = Math.abs(this.localVelX) / this.config.maxSpeed;
			if (ratio > 0.8) fLong *= 1 - (ratio - 0.8) / 0.2;
		} else if (input.backward) {
			if (this.localVelX > 1) {
				fLong = -this.config.brakeForce;
			} else {
				fLong = this.config.engineForce * 0.4; // reverse
			}
		}

		if (input.handbrake) {
			fLong -= this.config.brakeForce * 1.5;
		}

		// Rolling resistance + aero drag
		const drag = this.localVelX * (8 + Math.abs(this.localVelX) * 0.08);
		fLong -= drag;

		// ═══════════════════════════════════════════════════════════
		// 6. YAW TORQUE
		// ═══════════════════════════════════════════════════════════
		// Front lateral force acts at cgToAxleFront → positive = CCW torque
		// Rear lateral force acts at cgToAxleRear → negative = CW torque
		// Sign convention: positive torque = positive yaw rate = CCW = left turn
		const yawTorque =
			fLatFront * Math.cos(this.steerAngle) * this.cgToAxleFront - fLatRear * this.cgToAxleRear;

		// ═══════════════════════════════════════════════════════════
		// 7. INTEGRATE (local frame)
		// ═══════════════════════════════════════════════════════════
		// Longitudinal acceleration
		this.localVelX += (fLong / mass) * dt;

		// Lateral acceleration (from tire forces in local frame)
		const fLatTotal = fLatFront * Math.cos(this.steerAngle) + fLatRear;
		this.localVelY += (fLatTotal / mass) * dt;

		// Yaw acceleration
		this.yawRate += (yawTorque / this.yawInertia) * dt;

		// ── Damping ──
		// Yaw damping: prevents endless spinning
		this.yawRate *= 1 - 4.0 * dt;
		// Lateral velocity damping: tires resist sustained sliding
		this.localVelY *= 1 - 3.0 * dt;

		// Kill tiny values to prevent drift
		if (Math.abs(this.localVelX) < 0.01 && !input.forward && !input.backward) this.localVelX = 0;
		if (Math.abs(this.localVelY) < 0.005) this.localVelY = 0;
		if (Math.abs(this.yawRate) < 0.0005) this.yawRate = 0;

		// ═══════════════════════════════════════════════════════════
		// 8. LOCAL → WORLD conversion + position integration
		// ═══════════════════════════════════════════════════════════
		// heading=0 → car faces +Z
		// localX (forward) → world: (sin(h), 0, cos(h))
		// localY (lateral right) → world: (cos(h), 0, -sin(h))
		const sh = Math.sin(this.heading);
		const ch = Math.cos(this.heading);
		const worldVx = this.localVelX * sh + this.localVelY * ch;
		const worldVz = this.localVelX * ch - this.localVelY * sh;

		this.posX += worldVx * dt;
		this.posZ += worldVz * dt;

		// ── Gravity + ground collision ──
		this.posY -= 9.82 * dt * dt;
		if (this.terrain) {
			const groundY = this.terrain.getHeight(this.posX, this.posZ);
			const restH = wheelRadius + this.config.suspensionRestLength;
			if (this.posY < groundY + restH) {
				this.posY = groundY + restH;
			}
			this.state.onGround = this.posY <= groundY + restH + 0.2;
		}

		// ═══════════════════════════════════════════════════════════
		// 9. UPDATE HEADING
		// ═══════════════════════════════════════════════════════════
		this.heading += this.yawRate * dt;

		// ═══════════════════════════════════════════════════════════
		// 10. UPDATE OUTPUT STATE
		// ═══════════════════════════════════════════════════════════
		this.state.speed = this.localVelX;
		this.state.throttle = input.forward ? 1 : input.backward ? 0.5 : 0;
		this.state.brake = (input.backward && this.localVelX > 1) || input.handbrake ? 1 : 0;

		// Auto gear shift
		this.updateGear();

		// RPM from wheel speed × gear ratio
		const wheelHz = Math.abs(this.localVelX) / (wheelRadius * 2 * Math.PI);
		const gearRatio = this.config.gearRatios[this.gearIndex] || 1;
		this.state.rpm = Math.max(
			this.config.idleRPM,
			Math.min(wheelHz * 60 * gearRatio * 3.5, this.config.maxRPM),
		);
		// Rev at standstill with throttle
		if (this.state.throttle > 0 && Math.abs(this.localVelX) < 1) {
			this.state.rpm =
				this.config.idleRPM +
				this.state.throttle * (this.config.maxRPM - this.config.idleRPM) * 0.5;
		}
	}

	syncVisuals(): void {
		if (!this.model) return;

		this.model.position.set(this.posX, this.posY, this.posZ);
		this.model.quaternion.setFromEuler(new THREE.Euler(0, this.heading, 0));

		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			// Front wheels steer
			if (i < 2) {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, this.steerAngle, 0));
			} else {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			}

			// Wheel spin
			const spinAngle = (this.state.speed / this.config.wheelRadius) * 0.016;
			const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spinAngle);
			mesh.quaternion.multiply(spinQ);
		}
	}

	getPosition(): { x: number; y: number; z: number } {
		return { x: this.posX, y: this.posY, z: this.posZ };
	}

	getForward(): { x: number; y: number; z: number } {
		return { x: Math.sin(this.heading), y: 0, z: Math.cos(this.heading) };
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.posX = x;
		this.posY = y;
		this.posZ = z;
		this.heading = rotation;
		this.localVelX = 0;
		this.localVelY = 0;
		this.yawRate = 0;
		this.steerAngle = 0;
		this.gearIndex = 0;
		this.state.speed = 0;
		this.state.rpm = this.config.idleRPM;
		this.state.steeringAngle = 0;
		this.state.throttle = 0;
		this.state.brake = 0;
	}

	dispose(): void {}

	private updateGear(): void {
		if (this.state.speed < 0) {
			this.gearIndex = 0;
			return;
		}
		const ratios = this.config.gearRatios;
		if (this.state.rpm > this.config.maxRPM * 0.85 && this.gearIndex < ratios.length - 1) {
			this.gearIndex++;
		} else if (this.state.rpm < this.config.maxRPM * 0.3 && this.gearIndex > 0) {
			this.gearIndex--;
		}
	}
}
