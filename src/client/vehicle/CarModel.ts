/**
 * Car simulation modules — engine, gearbox, brakes, tires, drag.
 *
 * Each module is a pure class with clear inputs/outputs.
 * VehicleController orchestrates them.
 *
 * Architecture:
 *   VehicleController (orchestrator)
 *     ├── Engine      (RPM, torque curve, throttle, rev limiter)
 *     ├── Gearbox     (gear ratios, shift logic, clutch simulation)
 *     ├── Brakes      (g-based deceleration, handbrake)
 *     ├── TireModel   (slip angles, lateral forces, grip circle)
 *     └── DragModel   (rolling resistance + aerodynamic drag)
 *
 * buildCarModel(config) wires a CarConfig into these modules.
 * Every tuning parameter comes from config — zero hardcoded values.
 */

import type { BrakeSpec, CarConfig, DragSpec, EngineSpec, GearboxSpec, TireSpec } from "./types.ts";

// ─── Engine ─────────────────────────────────────────────────────────────

export interface EngineConfig extends EngineSpec {}

export class Engine {
	readonly config: EngineConfig;
	rpm: number = 0;
	throttle: number = 0;
	revLimited: boolean = false;

	constructor(config: EngineConfig) {
		this.config = config;
		this.rpm = config.idleRPM;
	}

	/** Get torque multiplier at current RPM by interpolating the torque curve */
	getTorqueMultiplier(): number {
		const curve = this.config.torqueCurve;
		if (curve.length === 0) return 1;

		// Below curve range → use first point
		if (this.rpm <= curve[0][0]) return curve[0][1];
		// Above curve range → use last point
		if (this.rpm >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

		// Find the two bracketing points and lerp
		for (let i = 0; i < curve.length - 1; i++) {
			if (this.rpm >= curve[i][0] && this.rpm <= curve[i + 1][0]) {
				const range = curve[i + 1][0] - curve[i][0];
				if (range < 1) return curve[i + 1][1];
				const t = (this.rpm - curve[i][0]) / range;
				return curve[i][1] + (curve[i + 1][1] - curve[i][1]) * t;
			}
		}
		return 1;
	}

	/**
	 * Update RPM from wheel speed through drivetrain.
	 * Rev limiter: when RPM hits maxRPM, engine provides no force.
	 */
	update(wheelSpeed: number, gearRatio: number, wheelRadius: number, dt: number): void {
		const wheelRPM = (Math.abs(wheelSpeed) / (2 * Math.PI * wheelRadius)) * 60;
		const targetRPM = wheelRPM * gearRatio * this.config.finalDrive;

		// At standstill with throttle: rev against clutch slip
		if (Math.abs(wheelSpeed) < 0.5 && this.throttle > 0) {
			const revRPM =
				this.config.idleRPM + this.throttle * (this.config.maxRPM - this.config.idleRPM) * 0.6;
			this.rpm += (revRPM - this.rpm) * Math.min(1, 10 * dt);
			this.revLimited = false;
		} else {
			const drivenRPM = Math.max(this.config.idleRPM, targetRPM);
			this.rpm += (drivenRPM - this.rpm) * Math.min(1, 8.0 * dt);
		}

		// Rev limiter
		if (this.rpm >= this.config.maxRPM) {
			this.rpm = this.config.maxRPM;
			this.revLimited = true;
		} else {
			this.revLimited = false;
		}

		this.rpm = Math.max(this.config.idleRPM * 0.8, this.rpm);
	}

	/**
	 * Get engine output force at the wheels (N).
	 * Returns 0 when rev-limited or no throttle.
	 */
	getWheelForce(gearRatio: number, wheelRadius: number, tractionLimit: number): number {
		if (this.revLimited || this.throttle < 0.01) return 0;

		const torqueMult = this.getTorqueMultiplier();
		const totalRatio = gearRatio * this.config.finalDrive;
		let force = (this.config.torqueNm * torqueMult * totalRatio) / wheelRadius;

		// Traction limit
		force = Math.min(force, tractionLimit);

		return force;
	}

	/** Engine braking force (N) — retards car when off-throttle */
	getEngineBraking(wheelSpeed: number, mass: number): number {
		if (this.throttle > 0.1 || Math.abs(wheelSpeed) < 1) return 0;
		return this.config.engineBraking * (this.rpm / this.config.maxRPM) * mass;
	}

	shouldUpshift(): boolean {
		return this.rpm > this.config.maxRPM * this.config.redlinePct;
	}

	shouldDownshift(): boolean {
		return this.rpm < this.config.idleRPM * 1.3;
	}
}

// ─── Gearbox ───────────────────────────────────────────────────────────

export interface GearboxConfig extends GearboxSpec {
	/** Computed downshift thresholds (km/h). Always set by factory. */
	readonly downshiftThresholds: number[];
}

export class Gearbox {
	private config: GearboxConfig;
	currentGear: number = 0;
	private shiftTimer: number = 0;
	isShifting: boolean = false;
	effectiveRatio: number = 0;

	constructor(config: GearboxConfig) {
		this.config = config;
		this.effectiveRatio = config.gearRatios[0];
	}

	get gearCount(): number {
		return this.config.gearRatios.length;
	}

	get currentRatio(): number {
		return (
			this.config.gearRatios[this.currentGear] ??
			this.config.gearRatios[this.config.gearRatios.length - 1]
		);
	}

	/**
	 * Update gearbox state.
	 * @param dt Time step
	 * @param engine Engine module (for RPM)
	 * @param wheelSpeed Forward speed in m/s
	 * @param isBraking Whether the car is actively braking
	 */
	update(dt: number, engine: Engine, wheelSpeed: number, isBraking: boolean): void {
		if (this.isShifting) {
			this.shiftTimer -= dt;
			if (this.shiftTimer <= 0) {
				this.isShifting = false;
				this.effectiveRatio = this.currentRatio;
			} else {
				const progress = 1 - this.shiftTimer / this.config.shiftTime;
				if (progress < 0.3) {
					// Clutch disengaging
					this.effectiveRatio = this.currentRatio * (1 - progress / 0.3) * 0.5;
				} else {
					// Clutch engaging on new gear
					this.effectiveRatio = this.currentRatio * ((progress - 0.3) / 0.7);
				}
			}
			return;
		}

		// Upshift: RPM-based
		if (engine.shouldUpshift() && this.currentGear < this.gearCount - 1) {
			this.startShift(this.currentGear + 1);
			this.effectiveRatio = this.currentRatio;
			return;
		}

		// Downshift: speed-based when braking, RPM-based when coasting
		if (this.currentGear > 0) {
			if (isBraking && this.shouldDownshiftOnBrake(wheelSpeed)) {
				this.startShift(this.currentGear - 1);
			} else if (engine.shouldDownshift()) {
				this.startShift(this.currentGear - 1);
			}
		}

		this.effectiveRatio = this.currentRatio;
	}

	/**
	 * Downshift while braking: drop gears to keep RPM in a useful band.
	 * Uses thresholds from config (computed from gear ratios by factory).
	 */
	private shouldDownshiftOnBrake(wheelSpeed: number): boolean {
		if (this.currentGear <= 0) return false;
		const speedKmh = Math.abs(wheelSpeed) * 3.6;
		return speedKmh < this.config.downshiftThresholds[this.currentGear];
	}

	private startShift(newGear: number): void {
		this.currentGear = newGear;
		this.isShifting = true;
		this.shiftTimer = this.config.shiftTime;
	}
}

// ─── Brakes ────────────────────────────────────────────────────────────

export interface BrakeConfig extends BrakeSpec {}

export class Brakes {
	private config: BrakeConfig;
	isBraking: boolean = false;
	isHandbrake: boolean = false;
	brakePressure: number = 0;

	constructor(config: BrakeConfig) {
		this.config = config;
	}

	getForce(mass: number): number {
		this.brakePressure = 0;

		if (this.isHandbrake) {
			this.brakePressure = 1;
			return -mass * this.config.handbrakeG * 9.82;
		}

		if (this.isBraking) {
			this.brakePressure = 1;
			return -mass * this.config.maxBrakeG * 9.82;
		}

		return 0;
	}

	/**
	 * Apply brake result — snaps speed to zero if brake would reverse it.
	 * Call this after integrating forces.
	 */
	applyResult(speed: number): number {
		if (this.brakePressure > 0 && speed < 0) return 0;
		return speed;
	}

	get rearGripFactor(): number {
		return this.isHandbrake ? 0.2 : 1.0;
	}
}

// ─── TireModel ─────────────────────────────────────────────────────────

export interface TireConfig extends TireSpec {
	/** Computed max traction force (N) — set by factory from mass × tractionPct */
	readonly maxTraction: number;
}

export interface TireForces {
	longitudinal: number;
	lateral: number;
	frontLateral: number;
	rearLateral: number;
	yawTorque: number;
}

export class TireModel {
	readonly config: TireConfig;

	constructor(config: TireConfig) {
		this.config = config;
	}

	compute(
		localVelX: number,
		localVelY: number,
		yawRate: number,
		steerAngle: number,
		cgToFront: number,
		cgToRear: number,
		normalFront: number,
		normalRear: number,
		rearGripFactor: number,
	): TireForces {
		const vFrontY = localVelY + yawRate * cgToFront;
		const vRearY = localVelY - yawRate * cgToRear;

		let alphaFront = 0;
		let alphaRear = 0;
		if (Math.abs(localVelX) > 1.0) {
			alphaFront = Math.atan2(vFrontY, Math.abs(localVelX)) - steerAngle;
			alphaRear = Math.atan2(vRearY, Math.abs(localVelX));
		}

		let fLatFront = -this.config.corneringStiffnessFront * alphaFront;
		let fLatRear = -this.config.corneringStiffnessRear * alphaRear * rearGripFactor;

		const mu = this.config.peakFriction;
		fLatFront = Math.max(-mu * normalFront, Math.min(mu * normalFront, fLatFront));
		fLatRear = Math.max(-mu * normalRear, Math.min(mu * normalRear, fLatRear));

		const fLatTotal = fLatFront * Math.cos(steerAngle) + fLatRear;
		const yawTorque = fLatFront * Math.cos(steerAngle) * cgToFront - fLatRear * cgToRear;

		return {
			longitudinal: 0,
			lateral: fLatTotal,
			frontLateral: fLatFront,
			rearLateral: fLatRear,
			yawTorque,
		};
	}
}

// ─── DragModel ─────────────────────────────────────────────────────────

export interface DragConfig extends DragSpec {}

export class DragModel {
	private config: DragConfig;

	constructor(config: DragConfig) {
		this.config = config;
	}

	/** Get drag force (N). Always opposes motion. */
	getForce(speed: number): number {
		return this.config.rollingResistance * speed + this.config.aeroDrag * speed * speed;
	}
}

// ─── CarModel Factory ──────────────────────────────────────────────────

export interface CarModel {
	readonly engine: Engine;
	readonly gearbox: Gearbox;
	readonly brakes: Brakes;
	readonly tires: TireModel;
	readonly drag: DragModel;
	readonly config: CarConfig;
}

/**
 * Build a complete CarModel from a CarConfig.
 * Pure wiring — every value comes from config, no magic numbers.
 */
export function buildCarModel(config: CarConfig): CarModel {
	// ── Gearbox (needs computed downshift thresholds) ──
	const downshiftThresholds = computeDownshiftThresholds(config);

	const gearboxConfig: GearboxConfig = {
		gearRatios: config.gearbox.gearRatios,
		shiftTime: config.gearbox.shiftTime,
		downshiftThresholds,
	};

	// ── Tires (compute max traction from chassis mass) ──
	const tireConfig: TireConfig = {
		...config.tires,
		maxTraction: config.chassis.mass * config.tires.tractionPct * 9.82,
	};

	return {
		engine: new Engine(config.engine),
		gearbox: new Gearbox(gearboxConfig),
		brakes: new Brakes(config.brakes),
		tires: new TireModel(tireConfig),
		drag: new DragModel(config.drag),
		config,
	};
}

/**
 * Compute downshift thresholds from gear ratios and engine spec.
 * For each gear N, the threshold is the speed (km/h) at which
 * gear N-1 would reach the redline RPM.
 *
 * This keeps RPM in a useful band during braking without
 * requiring manual threshold tuning per car.
 */
function computeDownshiftThresholds(config: CarConfig): number[] {
	const { gearRatios } = config.gearbox;
	const { finalDrive, maxRPM, redlinePct } = config.engine;
	const wheelRadius = config.chassis.wheelRadius;
	const redlineRPM = maxRPM * redlinePct;

	// Speed at redline for a given gear ratio:
	// v = (RPM / (ratio × finalDrive × 60)) × 2π × radius
	const redlineSpeed = (ratio: number): number => {
		return (redlineRPM / (ratio * finalDrive * 60)) * 2 * Math.PI * wheelRadius * 3.6;
	};

	// thresholds[N] = speed where gear N-1 hits redline
	// gear 0 can't downshift, so thresholds[0] = 0
	const thresholds: number[] = [0];
	for (let i = 1; i < gearRatios.length; i++) {
		thresholds.push(redlineSpeed(gearRatios[i - 1]));
	}

	return thresholds;
}
