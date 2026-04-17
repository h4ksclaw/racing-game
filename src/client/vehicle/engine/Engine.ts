/**
 * Engine — RPM, torque curve, throttle, rev limiter.
 *
 * Pure simulation module. No side effects, no DOM, no audio.
 * VehiclePhysics drives this via update() each frame.
 */

import type { EngineSpec } from "../configs.ts";

export interface EngineConfig extends EngineSpec {}

export class Engine {
	readonly config: EngineConfig;
	rpm: number;
	throttle: number;
	revLimited: boolean;
	load: number;

	constructor(config: EngineConfig) {
		this.config = config;
		this.rpm = config.idleRPM;
		this.throttle = 0;
		this.revLimited = false;
		this.load = 0;
	}

	/** Get torque multiplier at current RPM by interpolating the torque curve. */
	getTorqueMultiplier(): number {
		const curve = this.config.torqueCurve;
		if (curve.length === 0) return 1;

		if (this.rpm <= curve[0][0]) return curve[0][1];
		if (this.rpm >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

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

		if (Math.abs(wheelSpeed) < 0.5 && this.throttle > 0) {
			const revRPM = this.config.idleRPM + this.throttle * (this.config.maxRPM - this.config.idleRPM) * 0.6;
			this.rpm += (revRPM - this.rpm) * Math.min(1, 10 * dt);
			this.revLimited = false;
		} else {
			const drivenRPM = Math.max(this.config.idleRPM, targetRPM);
			this.rpm += (drivenRPM - this.rpm) * Math.min(1, 8.0 * dt);
		}

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
		const force = (this.config.torqueNm * torqueMult * totalRatio) / wheelRadius;

		return Math.min(force, tractionLimit);
	}

	/** Engine braking force (N) — retards car when off-throttle. */
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
