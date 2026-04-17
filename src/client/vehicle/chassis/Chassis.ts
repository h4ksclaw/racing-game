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

	/** 3D inertia tensor diagonal (kg·m²). Used for hull collision response. */
	readonly inertiaTensor: {
		/** Pitch inertia (rotation around lateral/X axis) */
		readonly xx: number;
		/** Yaw inertia (rotation around vertical/Y axis) */
		readonly yy: number;
		/** Roll inertia (rotation around longitudinal/Z axis) */
		readonly zz: number;
	};

	constructor(spec: ChassisSpec) {
		this.spec = spec;
		const wf = spec.weightFront ?? 0.55;
		this.cgToFront = spec.wheelBase * wf;
		this.cgToRear = spec.wheelBase * (1 - wf);
		this.cgHeight = spec.cgHeight;
		this.yawInertia = spec.mass * this.cgToFront * this.cgToRear;

		// Approximate 3D inertia tensor for a box-shaped body.
		// I = m/12 * (h² + d²) where h,d are the two dimensions perpendicular to the axis.
		const [hw, hh, hl] = spec.halfExtents; // half-extents
		const w = 2 * hw;
		const h = 2 * hh;
		const l = 2 * hl;
		const m = spec.mass;
		this.inertiaTensor = {
			xx: (m / 12) * (h * h + l * l), // pitch: around X (height² + length²)
			yy: (m / 12) * (w * w + l * l), // yaw: around Y (width² + length²)
			zz: (m / 12) * (w * w + h * h), // roll: around Z (width² + height²)
		};
	}
}
