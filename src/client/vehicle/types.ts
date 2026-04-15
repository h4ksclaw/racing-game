import type * as THREE from "three";

// ─── Engine ────────────────────────────────────────────────────────────

/**
 * Engine specification — defines the powerplant.
 * Torque curve is an array of [RPM, multiplier] breakpoints.
 * Interpolated linearly between points.
 *
 * Example — NA V8 with a fat midrange:
 *   torqueCurve: [
 *     [1000, 0.6], [3000, 0.95], [5000, 1.0], [7000, 0.9], [8000, 0.75],
 *   ]
 *
 * Example — turbo diesel with low-end grunt:
 *   torqueCurve: [
 *     [800, 0.5], [1500, 0.95], [2500, 1.0], [3500, 0.95], [4500, 0.7],
 *   ]
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
	 * Multiplier is applied to torqueNm.
	 * Must include at least idleRPM and maxRPM as endpoints.
	 */
	readonly torqueCurve: [number, number][];
	/** Engine braking strength (0 = coast freely, 1 = strong engine drag) */
	readonly engineBraking: number;
}

// ─── Gearbox ───────────────────────────────────────────────────────────

/**
 * Gearbox specification — defines gear ratios and shift behavior.
 * Ratios are transmission ratios (not including final drive).
 * Index 0 = 1st gear.
 */
export interface GearboxSpec {
	/** Transmission gear ratios. Index 0 = 1st gear. */
	readonly gearRatios: number[];
	/** Shift transition time in seconds */
	readonly shiftTime: number;
	/**
	 * Per-gear downshift speed thresholds in km/h (braking only).
	 * Gear N downshifts to N-1 when speed drops below thresholds[N].
	 * thresholds[0] is unused (can't downshift from 1st).
	 *
	 * If omitted, defaults are computed from gear ratios so RPM
	 * stays near redline during braking.
	 */
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
	/**
	 * Maximum traction force as fraction of weight.
	 * 0.5 = wheels can push with 50% of car's weight before spinning.
	 */
	readonly tractionPct: number;
}

// ─── Drag ──────────────────────────────────────────────────────────────

export interface DragSpec {
	/** Rolling resistance (N per m/s) */
	readonly rollingResistance: number;
	/** Aerodynamic drag (N per m²/s²) */
	readonly aeroDrag: number;
}

// ─── Chassis ───────────────────────────────────────────────────────────

export interface ChassisSpec {
	readonly mass: number;
	readonly halfExtents: [number, number, number]; // [width/2, height/2, length/2]
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
	/** Center of gravity height in meters (affects weight transfer) */
	readonly cgHeight: number;
}

// ─── Car Config (composition root) ────────────────────────────────────

/**
 * Full car definition — composes all subsystem specs.
 * Every field is used. Nothing is dead code.
 * Adding a new car = creating one of these.
 */
export interface CarConfig {
	readonly name: string;
	readonly modelPath: string;
	readonly engine: EngineSpec;
	readonly gearbox: GearboxSpec;
	readonly brakes: BrakeSpec;
	readonly tires: TireSpec;
	readonly drag: DragSpec;
	readonly chassis: ChassisSpec;
}

// ─── Runtime State ─────────────────────────────────────────────────────

export interface VehicleState {
	speed: number; // m/s
	rpm: number;
	gear: number;
	steeringAngle: number;
	throttle: number;
	brake: number;
	onGround: boolean;
}

// ─── Input ─────────────────────────────────────────────────────────────

export interface VehicleInput {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	brake: boolean;
	handbrake: boolean;
}

export const DEFAULT_INPUT: VehicleInput = {
	forward: false,
	backward: false,
	left: false,
	right: false,
	brake: false,
	handbrake: false,
};

// ─── Wheel Visual (for Three.js mesh binding) ──────────────────────────

export interface WheelVisual {
	mesh: THREE.Object3D;
	isFront: boolean;
	connectionPoint: { x: number; y: number; z: number };
}

// ─── Example Cars ──────────────────────────────────────────────────────

export const RACE_CAR: CarConfig = {
	name: "Race Car",
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
		// downshiftThresholds omitted → auto-computed from gear ratios
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
