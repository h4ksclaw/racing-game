/**
 * TireDynamics — realistic tire slip and handbrake drift simulation.
 *
 * Extends Rapier's DynamicRayCastVehicleController with:
 *   - Per-wheel lateral grip modulation (handbrake = locked rear wheels)
 *   - Weight transfer from suspension forces → dynamic grip scaling
 *   - Center-of-mass offset for FR/FF/MR car layouts
 *   - Slip-based grip model (simplified Pacejka-lite)
 *   - Oversteer torque from rear grip loss during handbrake
 *
 * All forces are applied as body impulses AFTER Rapier's vehicle step,
 * ensuring clean integration without hacking Rapier internals.
 */

import type { ChassisSpec, TireSpec } from "../configs.ts";

// ─── Types ─────────────────────────────────────────────────────────────

export interface WheelState {
	readonly index: number;
	readonly isFront: boolean;
	readonly isInContact: boolean;
	readonly suspensionForce: number; // N (downward)
	readonly forwardImpulse: number; // N (along car forward)
	readonly sideImpulse: number; // N (lateral)
	readonly contactPoint: { x: number; y: number; z: number } | null;
}

export interface TireDynamicsState {
	/** Per-wheel state snapshot (updated each frame after physics step) */
	readonly wheels: WheelState[];
	/** Total normal force across all wheels (N) */
	readonly totalLoad: number;
	/** Front axle normal force (N) */
	readonly frontLoad: number;
	/** Rear axle normal force (N) */
	readonly rearLoad: number;
	/** Whether handbrake drift is active */
	readonly isDrifting: boolean;
	/** Drift intensity 0-1 (how much rear grip is reduced) */
	readonly driftFactor: number;
	/** Rear grip multiplier (1.0 = full grip, lower = sliding) */
	readonly rearGripMultiplier: number;
	/** Center of mass in local chassis space */
	readonly localCOM: { x: number; y: number; z: number };
	/** Yaw torque applied by drift dynamics (Nm) */
	readonly driftYawTorque: number;
}

// ─── Configuration ─────────────────────────────────────────────────────

export interface TireDynamicsConfig {
	/** Chassis spec (mass, wheel positions, etc.) */
	readonly chassis: ChassisSpec;
	/** Tire spec (cornering stiffness, friction) */
	readonly tires: TireSpec;
	/** Wheel indices: [FL, FR, RL, RR] */
	readonly wheelIndices: { fl: number; fr: number; rl: number; rr: number };
}

// ─── Constants ─────────────────────────────────────────────────────────

/**
 * Handbrake rear grip reduction: locked wheels have very little cornering force.
 * Kinetic (sliding) friction << static (rolling) friction for rubber on asphalt.
 * Locked tires can't generate meaningful lateral force — they just slide.
 */
const HANDRAKE_LOCKED_REAR_GRIP = 0.05;

/**
 * Handbrake ramp time (seconds): rear grip doesn't drop instantly,
 * wheels need time to actually lock up (caliper pressure buildup).
 */
const HANDRAKE_LOCK_TIME = 0.15;

/**
 * Handbrake release ramp time (seconds): wheels take slightly longer
 * to regain grip (tire needs to start rolling again).
 */
const HANDRAKE_RELEASE_TIME = 0.3;

/**
 * Oversteer yaw torque scaling: when rear grip is reduced, the
 * front tires still generate lateral force but rears don't,
 * creating a yaw moment. This scales how aggressively the car rotates.
 */
const OVERSTEER_TORQUE_SCALE = 0.8;

/**
 * Speed threshold (m/s) below which handbrake has minimal effect.
 * At very low speeds, locked wheels just stop the car.
 */
const DRIFT_SPEED_THRESHOLD = 2.0;

/**
 * Maximum yaw rate clamp (rad/s) to prevent uncontrollable spin.
 * Real cars spin at roughly 1-3 rad/s during drifts.
 */
const MAX_YAW_RATE = 4.0;

/**
 * How much COM height affects weight transfer sensitivity.
 * Higher COM = more weight transfer under acceleration/braking.
 * (Reserved for future weight transfer simulation)
 */
// const COM_HEIGHT_TRANSFER_FACTOR = 0.6;

export class TireDynamics {
	private config: TireDynamicsConfig;

	// Runtime state
	private _rearGripMultiplier = 1.0;
	private _driftYawTorque = 0;
	private _wheelStates: WheelState[] = [];
	private _totalLoad = 0;
	private _frontLoad = 0;
	private _rearLoad = 0;
	private _localCOM = { x: 0, y: 0, z: 0 };
	private _handbrakeActive = false;
	private _handbrakeTimer = 0;

	constructor(config: TireDynamicsConfig) {
		this.config = config;
	}

	// ─── Per-frame update ───────────────────────────────────────────

	/**
	 * Read wheel states from Rapier's vehicle controller and compute
	 * tire dynamics forces. Call AFTER vehicle.updateVehicle() but
	 * BEFORE world.step() for grip modifications, or AFTER world.step()
	 * for force reads.
	 */
	readWheelStates(vehicle: {
		wheelIsInContact(i: number): boolean;
		wheelForwardImpulse(i: number): number | null;
		wheelSideImpulse(i: number): number | null;
		wheelSuspensionForce(i: number): number | null;
		wheelContactPoint(i: number): { x: number; y: number; z: number } | null;
	}): void {
		const { fl, fr, rl, rr } = this.config.wheelIndices;
		const indices = [
			{ idx: fl, front: true },
			{ idx: fr, front: true },
			{ idx: rl, front: false },
			{ idx: rr, front: false },
		];

		this._wheelStates = [];
		this._totalLoad = 0;
		this._frontLoad = 0;
		this._rearLoad = 0;

		for (const { idx, front } of indices) {
			const inContact = vehicle.wheelIsInContact(idx);
			const suspForce = vehicle.wheelSuspensionForce(idx) ?? 0;
			const fwdImpulse = vehicle.wheelForwardImpulse(idx) ?? 0;
			const sideImpulse = vehicle.wheelSideImpulse(idx) ?? 0;
			const contactPt = vehicle.wheelContactPoint(idx);

			const state: WheelState = {
				index: idx,
				isFront: front,
				isInContact: inContact,
				suspensionForce: Math.max(0, suspForce),
				forwardImpulse: fwdImpulse,
				sideImpulse: sideImpulse,
				contactPoint: contactPt,
			};

			this._wheelStates.push(state);
			this._totalLoad += state.suspensionForce;
			if (front) {
				this._frontLoad += state.suspensionForce;
			} else {
				this._rearLoad += state.suspensionForce;
			}
		}
	}

	/**
	 * Update handbrake state and compute rear grip multiplier.
	 * Call each frame with current handbrake input state and dt.
	 *
	 * @returns The rear grip multiplier to apply via setWheelSideFrictionStiffness
	 */
	updateHandbrake(handbrakeActive: boolean, _speedMs: number, dt: number): number {
		this._handbrakeActive = handbrakeActive;

		if (handbrakeActive) {
			// Ramp down rear grip — always, regardless of speed
			this._handbrakeTimer += dt;
			const t = Math.min(1, this._handbrakeTimer / HANDRAKE_LOCK_TIME);
			// Smooth ease-out curve for natural feel
			const ease = 1 - (1 - t) * (1 - t);
			this._rearGripMultiplier = 1 - ease * (1 - HANDRAKE_LOCKED_REAR_GRIP);
		} else {
			// Ramp back to full grip
			this._handbrakeTimer -= dt * (HANDRAKE_LOCK_TIME / HANDRAKE_RELEASE_TIME);
			this._handbrakeTimer = Math.max(0, this._handbrakeTimer);
			const t = Math.min(1, this._handbrakeTimer / HANDRAKE_LOCK_TIME);
			const ease = t * t; // ease-in for grip recovery
			this._rearGripMultiplier = 1 - ease * (1 - HANDRAKE_LOCKED_REAR_GRIP);
		}

		return this._rearGripMultiplier;
	}

	/**
	 * Compute drift yaw torque from asymmetric grip.
	 * When rear grip is reduced, front lateral forces create net yaw moment.
	 *
	 * @param speedMs - Current forward speed (m/s)
	 * @param yawRate - Current yaw rate (rad/s) from car body angular velocity
	 * @param steerAngle - Current steering angle (radians)
	 * @returns Yaw torque impulse to apply to the car body (Nm)
	 */
	computeDriftYawTorque(speedMs: number, yawRate: number, steerAngle: number): number {
		if (speedMs < DRIFT_SPEED_THRESHOLD) {
			this._driftYawTorque = 0;
			return 0;
		}

		const driftFactor = 1 - this._rearGripMultiplier;
		if (driftFactor < 0.05) {
			this._driftYawTorque = 0;
			return 0;
		}

		// Base oversteer torque from grip imbalance
		// Front tires generate lateral force, rears don't → car rotates
		const gripImbalance =
			this._frontLoad * this.config.tires.peakFriction -
			this._rearLoad * this.config.tires.peakFriction * this._rearGripMultiplier;

		// Scale by speed (more speed = more dramatic effect)
		const speedFactor = Math.min(1, speedMs / 15);

		// Steering direction determines rotation direction
		const steerSign = Math.sign(steerAngle);
		const steerFactor = Math.abs(steerAngle) / this.config.chassis.maxSteerAngle;

		// Compute raw torque (scaled by steering input amount)
		let torque = gripImbalance * driftFactor * speedFactor * steerSign * steerFactor * OVERSTEER_TORQUE_SCALE;

		// Counter-yaw damping: as yaw rate increases, reduce torque
		// This prevents infinite spin and makes drifts controllable
		const yawDamping = Math.max(0, 1 - Math.abs(yawRate) / MAX_YAW_RATE);
		torque *= yawDamping;

		// Clamp
		const maxTorque = this.config.chassis.mass * 9.81 * this.config.chassis.cgHeight * 0.5;
		torque = Math.max(-maxTorque, Math.min(maxTorque, torque));

		this._driftYawTorque = torque;
		return torque;
	}

	/**
	 * Compute center-of-mass offset for the chassis.
	 * For FR cars (engine front), COM is forward of geometric center.
	 * For MR/RR cars, COM is further back.
	 *
	 * Uses weightFront from config (0-1) and cgHeight.
	 */
	computeLocalCOM(): { x: number; y: number; z: number } {
		const { chassis } = this.config;
		const { halfExtents, wheelPositions, weightFront, cgHeight } = chassis;

		// Wheelbase: average distance between front and rear axle Z positions
		const frontZ = (wheelPositions[0].z + wheelPositions[1].z) / 2;
		const rearZ = (wheelPositions[2].z + wheelPositions[3].z) / 2;
		const wheelbase = frontZ - rearZ;

		// COM longitudinal position: weighted by weight distribution
		// weightFront = 0.55 means 55% of weight on front axle
		// COM is at: rearZ + wheelbase * weightFront (distance from rear axle)
		const wf = weightFront ?? 0.5;
		const comZ = rearZ + wheelbase * wf;

		// COM height: use cgHeight from config
		// Offset relative to chassis center (which is at origin)
		const comY = cgHeight - halfExtents[1];

		this._localCOM = { x: 0, y: comY, z: comZ };
		return this._localCOM;
	}

	// ─── State accessors ────────────────────────────────────────────

	get state(): TireDynamicsState {
		return {
			wheels: [...this._wheelStates],
			totalLoad: this._totalLoad,
			frontLoad: this._frontLoad,
			rearLoad: this._rearLoad,
			isDrifting: this._handbrakeActive && this._rearGripMultiplier < 0.8,
			driftFactor: 1 - this._rearGripMultiplier,
			rearGripMultiplier: this._rearGripMultiplier,
			localCOM: { ...this._localCOM },
			driftYawTorque: this._driftYawTorque,
		};
	}

	get rearGripMultiplier(): number {
		return this._rearGripMultiplier;
	}

	get wheelStates(): readonly WheelState[] {
		return this._wheelStates;
	}

	get totalLoad(): number {
		return this._totalLoad;
	}

	get frontLoad(): number {
		return this._frontLoad;
	}

	get rearLoad(): number {
		return this._rearLoad;
	}
}
