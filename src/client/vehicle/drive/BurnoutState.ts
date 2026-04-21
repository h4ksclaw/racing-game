/**
 * BurnoutState — clutch-dump burnout state machine.
 *
 * Trigger: hold space (handbrake) + press W → release space = clutch dump.
 * Works at any speed (stopped or moving).
 *
 * Philosophy: burnout exists in the torque-exceeds-grip window.
 * - Reduce driven wheel friction slip so tires spin
 * - Gearbox auto-shifts normally
 * - Burnout ends when the simulation says traction should catch:
 *   either gear changed (torque drops) or engine can't overcome traction
 * - Side friction is NOT touched — car stays stable, goes straight
 *
 * The end condition is physics-derived:
 *   wheel_torque = engineTorque × gearRatio × finalDrive / wheelRadius
 *   max_grip    = mass × tractionPct × g × frictionSlip
 *   Burnout viable when wheel_torque > max_grip × BURNOUT_CATCH_FACTOR
 *
 * This means burnout naturally ends when:
 * - Gearbox upshifts (lower gear ratio → less wheel torque)
 * - Engine RPM drops below torque band
 * - Car is going fast enough that traction exceeds torque
 */

/** Friction slip multiplier on driven wheels during burnout (0-1). Lower = more spin. */
const BURNOUT_TRACTION_MUL = 0.15;
/** Wheel overspin multiplier for visual spin */
const BURNOUT_OVERSPIN = 3.0;
/** Fade time (s) for traction to return to normal after burnout ends */
const BURNOUT_FADE_TIME = 0.4;
/**
 * Fraction of max grip below which burnout can sustain.
 * wheel_torque must exceed max_grip × this factor, otherwise traction catches.
 * 0.7 = burnout ends when torque is within 70% of max possible traction.
 */
const BURNOUT_CATCH_FACTOR = 0.7;
/** Gravity for grip calculation */
const G = 9.82;

export type DrivetrainType = "FWD" | "RWD" | "AWD";

export interface BurnoutStateResult {
	/** Whether burnout is currently active */
	active: boolean;
	/** Whether we're in the "rev in neutral" phase (space held + W) */
	revvingInNeutral: boolean;
	/** Per-wheel traction multiplier (1.0 = normal, applied to friction slip only) */
	tractionMul: number[];
	/** Per-wheel overspin factor for visual wheel spin (1.0 = matched to ground) */
	overspin: number[];
}

export interface BurnoutEngineParams {
	/** Current effective gear ratio (after any shift interpolation) */
	gearRatio: number;
	/** Engine torque at current RPM (Nm) */
	engineTorqueNm: number;
	/** Final drive ratio */
	finalDrive: number;
	/** Wheel radius (m) */
	wheelRadius: number;
	/** Vehicle mass (kg) */
	mass: number;
	/** Traction percentage (0-1) — fraction of weight available as grip */
	tractionPct: number;
	/** 1-based current gear index — used to detect upshifts */
	currentGear: number;
}

export class BurnoutState {
	private _active = false;
	private _revvingInNeutral = false;
	private _wasHandbrakeHeld = false;
	private _wasThrottleHeld = false;
	private _fadeTimer = 0;
	private _fading = false;
	/** Gear at the moment burnout activated — burnout ends on upshift */
	private _launchGear = 0;

	/**
	 * Update burnout state machine.
	 *
	 * @param handbrake Current handbrake input
	 * @param throttle Whether W is held
	 * @param speedMs Current car speed (m/s, absolute) — unused, kept for API compat
	 * @param dt Frame delta (seconds)
	 * @param drivetrain Car drivetrain config
	 * @param engine Engine parameters for physics-based end detection
	 */
	update(
		handbrake: boolean,
		throttle: boolean,
		_speedMs: number,
		dt: number,
		drivetrain: DrivetrainType = "RWD",
		engine: BurnoutEngineParams,
	): BurnoutStateResult {
		// ── Phase 1: Rev in neutral (space + W held) ──
		if (handbrake && throttle && !this._fading) {
			this._revvingInNeutral = true;
			this._wasHandbrakeHeld = true;
			this._wasThrottleHeld = true;
			this._active = false;
			return this.buildResult(drivetrain);
		}

		// ── Phase 2: Clutch dump (space released while W held, was revving) ──
		if (!handbrake && throttle && this._wasHandbrakeHeld && this._wasThrottleHeld && !this._active && !this._fading) {
			this._active = true;
			this._revvingInNeutral = false;
			this._fadeTimer = 0;
			this._fading = false;
			this._launchGear = engine.currentGear;
		}

		// ── Track input state for trigger detection ──
		this._wasHandbrakeHeld = handbrake;
		if (!throttle) {
			this._wasThrottleHeld = false;
		}

		// ── Revving ends when W released ──
		if (this._revvingInNeutral && !throttle) {
			this._revvingInNeutral = false;
		}

		// ── Burnout end: W released → fade out ──
		if (this._active && !throttle) {
			this._fading = true;
		}

		// ── Burnout end: gear changed (upshift = less torque = traction catches) ──
		if (this._active && !this._fading && engine.currentGear > this._launchGear) {
			this._fading = true;
		}

		// ── Burnout end: physics says traction caught ──
		// Torque at wheel can no longer overcome grip in current gear
		if (this._active && !this._fading && this.shouldTractionCatch(engine)) {
			this._fading = true;
		}

		// ── Fade out ──
		if (this._fading) {
			this._fadeTimer += dt;
			if (this._fadeTimer > BURNOUT_FADE_TIME) {
				this.end();
			}
		}

		return this.buildResult(drivetrain);
	}

	/**
	 * Check if engine torque in current gear can no longer sustain wheel spin.
	 * wheel_torque = engineTorque × gearRatio × finalDrive / wheelRadius
	 * max_grip    = mass × tractionPct × G
	 * Burnout viable when wheel_torque > max_grip × CATCH_FACTOR
	 */
	private shouldTractionCatch(engine: BurnoutEngineParams): boolean {
		if (engine.gearRatio < 0.1) return true; // Neutral — no drive

		const wheelTorque = (engine.engineTorqueNm * engine.gearRatio * engine.finalDrive) / engine.wheelRadius;
		const maxGrip = engine.mass * engine.tractionPct * G;
		return wheelTorque < maxGrip * BURNOUT_CATCH_FACTOR;
	}

	private buildResult(drivetrain: DrivetrainType): BurnoutStateResult {
		const isRear = drivetrain === "RWD" || drivetrain === "AWD";
		const isFront = drivetrain === "FWD" || drivetrain === "AWD";

		let tractionMul: number;
		let overspinFactor: number;

		if (this._fading && this._fadeTimer > 0) {
			const fade = Math.max(0, 1 - this._fadeTimer / BURNOUT_FADE_TIME);
			tractionMul = 1 - (1 - BURNOUT_TRACTION_MUL) * fade;
			overspinFactor = 1 + (BURNOUT_OVERSPIN - 1) * fade;
		} else if (this._active) {
			tractionMul = BURNOUT_TRACTION_MUL;
			overspinFactor = BURNOUT_OVERSPIN;
		} else {
			tractionMul = 1.0;
			overspinFactor = 1.0;
		}

		return {
			active: this._active,
			revvingInNeutral: this._revvingInNeutral,
			tractionMul: [
				isFront ? tractionMul : 1.0,
				isFront ? tractionMul : 1.0,
				isRear ? tractionMul : 1.0,
				isRear ? tractionMul : 1.0,
			],
			overspin: [
				isFront ? overspinFactor : 1.0,
				isFront ? overspinFactor : 1.0,
				isRear ? overspinFactor : 1.0,
				isRear ? overspinFactor : 1.0,
			],
		};
	}

	/** Force-end burnout (crash, reset, etc.) */
	end(): void {
		this._active = false;
		this._revvingInNeutral = false;
		this._fadeTimer = 0;
		this._fading = false;
		this._wasHandbrakeHeld = false;
		this._wasThrottleHeld = false;
	}

	get active(): boolean {
		return this._active;
	}

	get revvingInNeutral(): boolean {
		return this._revvingInNeutral;
	}
}
