/**
 * CarModel — backward compatibility re-exports.
 *
 * The actual modules are now in their own directories:
 *   engine/Engine.ts, engine/Gearbox.ts, engine/EngineUnit.ts
 *   suspension/TireModel.ts, suspension/Brakes.ts
 *   aero/DragModel.ts
 *
 * This file re-exports everything for existing imports.
 */

export { type DragConfig, DragModel } from "./aero/DragModel.ts";
export { Engine, type EngineConfig } from "./engine/Engine.ts";
export { Gearbox, type GearboxConfig } from "./engine/Gearbox.ts";
export { type BrakeConfig, Brakes } from "./suspension/Brakes.ts";
export { type TireConfig, type TireForces, TireModel } from "./suspension/TireModel.ts";

import { DragModel } from "./aero/DragModel.ts";
import type { CarConfig } from "./configs.ts";
import { Engine } from "./engine/Engine.ts";
import { Gearbox } from "./engine/Gearbox.ts";
import { Brakes } from "./suspension/Brakes.ts";
import type { TireConfig } from "./suspension/TireModel.ts";
import { TireModel } from "./suspension/TireModel.ts";

export interface CarModel {
	readonly engine: Engine;
	readonly gearbox: Gearbox;
	readonly brakes: Brakes;
	readonly tires: TireModel;
	readonly drag: DragModel;
	readonly config: CarConfig;
}

function computeDownshiftThresholds(config: CarConfig): number[] {
	const { gearRatios } = config.gearbox;
	const { finalDrive, maxRPM, redlinePct } = config.engine;
	const wheelRadius = config.chassis.wheelRadius;
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

export function buildCarModel(config: CarConfig): CarModel {
	const downshiftThresholds = computeDownshiftThresholds(config);
	const gearboxConfig = {
		gearRatios: config.gearbox.gearRatios,
		shiftTime: config.gearbox.shiftTime,
		downshiftThresholds,
	};
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
