/**
 * Car configuration types and presets.
 *
 * Spec types define subsystem parameters. CarConfig composes them.
 * Creating a new car = defining one CarConfig.
 *
 * Presets: RACE_CAR, SEDAN_CAR, SPORTS_CAR (AE86 Trueno).
 */

// ─── Engine ────────────────────────────────────────────────────────────

/**
 * Engine specification — defines the powerplant.
 * Torque curve is an array of [RPM, multiplier] breakpoints.
 * Interpolated linearly between points.
 */
export interface EngineSpec {
	/** Peak engine torque in Nm (before torque curve multiplier) */
	readonly torqueNm: number;
	/** Idle RPM */
	readonly idleRPM: number;
	/** Hard rev limiter — engine cuts power at this RPM */
	readonly maxRPM: number;
	/** Upshift trigger as fraction of maxRPM (e.g. 0.85 = shift at 85% of redline) */
	readonly redlinePct: number;
	/** Final drive ratio */
	readonly finalDrive: number;
	/**
	 * Torque curve: [RPM, multiplier] breakpoints.
	 * Must include at least idleRPM and maxRPM as endpoints.
	 */
	readonly torqueCurve: [number, number][];
	/** Engine braking strength (0 = coast freely, 1 = strong engine drag) */
	readonly engineBraking: number;
	/** Turbo/supercharged? Affects audio and boost simulation */
	readonly turbo?: boolean;
	/** Boost pressure in bar (peak) for turbo engines */
	readonly boostBar?: number;
}

// ─── Gearbox ───────────────────────────────────────────────────────────

export interface GearboxSpec {
	/** Transmission gear ratios. Index 0 = 1st gear. */
	readonly gearRatios: number[];
	/** Shift transition time in seconds */
	readonly shiftTime: number;
	readonly downshiftThresholds?: number[];
}

// ─── Brakes ────────────────────────────────────────────────────────────

export interface BrakeSpec {
	/** Maximum braking deceleration in g */
	readonly maxBrakeG: number;
	/** Handbrake deceleration in g */
	readonly handbrakeG: number;
	/** Brake bias: fraction of braking force on front axle (0-1) */
	readonly brakeBias: number;
}

// ─── Tires ─────────────────────────────────────────────────────────────

export interface TireSpec {
	/** Front cornering stiffness */
	readonly corneringStiffnessFront: number;
	/** Rear cornering stiffness */
	readonly corneringStiffnessRear: number;
	/** Peak friction coefficient */
	readonly peakFriction: number;
	/** Maximum traction force as fraction of weight */
	readonly tractionPct: number;
}

// ─── Drag ──────────────────────────────────────────────────────────────

export interface DragSpec {
	/** Rolling resistance (N per m/s) */
	readonly rollingResistance: number;
	/** Aerodynamic drag (N per m²/s²) */
	readonly aeroDrag: number;
}

/** Off-road surface resistance. Applied per-wheel proportional to speed². */
export interface OffRoadSpec {
	/** Base drag coefficient per wheel (N per m²/s² per wheel). Higher = more resistance. */
	readonly dragPerWheel: number;
	/** Minimum speed (m/s) before off-road drag kicks in. */
	readonly minSpeed: number;
	/** Off-road bump amplitude on the side area (kerb + shoulder), in meters. */
	readonly bumpAmplitude: number;
	/** Off-road bump amplitude past the guardrail, in meters. */
	readonly bumpAmplitudeOuter: number;
	/** Noise frequency scale for bumps (lower = wider bumps). */
	readonly bumpFrequency: number;
}

// ─── Chassis ───────────────────────────────────────────────────────────

export interface ChassisSpec {
	readonly mass: number;
	readonly halfExtents: [number, number, number];
	readonly wheelRadius: number;
	readonly wheelPositions: { x: number; y: number; z: number }[];
	readonly wheelBase: number;
	readonly maxSteerAngle: number;
	readonly suspensionStiffness: number;
	readonly suspensionRestLength: number;
	readonly dampingRelaxation: number;
	readonly dampingCompression: number;
	readonly rollInfluence: number;
	readonly maxSuspensionTravel: number;
	/** Center of gravity height in meters */
	readonly cgHeight: number;
	/** Front weight distribution fraction (0-1). Default 0.55. */
	readonly weightFront?: number;
}

// ─── Car Config (composition root) ────────────────────────────────────

import type { EngineSoundConfig } from "../audio/audio-types.ts";

/**
 * Expected node and material names in a car body GLB.
 * VehicleRenderer validates these at load time and fails with a clear error
 * if any required marker is missing.
 *
 * To support a new car model, create a new CarModelSchema that maps your
 * GLB's naming convention to these semantic roles.
 */
export interface CarModelSchema {
	/** Path to the wheel GLB file (separate from car body). */
	readonly wheelModelPath: string;
	/** Required marker nodes on the car body GLB. */
	readonly markers: {
		/** Physics reference point — defines CG height and wheel radius. */
		readonly physicsMarker: string;
		/** Wheel position markers, order: [FL, FR, RL, RR]. */
		readonly wheels: readonly [string, string, string, string];
		/** Exhaust pipe positions (optional, for audio spatialization). */
		readonly escapePipes?: { readonly left?: string; readonly right?: string };
	};
	/** Material names that identify light-emitting surfaces. */
	readonly materials: {
		readonly headlight: string;
		readonly taillight: string;
	};
	/** Expected node name in wheel GLB to use as the template. */
	readonly wheelTemplateNode: string;
	/** Material names in wheel GLB that identify brake discs (non-spinning). */
	readonly brakeDiscMaterials: readonly string[];
}

/** Default off-road behavior when CarConfig.offRoad is omitted. */
export const DEFAULT_OFF_ROAD: OffRoadSpec = {
	dragPerWheel: 0.19,
	minSpeed: 0.5,
	bumpAmplitude: 0.15,
	bumpAmplitudeOuter: 0.075,
	bumpFrequency: 0.5,
};

/** Default schema matching the current car.glb naming convention. */
export const DEFAULT_CAR_MODEL_SCHEMA: CarModelSchema = {
	wheelModelPath: "/assets/new-car/car.glb",
	markers: {
		physicsMarker: "PhysicsMarker",
		wheels: ["WheelRig_FrontLeft", "WheelRig_FrontRight", "WheelRig_RearLeft", "WheelRig_RearRight"],
		escapePipes: { left: "escape_l", right: "escape_r" },
	},
	materials: {
		headlight: "front_light_1",
		taillight: "back_light",
	},
	wheelTemplateNode: "wheel_1",
	brakeDiscMaterials: ["Break"],
};

export interface CarConfig {
	readonly name: string;
	readonly modelPath: string;
	/** Scale factor applied to the GLB model before marker auto-derivation. Default 1. */
	readonly modelScale: number;
	/** GLB node/material naming schema. Uses DEFAULT_CAR_MODEL_SCHEMA if omitted. */
	readonly modelSchema?: CarModelSchema;
	readonly engine: EngineSpec;
	readonly gearbox: GearboxSpec;
	readonly brakes: BrakeSpec;
	readonly tires: TireSpec;
	readonly drag: DragSpec;
	/** Off-road surface drag and bump config. If omitted, uses DEFAULT_OFF_ROAD. */
	readonly offRoad?: OffRoadSpec;
	readonly chassis: ChassisSpec;
	/** Optional sound profile. If omitted, derived from engine specs. */
	readonly sound?: EngineSoundConfig;
	/** Drivetrain layout: front-wheel, rear-wheel, or all-wheel drive. Default 'RWD'. */
	readonly drivetrain?: "FWD" | "RWD" | "AWD";
	/** Custom suspension parameters for differential loading (weight transfer). */
	readonly suspension?: {
		/** Spring constant per wheel (N/m). Default 5000. */
		readonly customStiffness?: number;
		/** Damping coefficient per wheel (N·s/m). Default 300. */
		readonly customDamping?: number;
	};
}

// ─── Presets ───────────────────────────────────────────────────────────

export const RACE_CAR: CarConfig = {
	name: "Race Car",
	drivetrain: "AWD",
	modelScale: 1,
	modelPath: "/assets/kenney-car-kit/Models/GLB format/race.glb",
	engine: {
		torqueNm: 50,
		idleRPM: 1000,
		maxRPM: 8500,
		redlinePct: 0.85,
		finalDrive: 3.5,
		torqueCurve: [
			[1000, 0.3],
			[1100, 1.0],
			[8500, 1.0],
		],
		engineBraking: 0.3,
	},
	gearbox: {
		gearRatios: [6.67, 3.59, 2.34, 1.77, 1.42, 1.39],
		shiftTime: 0.12,
	},
	brakes: {
		maxBrakeG: 1.5,
		handbrakeG: 1.8,
		brakeBias: 0.6,
	},
	tires: {
		corneringStiffnessFront: 560,
		corneringStiffnessRear: 515,
		peakFriction: 1.4,
		tractionPct: 0.5,
	},
	drag: {
		rollingResistance: 0.3,
		aeroDrag: 0.03,
	},
	chassis: {
		mass: 150,
		halfExtents: [0.6, 0.3, 1.2],
		wheelRadius: 0.3,
		wheelPositions: [
			{ x: 0.35, y: -0.1, z: 0.64 },
			{ x: -0.35, y: -0.1, z: 0.64 },
			{ x: 0.35, y: -0.1, z: -0.88 },
			{ x: -0.35, y: -0.1, z: -0.88 },
		],
		wheelBase: 1.52,
		maxSteerAngle: 0.5,
		suspensionStiffness: 30,
		suspensionRestLength: 0.3,
		dampingRelaxation: 2.3,
		dampingCompression: 4.4,
		rollInfluence: 0.01,
		maxSuspensionTravel: 0.3,
		cgHeight: 0.45,
	},
};

export const SEDAN_CAR: CarConfig = {
	name: "Sedan",
	modelScale: 1,
	modelPath: "/assets/kenney-car-kit/Models/GLB format/sedan.glb",
	engine: {
		torqueNm: 35,
		idleRPM: 800,
		maxRPM: 6500,
		redlinePct: 0.85,
		finalDrive: 3.5,
		torqueCurve: [
			[800, 0.3],
			[900, 1.0],
			[6500, 1.0],
		],
		engineBraking: 0.2,
	},
	gearbox: {
		gearRatios: [5.95, 3.25, 2.1, 1.55, 1.3, 1.1],
		shiftTime: 0.18,
	},
	brakes: {
		maxBrakeG: 0.75,
		handbrakeG: 0.9,
		brakeBias: 0.55,
	},
	tires: {
		corneringStiffnessFront: 480,
		corneringStiffnessRear: 440,
		peakFriction: 1.2,
		tractionPct: 0.45,
	},
	drag: {
		rollingResistance: 0.4,
		aeroDrag: 0.05,
	},
	chassis: {
		mass: 200,
		halfExtents: [0.7, 0.35, 1.3],
		wheelRadius: 0.3,
		wheelPositions: [
			{ x: 0.35, y: -0.1, z: 0.7 },
			{ x: -0.35, y: -0.1, z: 0.7 },
			{ x: 0.35, y: -0.1, z: -0.8 },
			{ x: -0.35, y: -0.1, z: -0.8 },
		],
		wheelBase: 1.5,
		maxSteerAngle: 0.45,
		suspensionStiffness: 30,
		suspensionRestLength: 0.3,
		dampingRelaxation: 2.3,
		dampingCompression: 4.4,
		rollInfluence: 0.02,
		maxSuspensionTravel: 0.3,
		cgHeight: 0.5,
	},
};

/**
 * AE86 Trueno — custom sports car with marker-based chassis auto-derivation.
 * WheelRig_* and PhysicsMarker objects in the GLB define wheel positions,
 * radius, wheelbase, and ride height. Chassis values here are fallbacks.
 */
export const SPORTS_CAR: CarConfig = {
	name: "AE86 Trueno",
	drivetrain: "RWD",
	modelPath: "/assets/new-car/wheels.glb",
	modelScale: 2.1,
	engine: {
		torqueNm: 145,
		idleRPM: 850,
		maxRPM: 7600,
		redlinePct: 0.85,
		finalDrive: 4.3,
		torqueCurve: [
			[850, 0.3],
			[1500, 0.55],
			[3000, 0.85],
			[4800, 1.0],
			[6200, 0.98],
			[7600, 0.85],
		],
		engineBraking: 0.25,
	},
	gearbox: {
		gearRatios: [3.59, 2.06, 1.38, 1.0, 0.85],
		shiftTime: 0.15,
		downshiftThresholds: [15, 35, 55, 75, 100],
	},
	brakes: {
		maxBrakeG: 0.8,
		handbrakeG: 1.2,
		brakeBias: 0.55,
	},
	tires: {
		corneringStiffnessFront: 80000,
		corneringStiffnessRear: 75000,
		peakFriction: 1.0,
		tractionPct: 0.45,
	},
	drag: {
		rollingResistance: 1.5,
		aeroDrag: 0.35,
	},
	chassis: {
		mass: 1000,
		halfExtents: [0.82, 0.67, 2.11],
		wheelRadius: 0.31,
		wheelPositions: [
			{ x: -0.73, y: -0.31, z: 1.22 },
			{ x: 0.73, y: -0.31, z: 1.22 },
			{ x: -0.73, y: -0.31, z: -1.26 },
			{ x: 0.73, y: -0.31, z: -1.26 },
		],
		wheelBase: 2.48,
		maxSteerAngle: 0.55,
		suspensionStiffness: 40,
		suspensionRestLength: 0.2,
		dampingRelaxation: 2.8,
		dampingCompression: 4.5,
		rollInfluence: 0.06,
		maxSuspensionTravel: 0.25,
		cgHeight: 0.35,
		weightFront: 0.53,
	},
};
