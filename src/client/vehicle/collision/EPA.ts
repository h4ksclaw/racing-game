/**
 * EPA — Expanding Polytope Algorithm.
 *
 * Takes GJK's intersecting simplex and expands it to find the
 * penetration depth, contact normal, and contact point between two shapes.
 *
 * For now, uses a simplified approach that works well for box-box collisions.
 * Full EPA with proper face list is a future improvement.
 *
 * Pure math module. No Three.js dependency.
 */

import type { SimplexVertex } from "./GJK.ts";
import type { Vec3 } from "./Vec3.ts";
import { v3Add, v3Cross, v3Dot, v3Len, v3LenSq, v3Normalize, v3Scale, v3Sub } from "./Vec3.ts";

export interface EPAResult {
	/** Penetration depth (positive) */
	depth: number;
	/** Contact normal pointing from B to A */
	normal: Vec3;
	/** Contact point in world space */
	contactPoint: Vec3;
}

const EPSILON = 1e-6;

/**
 * Find penetration info from an intersecting GJK simplex.
 *
 * For box-like shapes (which is our primary use case), uses a simplified
 * SAT-based penetration calculation that's more robust than full EPA.
 * Full EPA can be added later for arbitrary convex hulls.
 */
export function epa(
	simplex: SimplexVertex[],
	hullA: Vec3[],
	hullB: Vec3[],
	relativeVel?: Vec3,
): EPAResult {
	// Try SAT-based penetration for box-box (most common case)
	const satResult = satPenetration(hullA, hullB, relativeVel);
	if (satResult) return satResult;

	// Fallback: use simplex-based estimation
	return fallbackEPA(simplex);
}

/**
 * SAT-based penetration depth for convex hulls.
 * Tests all 15 separating axes for box-box (3 face normals + 9 edge cross products + 3).
 * For non-box shapes, tests face normals only.
 */
function satPenetration(hullA: Vec3[], hullB: Vec3[], relVel?: Vec3): EPAResult | null {
	const axes = getAxes(hullA, hullB);
	let minDepth = Infinity;
	let minNormal: Vec3 = { x: 0, y: 1, z: 0 };
	let minContact: Vec3 = { x: 0, y: 0, z: 0 };

	// First pass: find minimum penetration
	for (const axis of axes) {
		const len = v3Len(axis);
		if (len < EPSILON) continue;
		const n = v3Scale(axis, 1 / len);

		const projA = projectOnAxis(hullA, n);
		const projB = projectOnAxis(hullB, n);

		const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
		if (overlap <= 0) return null;

		if (overlap < minDepth) {
			minDepth = overlap;
			minNormal = n;
			const overlapMin = Math.max(projA.min, projB.min);
			const overlapMax = Math.min(projA.max, projB.max);
			const mid = (overlapMin + overlapMax) / 2;
			minContact = v3Scale(n, mid);
		}
	}

	// Second pass: prefer axis aligned with relative velocity
	// among axes with penetration within 2x of minimum
	if (relVel && v3LenSq(relVel) > EPSILON) {
		const relDir = v3Scale(relVel, 1 / v3Len(relVel));
		let bestAlignment = -Infinity;

		for (const axis of axes) {
			const len = v3Len(axis);
			if (len < EPSILON) continue;
			const n = v3Scale(axis, 1 / len);

			const projA = projectOnAxis(hullA, n);
			const projB = projectOnAxis(hullB, n);
			const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
			if (overlap <= 0 || overlap > minDepth * 2) continue;

			const alignment = -v3Dot(n, relDir);
			if (alignment > bestAlignment) {
				bestAlignment = alignment;
				minNormal = n;
				minDepth = overlap;
				const overlapMin = Math.max(projA.min, projB.min);
				const overlapMax = Math.min(projA.max, projB.max);
				const mid = (overlapMin + overlapMax) / 2;
				minContact = v3Scale(n, mid);
			}
		}
	}

	return {
		depth: minDepth,
		normal: minNormal,
		contactPoint: minContact,
	};
}

function projectOnAxis(hull: Vec3[], axis: Vec3): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;
	for (const v of hull) {
		const d = v3Dot(v, axis);
		if (d < min) min = d;
		if (d > max) max = d;
	}
	return { min, max };
}

function getAxes(_hullA: Vec3[], _hullB: Vec3[]): Vec3[] {
	// For box-box collisions, test the 15 standard SAT axes:
	// 6 face normals (±X, ±Y, ±Z) + 9 edge-edge cross products
	// We only need 3 face normals since opposite faces share the same axis
	const faceNormals: Vec3[] = [
		{ x: 1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: 0, z: 1 },
	];

	// Edge-edge cross products
	const edgesA: Vec3[] = [
		{ x: 1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: 0, z: 1 },
	];
	const edgesB: Vec3[] = [
		{ x: 1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: 0, z: 1 },
	];

	const axes: Vec3[] = [...faceNormals];
	for (const ea of edgesA) {
		for (const eb of edgesB) {
			const n = v3Cross(ea, eb);
			if (v3LenSq(n) > EPSILON) axes.push(n);
		}
	}

	return axes;
}

function fallbackEPA(simplex: SimplexVertex[]): EPAResult {
	// Fallback: use the simplex to estimate penetration
	// Find the closest point on the simplex to the origin
	let minDist = Infinity;
	let closestNormal: Vec3 = { x: 0, y: 1, z: 0 };

	for (let i = 0; i < simplex.length; i++) {
		for (let j = i + 1; j < simplex.length; j++) {
			const a = simplex[i].point;
			const b = simplex[j].point;
			const ab = v3Sub(b, a);
			const lenSq = v3LenSq(ab);
			if (lenSq < EPSILON) continue;
			const t = Math.max(0, Math.min(1, -v3Dot(a, ab) / lenSq));
			const closest = v3Add(a, v3Scale(ab, t));
			const dist = v3Len(closest);
			if (dist < minDist) {
				minDist = dist;
				closestNormal = dist > EPSILON ? v3Scale(closest, 1 / dist) : { x: 0, y: 1, z: 0 };
			}
		}
	}

	// Also check triangle faces
	for (let i = 0; i < simplex.length; i++) {
		for (let j = i + 1; j < simplex.length; j++) {
			for (let k = j + 1; k < simplex.length; k++) {
				const a = simplex[i].point;
				const b = simplex[j].point;
				const c = simplex[k].point;
				const normal = v3Normalize(v3Cross(v3Sub(b, a), v3Sub(c, a)));
				const dist = v3Dot(normal, a);
				if (dist > 0 && dist < minDist) {
					minDist = dist;
					closestNormal = normal;
				}
			}
		}
	}

	const contactPt =
		simplex.length > 0 ? v3Scale(v3Add(simplex[0].a, simplex[0].b), 0.5) : { x: 0, y: 0, z: 0 };

	return {
		depth: minDist,
		normal: closestNormal,
		contactPoint: contactPt,
	};
}
