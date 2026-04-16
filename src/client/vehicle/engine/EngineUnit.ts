/**
 * EngineUnit — Engine + Gearbox as one swap-able unit.
 *
 * This is the atomic powertrain. A car can hot-swap its engine unit
 * (e.g., swap a NA 4A-GE for a turbo 4A-GTE) without touching
 * chassis, suspension, or body.
 *
 * The unit does NOT know about wheels, chassis, or world.
 * VehiclePhysics calls update() and reads telemetry.
 */

import type { EngineSpec, GearboxSpec } from "../configs.ts";
import type { EngineTelemetry } from "../types.ts";
import { Engine } from "./Engine.ts";
import { Gearbox, type GearboxConfig } from "./Gearbox.ts";

function computeDownshiftThresholds(
	engine: EngineSpec,
	gearbox: GearboxSpec,
	wheelRadius: number,
): number[] {
	const { gearRatios } = gearbox;
	const { finalDrive, maxRPM, redlinePct } = engine;
	const redlineRPM = maxRPM * redlinePct;
	const redlineSpeed = (ratio: number): number => {
		return (redlineRPM / (ratio * finalDrive * 60)) * 2 * Math.PI * wheelRadius * 3.6;
	};
	const thresholds: number[] = [0];
	for (let i = 1; i < gearRatios.length; i++) {
		thresholds.push(redlineSpeed(gearRatios[i - 1]));
	}
	return thresholds;
}

export class EngineUnit {
	readonly engine: Engine;
	readonly gearbox: Gearbox;
	readonly isTurbo: boolean;

	constructor(engineSpec: EngineSpec, gearboxSpec: GearboxSpec, wheelRadius: number) {
		const downshiftThresholds = computeDownshiftThresholds(engineSpec, gearboxSpec, wheelRadius);
		const gearboxConfig: GearboxConfig = {
			gearRatios: gearboxSpec.gearRatios,
			shiftTime: gearboxSpec.shiftTime,
			downshiftThresholds,
		};
		this.engine = new Engine(engineSpec);
		this.gearbox = new Gearbox(gearboxConfig);
		this.isTurbo = !!engineSpec.turbo;
	}

	/** Update engine + gearbox state. Call once per physics tick. */
	update(wheelSpeed: number, dt: number): void {
		this.gearbox.update(dt, this.engine, wheelSpeed, false);
		this.engine.update(wheelSpeed, this.gearbox.effectiveRatio, 0.3, dt);
	}

	/** Get full telemetry snapshot for audio and UI. */
	getTelemetry(speed: number): EngineTelemetry {
		return {
			rpm: this.engine.rpm,
			gear: this.gearbox.currentGear,
			displayGear: this.gearbox.currentGear + 1,
			throttle: this.engine.throttle,
			load: this.engine.load,
			boost: 0, // computed by VehiclePhysics for turbo engines
			speed,
			isShifting: this.gearbox.isShifting,
			revLimited: this.engine.revLimited,
			isTurbo: this.isTurbo,
			grade: 0,
			clutchEngaged: !this.gearbox.isShifting,
		};
	}
}
