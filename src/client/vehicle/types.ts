/**
 * Runtime vehicle types — state, input, telemetry.
 *
 * These are the data structures that flow through the system each frame.
 * Spec types and presets live in configs.ts.
 */

import type * as THREE from "three";

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

// ─── Engine Telemetry ──────────────────────────────────────────────────

/**
 * Engine telemetry — computed by physics each frame, consumed by audio and UI.
 * Load and boost are derived from physics state, not set externally.
 */
export interface EngineTelemetry {
	rpm: number;
	gear: number; // 0-indexed (0 = 1st)
	displayGear: number; // 1-indexed, -1 for reverse
	throttle: number; // 0-1
	load: number; // 0-1 (engineForce / maxEngineForce)
	boost: number; // 0-1 (simulated for turbo engines)
	speed: number; // m/s
	isShifting: boolean;
	revLimited: boolean;
	isTurbo: boolean;
	grade: number;
	clutchEngaged: boolean;
}

// ─── Road Boundary ─────────────────────────────────────────────────────

export interface RoadBoundaryInfo {
	/** Signed distance from road center (negative = left, positive = right) */
	lateralDist: number;
	/** Absolute distance from road center */
	distFromCenter: number;
	/** Road half-width (meters) */
	roadHalfWidth: number;
	/** Kerb outer edge distance from center */
	kerbEdge: number;
	/** Guardrail distance from center */
	guardrailDist: number;
	/** Whether car is on the road surface */
	onRoad: boolean;
	/** Whether car is on the kerb */
	onKerb: boolean;
	/** Whether car is on the shoulder/grass */
	onShoulder: boolean;
	/** Inward-pointing wall normal (world space, only set when beyond guardrail) */
	wallNormal?: { x: number; z: number };
	/** Direct distance from car to nearest guardrail position */
	distToWall: number;
}

// ─── Terrain ───────────────────────────────────────────────────────────

export interface TerrainProvider {
	getHeight(x: number, z: number): number;
	getNormal?(x: number, z: number): { x: number; y: number; z: number };
	getRoadBoundary?(x: number, z: number): RoadBoundaryInfo;
}

// ─── Angular Velocity ────────────────────────────────────────────────────

/** 3D angular velocity (rad/s). Pure math, no Three.js dependency. */
export interface AngularVelocity3D {
	pitch: number; // rotation around local X (nose up/down)
	yaw: number; // rotation around local Y (heading)
	roll: number; // rotation around local Z (body lean)
}

// ─── Wheel Visual (for Three.js mesh binding) ──────────────────────────

export interface WheelVisual {
	mesh: THREE.Object3D;
	isFront: boolean;
	connectionPoint: { x: number; y: number; z: number };
}
