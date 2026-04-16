import type { CarConfig } from "@client/vehicle/configs.ts";

const STORAGE_KEY = "racing-garage-custom";

/**
 * Fields that are safe to serialize to localStorage.
 * Excludes 3D model geometry (modelPath, modelScale, wheelPositions,
 * halfExtents, wheelBase, wheelRadius) which come from GLB markers.
 */
export interface TunableConfig {
	engine: {
		torqueNm: number;
		idleRPM: number;
		maxRPM: number;
		redlinePct: number;
		finalDrive: number;
		engineBraking: number;
	};
	gearbox: {
		gearRatios: number[];
		shiftTime: number;
	};
	brakes: {
		maxBrakeG: number;
		handbrakeG: number;
		brakeBias: number;
	};
	tires: {
		corneringStiffnessFront: number;
		corneringStiffnessRear: number;
		peakFriction: number;
		tractionPct: number;
	};
	drag: {
		rollingResistance: number;
		aeroDrag: number;
	};
	chassis: {
		mass: number;
		maxSteerAngle: number;
		suspensionStiffness: number;
		cgHeight: number;
		weightFront: number;
	};
}

export function saveCustomConfig(config: TunableConfig): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadCustomConfig(): TunableConfig | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as TunableConfig;
	} catch {
		return null;
	}
}

export function resetCustomConfig(): void {
	localStorage.removeItem(STORAGE_KEY);
}

export function applyOverrides(base: CarConfig, overrides: TunableConfig): CarConfig {
	return {
		...base,
		engine: { ...base.engine, ...overrides.engine },
		gearbox: { ...base.gearbox, ...overrides.gearbox },
		brakes: { ...base.brakes, ...overrides.brakes },
		tires: { ...base.tires, ...overrides.tires },
		drag: { ...base.drag, ...overrides.drag },
		chassis: { ...base.chassis, ...overrides.chassis },
	};
}

export function extractTunable(config: CarConfig): TunableConfig {
	return {
		engine: {
			torqueNm: config.engine.torqueNm,
			idleRPM: config.engine.idleRPM,
			maxRPM: config.engine.maxRPM,
			redlinePct: config.engine.redlinePct,
			finalDrive: config.engine.finalDrive,
			engineBraking: config.engine.engineBraking,
		},
		gearbox: {
			gearRatios: [...config.gearbox.gearRatios],
			shiftTime: config.gearbox.shiftTime,
		},
		brakes: {
			maxBrakeG: config.brakes.maxBrakeG,
			handbrakeG: config.brakes.handbrakeG,
			brakeBias: config.brakes.brakeBias,
		},
		tires: {
			corneringStiffnessFront: config.tires.corneringStiffnessFront,
			corneringStiffnessRear: config.tires.corneringStiffnessRear,
			peakFriction: config.tires.peakFriction,
			tractionPct: config.tires.tractionPct,
		},
		drag: {
			rollingResistance: config.drag.rollingResistance,
			aeroDrag: config.drag.aeroDrag,
		},
		chassis: {
			mass: config.chassis.mass,
			maxSteerAngle: config.chassis.maxSteerAngle,
			suspensionStiffness: config.chassis.suspensionStiffness,
			cgHeight: config.chassis.cgHeight,
			weightFront: config.chassis.weightFront ?? 0.55,
		},
	};
}
