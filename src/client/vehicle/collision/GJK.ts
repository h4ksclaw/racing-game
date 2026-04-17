/**
 * GJK — Gilbert-Johnson-Keerthi intersection test for 3D convex shapes.
 *
 * Uses the standard incremental 3D GJK with a clean simplex evolution.
 * The simplex is always stored as [oldest..newest], and case functions
 * return the new search direction along with the reduced simplex.
 *
 * Pure math module. No Three.js dependency.
 */

import type { Vec3 } from "./Vec3.ts";
import { v3Add, v3Cross, v3Dot, v3LenSq, v3Neg, v3Normalize, v3Scale, v3Sub } from "./Vec3.ts";

export interface SimplexVertex {
	/** Point on Minkowski difference (a - b) */
	point: Vec3;
	/** Support point from shape A */
	a: Vec3;
	/** Support point from shape B */
	b: Vec3;
}

export interface GJKResult {
	intersecting: boolean;
	simplex: SimplexVertex[];
}

const MAX_ITERATIONS = 64;
const EPSILON = 1e-8;

/**
 * Check if two convex hulls intersect using GJK.
 */
export function gjk(hullA: Vec3[], hullB: Vec3[], initialDir?: Vec3): GJKResult {
	if (hullA.length === 0 || hullB.length === 0) {
		return { intersecting: false, simplex: [] };
	}

	let dir = initialDir;
	if (!dir || v3LenSq(dir) < EPSILON) {
		dir = v3Sub(centroidOf(hullB), centroidOf(hullA));
	}
	if (v3LenSq(dir) < EPSILON) {
		dir = { x: 1, y: 0, z: 0 };
	}

	let simplex: SimplexVertex[] = [];

	// Initial support
	const s0 = support(hullA, hullB, dir);
	if (v3Dot(s0.point, dir) < 0) {
		return { intersecting: false, simplex: [] };
	}
	simplex = [s0];
	dir = v3Neg(s0.point);

	for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
		const sNew = support(hullA, hullB, dir);
		if (v3Dot(sNew.point, dir) < 0) {
			return { intersecting: false, simplex };
		}

		simplex = [...simplex, sNew];

		if (simplex.length === 2) {
			const r = evolveLine(simplex);
			simplex = r.simplex;
			dir = r.dir;
		} else if (simplex.length === 3) {
			const r = evolveTriangle(simplex);
			simplex = r.simplex;
			dir = r.dir;
		} else if (simplex.length === 4) {
			const r = evolveTetrahedron(simplex);
			if (r.contains) {
				return { intersecting: true, simplex };
			}
			simplex = r.simplex;
			dir = r.dir;
		}

		if (v3LenSq(dir) < EPSILON) {
			return { intersecting: false, simplex };
		}
	}

	return { intersecting: false, simplex };
}

function support(hullA: Vec3[], hullB: Vec3[], d: Vec3): SimplexVertex {
	const a = furthest(hullA, d);
	const b = furthest(hullB, v3Neg(d));
	return { point: v3Sub(a, b), a, b };
}

function furthest(hull: Vec3[], d: Vec3): Vec3 {
	let best = hull[0];
	let bestDot = v3Dot(hull[0], d);
	for (let i = 1; i < hull.length; i++) {
		const dot = v3Dot(hull[i], d);
		if (dot > bestDot) {
			bestDot = dot;
			best = hull[i];
		}
	}
	return best;
}

function centroidOf(pts: Vec3[]): Vec3 {
	let x = 0;
	let y = 0;
	let z = 0;
	for (const p of pts) {
		x += p.x;
		y += p.y;
		z += p.z;
	}
	const n = pts.length || 1;
	return { x: x / n, y: y / n, z: z / n };
}

// ─── Line simplex [B, A] ────────────────────────────────────────────

interface EvolveResult {
	simplex: SimplexVertex[];
	dir: Vec3;
}

interface TetraResult {
	simplex: SimplexVertex[];
	dir: Vec3;
	contains: boolean;
}

function evolveLine(s: SimplexVertex[]): EvolveResult {
	// s = [B, A], A is newest
	const A = s[1].point;
	const B = s[0].point;
	const AB = v3Sub(B, A);
	const AO = v3Neg(A);

	const dot = v3Dot(AB, AO);
	if (dot <= 0) {
		// Origin projects before A
		return { simplex: [s[1]], dir: AO };
	}

	// Origin projects on AB — search perpendicular
	const perp = v3Sub(AO, v3Scale(AB, dot / v3LenSq(AB)));
	if (v3LenSq(perp) < EPSILON) {
		// Origin is on the line AB — pick an arbitrary perpendicular direction
		// to find the third simplex vertex
		return { simplex: s, dir: arbitraryPerpendicular(AB) };
	}
	return { simplex: s, dir: perp };
}

// ─── Triangle simplex [C, B, A] ─────────────────────────────────────

/** Pick an arbitrary vector perpendicular to v */
function arbitraryPerpendicular(v: Vec3): Vec3 {
	// Find the axis most perpendicular to v
	const absX = Math.abs(v.x);
	const absY = Math.abs(v.y);
	const absZ = Math.abs(v.z);
	let other: Vec3;
	if (absX <= absY && absX <= absZ) {
		other = { x: 1, y: 0, z: 0 };
	} else if (absY <= absZ) {
		other = { x: 0, y: 1, z: 0 };
	} else {
		other = { x: 0, y: 0, z: 1 };
	}
	return v3Normalize(v3Cross(v, other));
}

function evolveTriangle(s: SimplexVertex[]): EvolveResult {
	// s = [C, B, A], A is newest
	const A = s[2].point;
	const B = s[1].point;
	const C = s[0].point;

	const AB = v3Sub(B, A);
	const AC = v3Sub(C, A);
	const AO = v3Neg(A);

	// Triangle normal
	const ABC = v3Cross(AB, AC);

	// Degenerate triangle (collinear points) — reduce to line
	if (v3LenSq(ABC) < EPSILON) {
		return evolveLine([s[2], s[1]]);
	}

	// Check which Voronoi region the origin is in
	// Edge AC normal (perpendicular to ABC and AC)
	const edgeACNormal = v3Cross(ABC, AC);
	if (v3Dot(edgeACNormal, AO) > 0) {
		// Origin is outside edge AC → reduce to line [A, C]
		return evolveLine([s[2], s[0]]);
	}

	// Edge AB normal (perpendicular to ABC and AB)
	const edgeABNormal = v3Cross(AB, ABC);
	if (v3Dot(edgeABNormal, AO) > 0) {
		// Origin is outside edge AB → reduce to line [A, B]
		return evolveLine([s[2], s[1]]);
	}

	// Origin is inside the triangle — check which side
	if (v3Dot(ABC, AO) > 0) {
		// Same side as normal
		return { simplex: s, dir: ABC };
	}

	// Behind triangle — flip and try again
	// Swap B and C to flip winding, return negated normal
	return {
		simplex: [s[1], s[0], s[2]], // [B, C, A]
		dir: v3Neg(ABC),
	};
}

// ─── Tetrahedron simplex [D, C, B, A] ───────────────────────────────

function evolveTetrahedron(s: SimplexVertex[]): TetraResult {
	// s = [D, C, B, A], A is newest
	const A = s[3].point;
	const B = s[2].point;
	const C = s[1].point;
	const D = s[0].point;

	const AB = v3Sub(B, A);
	const AC = v3Sub(C, A);
	const AD = v3Sub(D, A);
	const AO = v3Neg(A);

	// Face normals
	const ABC = v3Cross(AB, AC);
	const ACD = v3Cross(AC, AD);
	const ADB = v3Cross(AD, AB);

	// Check if origin is outside any face
	if (v3Dot(ABC, AO) > 0) {
		// Outside ABC → keep [A, B, C]
		return {
			contains: false,
			simplex: [s[1], s[2], s[3]], // [C, B, A]
			dir: ABC,
		};
	}

	if (v3Dot(ACD, AO) > 0) {
		// Outside ACD → keep [A, C, D]
		return {
			contains: false,
			simplex: [s[0], s[1], s[3]], // [D, C, A]
			dir: ACD,
		};
	}

	if (v3Dot(ADB, AO) > 0) {
		// Outside ADB → keep [A, D, B]
		return {
			contains: false,
			simplex: [s[2], s[0], s[3]], // [B, D, A]
			dir: ADB,
		};
	}

	// Origin is inside the tetrahedron
	return { contains: true, simplex: s, dir: AO };
}

/**
 * Get the closest point on the Minkowski difference simplex to the origin.
 */
export function closestPointToOrigin(simplex: SimplexVertex[]): {
	distance: number;
	direction: Vec3;
} {
	if (simplex.length === 0) {
		return { distance: 0, direction: { x: 1, y: 0, z: 0 } };
	}

	let minDist = Infinity;
	let minDir: Vec3 = { x: 1, y: 0, z: 0 };

	for (let i = 0; i < simplex.length; i++) {
		for (let j = i + 1; j < simplex.length; j++) {
			const a = simplex[i].point;
			const b = simplex[j].point;
			const ab = v3Sub(b, a);
			const lenSq = v3LenSq(ab);
			if (lenSq < EPSILON) continue;
			const t = Math.max(0, Math.min(1, -v3Dot(a, ab) / lenSq));
			const closest = v3Add(a, v3Scale(ab, t));
			const dist = v3LenSq(closest);
			if (dist < minDist) {
				minDist = dist;
				const len = Math.sqrt(dist);
				minDir = len > EPSILON ? v3Scale(closest, 1 / len) : { x: 1, y: 0, z: 0 };
			}
		}
	}

	return { distance: Math.sqrt(minDist), direction: minDir };
}
