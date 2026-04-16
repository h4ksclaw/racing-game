/**
 * Chassis — mass, center of gravity, suspension parameters.
 *
 * Computes derived values (CG position, yaw inertia) from spec.
 * Pure data class, no side effects.
 */

import type { ChassisSpec } from "../configs.ts";

export class Chassis {
	readonly spec: ChassisSpec;
	readonly cgToFront: number;
	readonly cgToRear: number;
	readonly cgHeight: number;
	readonly yawInertia: number;

	constructor(spec: ChassisSpec) {
		this.spec = spec;
		const wf = spec.weightFront ?? 0.55;
		this.cgToFront = spec.wheelBase * wf;
		this.cgToRear = spec.wheelBase * (1 - wf);
		this.cgHeight = spec.cgHeight;
		this.yawInertia = spec.mass * this.cgToFront * this.cgToRear;
	}
}
