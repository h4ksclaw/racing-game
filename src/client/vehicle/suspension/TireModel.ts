/**
 * TireModel — slip angles, lateral forces, grip circle.
 *
 * Pure simulation module. No side effects.
 * VehiclePhysics calls compute() each frame.
 */

import type { TireSpec } from "../configs.ts";

export interface TireConfig extends TireSpec {
	/** Computed max traction force (N) — set by factory from mass × tractionPct */
	readonly maxTraction: number;
}

export interface TireForces {
	longitudinal: number;
	lateral: number;
	frontLateral: number;
	rearLateral: number;
	yawTorque: number;
}

export class TireModel {
	readonly config: TireConfig;

	constructor(config: TireConfig) {
		this.config = config;
	}

	compute(
		localVelX: number,
		localVelY: number,
		yawRate: number,
		steerAngle: number,
		cgToFront: number,
		cgToRear: number,
		normalFront: number,
		normalRear: number,
		rearGripFactor: number,
	): TireForces {
		const vFrontY = localVelY + yawRate * cgToFront;
		const vRearY = localVelY - yawRate * cgToRear;

		let alphaFront = 0;
		let alphaRear = 0;
		if (Math.abs(localVelX) > 1.0) {
			alphaFront = Math.atan2(vFrontY, Math.abs(localVelX)) - steerAngle;
			alphaRear = Math.atan2(vRearY, Math.abs(localVelX));
		}

		let fLatFront = -this.config.corneringStiffnessFront * alphaFront;
		let fLatRear = -this.config.corneringStiffnessRear * alphaRear * rearGripFactor;

		const mu = this.config.peakFriction;
		fLatFront = Math.max(-mu * normalFront, Math.min(mu * normalFront, fLatFront));
		fLatRear = Math.max(-mu * normalRear, Math.min(mu * normalRear, fLatRear));

		const fLatTotal = fLatFront * Math.cos(steerAngle) + fLatRear;
		const yawTorque = fLatFront * Math.cos(steerAngle) * cgToFront - fLatRear * cgToRear;

		return {
			longitudinal: 0,
			lateral: fLatTotal,
			frontLateral: fLatFront,
			rearLateral: fLatRear,
			yawTorque,
		};
	}
}
