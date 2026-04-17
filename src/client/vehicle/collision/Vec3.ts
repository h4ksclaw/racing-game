/**
 * Vec3 — lightweight 3D vector for collision math.
 *
 * No Three.js dependency. Pure value objects.
 * Used by GJK, EPA, ConvexHull, and CollisionSystem.
 */

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export function v3(x: number, y: number, z: number): Vec3 {
	return { x, y, z };
}

export function v3Zero(): Vec3 {
	return { x: 0, y: 0, z: 0 };
}

export function v3Add(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3Sub(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3Scale(v: Vec3, s: number): Vec3 {
	return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function v3Neg(v: Vec3): Vec3 {
	return { x: -v.x, y: -v.y, z: -v.z };
}

export function v3Dot(a: Vec3, b: Vec3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3Cross(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

export function v3Len(v: Vec3): number {
	return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function v3LenSq(v: Vec3): number {
	return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function v3Normalize(v: Vec3): Vec3 {
	const len = v3Len(v);
	if (len < 1e-10) return v3Zero();
	return v3Scale(v, 1 / len);
}

export function v3Dist(a: Vec3, b: Vec3): number {
	return v3Len(v3Sub(a, b));
}

/** Triple product: a × (b × c) — projects b onto plane perpendicular to a */
export function v3Triple(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	const bc = v3Cross(b, c);
	return v3Cross(a, bc);
}

/** Convert Three.js Vector3-like to Vec3 */
export function fromThree(v: { x: number; y: number; z: number }): Vec3 {
	return { x: v.x, y: v.y, z: v.z };
}

/** Convert Vec3 to Three.js-like object */
export function toThree(v: Vec3): { x: number; y: number; z: number } {
	return { x: v.x, y: v.y, z: v.z };
}
