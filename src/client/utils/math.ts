/**
 * Math utilities for vector/quaternion operations.
 * Wraps common Three.js patterns used throughout the game.
 */

import { type Object3D, type Quaternion, Vector3 } from "three";

/** Linear interpolation between a and b by t (clamped 0–1) */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * Math.min(Math.max(t, 0), 1);
}

/** Lerp a Vector3 toward a target */
export function lerpVector3(current: Vector3, target: Vector3, t: number): Vector3 {
	return current.lerp(target, t);
}

/** Lerp a Quaternion toward a target */
export function lerpQuaternion(current: Quaternion, target: Quaternion, t: number): Quaternion {
	return current.slerp(target, t);
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Convert degrees to radians */
export function degToRad(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Get the forward direction vector from an Object3D */
export function getForward(obj: Object3D): Vector3 {
	const forward = new Vector3(0, 0, -1);
	forward.applyQuaternion(obj.quaternion);
	return forward;
}

/** Get speed in km/h from a velocity vector (assuming 1 unit = 1 meter) */
export function velocityToKmh(velocity: Vector3): number {
	return Math.round(velocity.length() * 3.6);
}
