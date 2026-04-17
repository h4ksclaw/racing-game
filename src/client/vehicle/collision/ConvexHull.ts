/**
 * ConvexHull — 3D convex hull computation from point cloud.
 *
 * Uses the incremental method (gift wrapping variant) for simplicity.
 * Returns vertices of the hull in counter-clockwise winding order.
 *
 * Pure math module. No Three.js dependency.
 */

import type { Vec3 } from "./Vec3.ts";
import { v3Add, v3Cross, v3Dot, v3LenSq, v3Neg, v3Normalize, v3Scale, v3Sub } from "./Vec3.ts";

interface Triangle {
	a: Vec3;
	b: Vec3;
	c: Vec3;
	normal: Vec3;
}

/**
 * Compute 3D convex hull from a set of points.
 * Returns the hull vertices (unique, in no particular order).
 *
 * For performance, callers should cache the result.
 * Uses incremental construction: tetrahedron → face expansion.
 */
export function computeConvexHull(points: Vec3[]): Vec3[] {
	if (points.length < 4) {
		return [...points];
	}

	// Find extreme points for initial tetrahedron
	const extreme = findExtremes(points);
	if (!extreme) return [...points];

	const { p0, p1, p2, p3 } = extreme;

	// Build faces of initial tetrahedron
	const faces: Triangle[] = [];
	const orientations = [
		[p0, p1, p2],
		[p0, p1, p3],
		[p0, p2, p3],
		[p1, p2, p3],
	];

	// Ensure consistent outward-facing normals
	const centroid = v3Scale(v3Add(v3Add(p0, p1), v3Add(p2, p3)), 0.25);

	for (const [a, b, c] of orientations) {
		const normal = computeNormal(a, b, c);
		const faceCenter = v3Scale(v3Add(v3Add(a, b), c), 1 / 3);
		const toCentroid = v3Sub(centroid, faceCenter);
		if (v3Dot(normal, toCentroid) > 0) {
			faces.push({ a, b: c, c: b, normal: v3Neg(normal) });
		} else {
			faces.push({ a, b, c, normal });
		}
	}

	// Expand hull: for each remaining point, check if it's outside any face
	for (const point of points) {
		if (point === p0 || point === p1 || point === p2 || point === p3) continue;

		const visibleFaces: number[] = [];
		for (let i = 0; i < faces.length; i++) {
			const toPoint = v3Sub(point, faces[i].a);
			if (v3Dot(faces[i].normal, toPoint) > 0) {
				visibleFaces.push(i);
			}
		}

		if (visibleFaces.length === 0) continue; // Inside hull

		// Find horizon edges (edges shared by visible and non-visible faces)
		const horizonEdges: Array<[Vec3, Vec3]> = [];
		const visibleSet = new Set(visibleFaces);

		for (const fi of visibleFaces) {
			const face = faces[fi];
			const edges: Array<[Vec3, Vec3]> = [
				[face.a, face.b],
				[face.b, face.c],
				[face.c, face.a],
			];

			for (const [ea, eb] of edges) {
				let isHorizon = true;
				for (let j = 0; j < faces.length; j++) {
					if (visibleSet.has(j)) continue;
					const other = faces[j];
					const otherEdges: Array<[Vec3, Vec3]> = [
						[other.a, other.b],
						[other.b, other.c],
						[other.c, other.a],
					];
					for (const [oa, ob] of otherEdges) {
						if ((ea === oa && eb === ob) || (ea === ob && eb === oa)) {
							isHorizon = false;
							break;
						}
					}
					if (!isHorizon) break;
				}
				if (isHorizon) {
					horizonEdges.push([ea, eb]);
				}
			}
		}

		// Remove visible faces (reverse order to maintain indices)
		const sortedVisible = visibleFaces.sort((a, b) => b - a);
		for (const fi of sortedVisible) {
			faces.splice(fi, 1);
		}

		// Add new faces from horizon edges to point
		for (const [ea, eb] of horizonEdges) {
			const normal = computeNormal(ea, eb, point);
			const faceCenter = v3Scale(v3Add(v3Add(ea, eb), point), 1 / 3);
			const toPoint = v3Sub(point, faceCenter);
			if (v3Dot(normal, toPoint) > 0) {
				faces.push({ a: ea, b: eb, c: point, normal });
			} else {
				faces.push({ a: ea, b: point, c: eb, normal: v3Neg(normal) });
			}
		}
	}

	// Extract unique vertices from faces
	const vertexSet = new Set<Vec3>();
	for (const face of faces) {
		vertexSet.add(face.a);
		vertexSet.add(face.b);
		vertexSet.add(face.c);
	}

	return [...vertexSet];
}

function computeNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	return v3Normalize(v3Cross(v3Sub(b, a), v3Sub(c, a)));
}

function findExtremes(points: Vec3[]): { p0: Vec3; p1: Vec3; p2: Vec3; p3: Vec3 } | null {
	if (points.length < 4) return null;

	// Find most separated points
	let p0 = points[0];
	let p1 = points[0];
	let p2 = points[0];
	let p3 = points[0];

	// p0: min x
	for (const p of points) {
		if (p.x < p0.x) p0 = p;
	}
	// p1: max x
	for (const p of points) {
		if (p.x > p1.x) p1 = p;
	}
	// p2: farthest from line p0-p1
	let maxDist2 = -1;
	for (const p of points) {
		const d = distToLineSq(p, p0, p1);
		if (d > maxDist2) {
			maxDist2 = d;
			p2 = p;
		}
	}
	if (maxDist2 < 1e-10) return null;

	// p3: farthest from plane p0-p1-p2
	const planeNormal = v3Normalize(v3Cross(v3Sub(p1, p0), v3Sub(p2, p0)));
	let maxDist3 = -1;
	for (const p of points) {
		const d = Math.abs(v3Dot(v3Sub(p, p0), planeNormal));
		if (d > maxDist3) {
			maxDist3 = d;
			p3 = p;
		}
	}
	if (maxDist3 < 1e-10) return null;

	return { p0, p1, p2, p3 };
}

function distToLineSq(p: Vec3, a: Vec3, b: Vec3): number {
	const ab = v3Sub(b, a);
	const ap = v3Sub(p, a);
	const lenSq = v3LenSq(ab);
	if (lenSq < 1e-10) return v3LenSq(ap);
	const t = v3Dot(ap, ab) / lenSq;
	const closest = v3Add(a, v3Scale(ab, Math.max(0, Math.min(1, t))));
	return v3LenSq(v3Sub(p, closest));
}

/**
 * Build a box-shaped convex hull from half-extents.
 * Returns 8 vertices of an axis-aligned box centered at origin.
 */
export function boxHull(halfW: number, halfH: number, halfD: number): Vec3[] {
	return [
		{ x: -halfW, y: -halfH, z: -halfD },
		{ x: halfW, y: -halfH, z: -halfD },
		{ x: halfW, y: halfH, z: -halfD },
		{ x: -halfW, y: halfH, z: -halfD },
		{ x: -halfW, y: -halfH, z: halfD },
		{ x: halfW, y: -halfH, z: halfD },
		{ x: halfW, y: halfH, z: halfD },
		{ x: -halfW, y: halfH, z: halfD },
	];
}

/**
 * Transform hull vertices by position and rotation (yaw only for now).
 */
export function transformHull(verts: Vec3[], pos: Vec3, cosY: number, sinY: number): Vec3[] {
	return verts.map((v) => ({
		x: v.x * cosY - v.z * sinY + pos.x,
		y: v.y + pos.y,
		z: v.x * sinY + v.z * cosY + pos.z,
	}));
}
