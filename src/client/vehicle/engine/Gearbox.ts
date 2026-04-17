/**
 * Gearbox — gear ratios, shift state machine, clutch simulation.
 *
 * Pure simulation module. No side effects.
 * VehiclePhysics drives this via update() each frame.
 */

import type { GearboxSpec } from "../configs.ts";
import type { Engine } from "./Engine.ts";

export interface GearboxConfig extends GearboxSpec {
	/** Computed downshift thresholds (km/h). Always set by factory. */
	readonly downshiftThresholds: number[];
}

export class Gearbox {
	private config: GearboxConfig;
	currentGear: number;
	private shiftTimer: number;
	isShifting: boolean;
	effectiveRatio: number;

	constructor(config: GearboxConfig) {
		this.config = config;
		this.currentGear = 0;
		this.shiftTimer = 0;
		this.isShifting = false;
		this.effectiveRatio = config.gearRatios[0];
	}

	get gearCount(): number {
		return this.config.gearRatios.length;
	}

	get currentRatio(): number {
		return this.config.gearRatios[this.currentGear] ?? this.config.gearRatios[this.config.gearRatios.length - 1];
	}

	update(dt: number, engine: Engine, wheelSpeed: number, isBraking: boolean): void {
		if (this.isShifting) {
			this.shiftTimer -= dt;
			if (this.shiftTimer <= 0) {
				this.isShifting = false;
				this.effectiveRatio = this.currentRatio;
			} else {
				const progress = 1 - this.shiftTimer / this.config.shiftTime;
				if (progress < 0.3) {
					this.effectiveRatio = this.currentRatio * (1 - progress / 0.3) * 0.5;
				} else {
					this.effectiveRatio = this.currentRatio * ((progress - 0.3) / 0.7);
				}
			}
			return;
		}

		if (engine.shouldUpshift() && this.currentGear < this.gearCount - 1) {
			this.startShift(this.currentGear + 1);
			this.effectiveRatio = this.currentRatio;
			return;
		}

		if (this.currentGear > 0) {
			if (isBraking && this.shouldDownshiftOnBrake(wheelSpeed)) {
				this.startShift(this.currentGear - 1);
			} else if (engine.shouldDownshift()) {
				this.startShift(this.currentGear - 1);
			}
		}

		this.effectiveRatio = this.currentRatio;
	}

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
