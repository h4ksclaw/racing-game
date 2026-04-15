import type * as THREE from "three";

/** Per-car configuration — defines physics behavior and visual model */
export interface CarConfig {
	name: string;
	modelPath: string;
	mass: number;
	chassisHalfExtents: [number, number, number]; // [width/2, height/2, length/2]
	engineForce: number;
	brakeForce: number;
	maxSteerAngle: number;
	maxSpeed: number;
	gearRatios: number[];
	maxRPM: number;
	idleRPM: number;
	wheelRadius: number;
	wheelPositions: { x: number; y: number; z: number }[];
	suspensionStiffness: number;
	suspensionRestLength: number;
	dampingRelaxation: number;
	dampingCompression: number;
	frictionSlip: number;
	rollInfluence: number;
	maxSuspensionTravel: number;
}

/** Runtime state of the vehicle */
export interface VehicleState {
	speed: number; // m/s
	rpm: number;
	gear: number;
	steeringAngle: number;
	throttle: number;
	brake: number;
	onGround: boolean;
}

/** Input state from keyboard/gamepad */
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

export const RACE_CAR: CarConfig = {
	name: "Race Car",
	modelPath: "/assets/kenney-car-kit/Models/GLB format/race.glb",
	mass: 800,
	chassisHalfExtents: [0.6, 0.3, 1.2],
	engineForce: 2800,
	brakeForce: 80,
	maxSteerAngle: 0.5,
	maxSpeed: 80, // m/s (~288 km/h)
	gearRatios: [2.9, 2.1, 1.6, 1.2, 0.9, 0.7],
	maxRPM: 8500,
	idleRPM: 1000,
	wheelRadius: 0.3,
	wheelPositions: [
		{ x: 0.35, y: -0.1, z: 0.64 }, // front-left
		{ x: -0.35, y: -0.1, z: 0.64 }, // front-right
		{ x: 0.35, y: -0.1, z: -0.88 }, // rear-left
		{ x: -0.35, y: -0.1, z: -0.88 }, // rear-right
	],
	suspensionStiffness: 35,
	suspensionRestLength: 0.35,
	dampingRelaxation: 2.5,
	dampingCompression: 4.5,
	frictionSlip: 3.5,
	rollInfluence: 0.01,
	maxSuspensionTravel: 0.3,
};

export const SEDAN_CAR: CarConfig = {
	name: "Sedan",
	modelPath: "/assets/kenney-car-kit/Models/GLB format/sedan.glb",
	mass: 1400,
	chassisHalfExtents: [0.7, 0.35, 1.3],
	engineForce: 2200,
	brakeForce: 60,
	maxSteerAngle: 0.45,
	maxSpeed: 55, // m/s (~200 km/h)
	gearRatios: [3.5, 2.5, 1.8, 1.3, 1.0, 0.8],
	maxRPM: 6500,
	idleRPM: 800,
	wheelRadius: 0.3,
	wheelPositions: [
		{ x: 0.35, y: -0.1, z: 0.7 },
		{ x: -0.35, y: -0.1, z: 0.7 },
		{ x: 0.35, y: -0.1, z: -0.8 },
		{ x: -0.35, y: -0.1, z: -0.8 },
	],
	suspensionStiffness: 30,
	suspensionRestLength: 0.35,
	dampingRelaxation: 2.3,
	dampingCompression: 4.0,
	frictionSlip: 2.5,
	rollInfluence: 0.05,
	maxSuspensionTravel: 0.25,
};

export interface WheelVisual {
	mesh: THREE.Object3D;
	isFront: boolean;
	connectionPoint: { x: number; y: number; z: number };
}
