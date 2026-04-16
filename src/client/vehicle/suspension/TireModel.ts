/**
 * TireModel — Pacejka-based slip angles, friction circle, combined slip.
 *
 * Pure simulation module. No side effects.
 * VehiclePhysics calls compute() each frame.
 *
 * Uses simplified Pacejka '94 Magic Formula:
 *   F = Fz * D * sin(C * arctan(B*x - E*(B*x - arctan(B*x))))
 *
 * Combined slip: friction circle clamps total force to mu * Fz.
 * This naturally produces understeer (front saturated) and oversteer/drift (rear saturated).
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
	frontLongitudinal: number;
	rearLongitudinal: number;
	yawTorque: number;
	/** Slip angle at front axle (radians) — useful for audio/UI feedback */
	frontSlipAngle: number;
	/** Slip angle at rear axle (radians) */
	rearSlipAngle: number;
	/** Whether rear tires are sliding (drift indicator) */
	rearSliding: boolean;
}

/** Pacejka '94 Magic Formula coefficients (simplified, no load dependency). */
export interface PacejkaCoeffs {
	/** Stiffness factor — how quickly force builds with slip */
	B: number;
	/** Shape factor — 1.3 lateral, 1.65 longitudinal typical */
	C: number;
	/** Peak factor — D = mu (friction coefficient) */
	D: number;
	/** Curvature factor — negative = sharper peak */
	E: number;
}

/** Default Pacejka coefficients for dry tarmac. */
const DEFAULT_PACEJKA: { lateral: PacejkaCoeffs; longitudinal: PacejkaCoeffs } = {
	lateral: { B: 0.14, C: 1.9, D: 1.0, E: -0.5 },
	longitudinal: { B: 0.14, C: 1.65, D: 1.0, E: 0.97 },
};

/**
 * Pacejka '94 Magic Formula (simplified).
 *
 * @param slip - Slip angle (degrees) for lateral, or slip ratio (%) for longitudinal
 * @param Fz - Normal force (N)
 * @param coeffs - Pacejka coefficients
 * @returns Force (N)
 */
export function pacejka(slip: number, Fz: number, coeffs: PacejkaCoeffs): number {
	const x = coeffs.B * slip;
	return Fz * coeffs.D * Math.sin(coeffs.C * Math.atan(x - coeffs.E * (x - Math.atan(x))));
}

/**
 * Clamp combined tire force to friction circle.
 *
 * If sqrt(Fx² + Fy²) > maxForce, scale both down proportionally.
 */
export function frictionCircleClamp(
	Fx: number,
	Fy: number,
	maxForce: number,
): { Fx: number; Fy: number } {
	const total = Math.sqrt(Fx * Fx + Fy * Fy);
	if (total > maxForce && total > 0) {
		const scale = maxForce / total;
		return { Fx: Fx * scale, Fy: Fy * scale };
	}
	return { Fx, Fy };
}

export class TireModel {
	readonly config: TireConfig;
	private readonly pacejkaLat: PacejkaCoeffs;

	constructor(config: TireConfig) {
		this.config = config;

		// Compute D (peak factor) from the configured cornering stiffness.
		// At small slip angles, Pacejka is approximately linear:
		//   F ≈ B * C * D * Fz * slip_rad
		// We want the linear region to match the configured cornering stiffness:
		//   corneringStiffness * slip_rad ≈ B * C * D * Fz * slip_rad
		//   D ≈ corneringStiffness / (B * C * Fz_ref)
		// Use a reference Fz (normal force per axle at rest).
		const B = DEFAULT_PACEJKA.lateral.B;
		const C = DEFAULT_PACEJKA.lateral.C;
		const FzRef = config.maxTraction / 2;
		const DfromStiffness =
			FzRef > 0 ? config.corneringStiffnessFront / (B * C * FzRef) : config.peakFriction;

		// Cap D at peakFriction to prevent unrealistic grip levels.
		const D = Math.min(DfromStiffness, config.peakFriction);

		this.pacejkaLat = { B, C, D, E: DEFAULT_PACEJKA.lateral.E };
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
		// ── Slip Angles (lateral) ──
		const vFrontY = localVelY + yawRate * cgToFront;
		const vRearY = localVelY - yawRate * cgToRear;

		let alphaFront = 0;
		let alphaRear = 0;
		if (Math.abs(localVelX) > 1.0) {
			alphaFront = Math.atan2(vFrontY, Math.abs(localVelX)) - steerAngle;
			alphaRear = Math.atan2(vRearY, Math.abs(localVelX));
		}

		// Convert to degrees for Pacejka
		const alphaFrontDeg = (alphaFront * 180) / Math.PI;
		const alphaRearDeg = (alphaRear * 180) / Math.PI;

		// Use Pacejka at speed, linear at low speed (avoids noise near zero velocity)
		const speedBlend = Math.min(1, Math.abs(localVelX) / 3.0);

		// ── Pacejka Lateral Forces ──
		let fLatFront =
			speedBlend > 0
				? pacejka(alphaFrontDeg, normalFront, this.pacejkaLat)
				: -this.config.corneringStiffnessFront * alphaFront;
		let fLatRear =
			speedBlend > 0
				? pacejka(alphaRearDeg, normalRear * rearGripFactor, this.pacejkaLat)
				: -this.config.corneringStiffnessRear * alphaRear * rearGripFactor;

		// ── Friction Circle ──
		// Ensures combined force doesn't exceed mu * Fz per axle.
		// Currently longitudinal force is 0 (engine/brake handled in VehiclePhysics).
		const frontMaxForce = normalFront * this.config.peakFriction;
		const rearMaxForce = normalRear * rearGripFactor * this.config.peakFriction;
		const frontClamped = frictionCircleClamp(0, fLatFront, frontMaxForce);
		const rearClamped = frictionCircleClamp(0, fLatRear, rearMaxForce);

		fLatFront = frontClamped.Fy;
		fLatRear = rearClamped.Fy;

		// ── Combined Forces ──
		const fLatTotal = fLatFront * Math.cos(steerAngle) + fLatRear;
		const yawTorque = fLatFront * Math.cos(steerAngle) * cgToFront - fLatRear * cgToRear;

		// ── Rear Slide Detection ──
		// Rear is sliding when slip angle exceeds typical peak (~8-10 degrees)
		const rearSliding = Math.abs(alphaRearDeg) > 6;

		return {
			longitudinal: 0,
			lateral: fLatTotal,
			frontLateral: fLatFront,
			rearLateral: fLatRear,
			frontLongitudinal: 0,
			rearLongitudinal: 0,
			yawTorque,
			frontSlipAngle: alphaFront,
			rearSlipAngle: alphaRear,
			rearSliding,
		};
	}
}
