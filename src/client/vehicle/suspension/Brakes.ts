/**
 * Brakes — g-based deceleration, handbrake, rear grip reduction.
 *
 * Pure simulation module. No side effects.
 */

import type { BrakeSpec } from "../configs.ts";

export interface BrakeConfig extends BrakeSpec {}

export class Brakes {
	private config: BrakeConfig;
	isBraking: boolean;
	isHandbrake: boolean;
	brakePressure: number;

	constructor(config: BrakeConfig) {
		this.config = config;
		this.isBraking = false;
		this.isHandbrake = false;
		this.brakePressure = 0;
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

	/** Snap speed to zero if brake would reverse it. Call after integrating. */
	applyResult(speed: number): number {
		if (this.brakePressure > 0 && speed < 0) return 0;
		return speed;
	}

	get rearGripFactor(): number {
		return this.isHandbrake ? 0.2 : 1.0;
	}
}
