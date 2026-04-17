/**
 * Tests for 3D collision system.
 *
 * Tests GJK, EPA, CollisionSystem — all pure math, no Three.js.
 */

import { describe, expect, it } from "vitest";
import { checkGround, checkPair, createBody, resolveCollision, resolveGround } from "./CollisionSystem.ts";
import { boxHull, transformHull } from "./ConvexHull.ts";
import { epa } from "./EPA.ts";
import { gjk } from "./GJK.ts";
import { v3, v3Add, v3Cross, v3Dot, v3Len, v3Normalize, v3Sub } from "./Vec3.ts";

// ─── Vec3 ───────────────────────────────────────────────────────────

describe("Vec3", () => {
	it("creates vectors", () => {
		const v = v3(1, 2, 3);
		expect(v.x).toBe(1);
		expect(v.y).toBe(2);
		expect(v.z).toBe(3);
	});

	it("adds vectors", () => {
		const a = v3(1, 2, 3);
		const b = v3(4, 5, 6);
		const c = v3Add(a, b);
		expect(c.x).toBe(5);
		expect(c.y).toBe(7);
		expect(c.z).toBe(9);
	});

	it("subtracts vectors", () => {
		const a = v3(4, 5, 6);
		const b = v3(1, 2, 3);
		const c = v3Sub(a, b);
		expect(c.x).toBe(3);
		expect(c.y).toBe(3);
		expect(c.z).toBe(3);
	});

	it("computes dot product", () => {
		const a = v3(1, 2, 3);
		const b = v3(4, 5, 6);
		expect(v3Dot(a, b)).toBe(32);
	});

	it("computes cross product", () => {
		const x = v3(1, 0, 0);
		const y = v3(0, 1, 0);
		const z = v3Cross(x, y);
		expect(z.x).toBeCloseTo(0);
		expect(z.y).toBeCloseTo(0);
		expect(z.z).toBeCloseTo(1);
	});

	it("computes length", () => {
		const v = v3(3, 4, 0);
		expect(v3Len(v)).toBeCloseTo(5);
	});

	it("normalizes vectors", () => {
		const v = v3(3, 4, 0);
		const n = v3Normalize(v);
		expect(n.x).toBeCloseTo(0.6);
		expect(n.y).toBeCloseTo(0.8);
		expect(v3Len(n)).toBeCloseTo(1);
	});
});

// ─── ConvexHull ─────────────────────────────────────────────────────

describe("ConvexHull", () => {
	it("boxHull returns 8 vertices", () => {
		const hull = boxHull(1, 0.5, 2);
		expect(hull).toHaveLength(8);
	});

	it("boxHull vertices span correct extents", () => {
		const hull = boxHull(1, 0.5, 2);
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const v of hull) {
			minX = Math.min(minX, v.x);
			maxX = Math.max(maxX, v.x);
			minY = Math.min(minY, v.y);
			maxY = Math.max(maxY, v.y);
		}
		expect(minX).toBe(-1);
		expect(maxX).toBe(1);
		expect(minY).toBe(-0.5);
		expect(maxY).toBe(0.5);
	});

	it("transformHull translates and rotates", () => {
		const hull = boxHull(1, 0.5, 1);
		const pos = v3(10, 0, 5);
		const transformed = transformHull(hull, pos, 1, 0);
		for (const v of transformed) {
			expect(v.x).toBeGreaterThanOrEqual(9);
			expect(v.x).toBeLessThanOrEqual(11);
			expect(v.z).toBeGreaterThanOrEqual(4);
			expect(v.z).toBeLessThanOrEqual(6);
		}
	});

	it("transformHull rotates correctly", () => {
		const hull = [v3(1, 0, 0)];
		const transformed = transformHull(hull, v3(0, 0, 0), 0, 1);
		expect(transformed[0].x).toBeCloseTo(0);
		expect(transformed[0].z).toBeCloseTo(1);
	});
});

// ─── GJK ────────────────────────────────────────────────────────────

describe("GJK", () => {
	it("detects overlapping boxes", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(1, 0, 0), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(true);
	});

	it("detects non-overlapping boxes", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(5, 0, 0), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(false);
	});

	it("detects boxes touching at edge", () => {
		const a = boxHull(1, 0.5, 2);
		// Place B exactly at the edge (no overlap)
		const b = transformHull(boxHull(1, 0.5, 2), v3(2.01, 0, 0), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(false);
	});

	it("detects overlapping boxes offset vertically", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(0, 0.5, 0), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(true);
	});

	it("handles boxes far apart", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(100, 100, 100), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(false);
	});

	it("handles small boxes with slight overlap", () => {
		const a = boxHull(0.5, 0.5, 0.5);
		const b = transformHull(boxHull(0.5, 0.5, 0.5), v3(0.1, 0, 0), 1, 0);
		const result = gjk(a, b);
		expect(result.intersecting).toBe(true);
	});
});

// ─── EPA ────────────────────────────────────────────────────────────

describe("EPA", () => {
	it("returns positive depth for overlapping boxes", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(1, 0, 0), 1, 0);
		const gjkResult = gjk(a, b);
		if (!gjkResult.intersecting) {
			throw new Error("GJK should detect overlap");
		}
		const result = epa(gjkResult.simplex, a, b);
		expect(result.depth).toBeGreaterThan(0);
	});

	it("returns a unit normal", () => {
		const a = boxHull(1, 0.5, 2);
		const b = transformHull(boxHull(1, 0.5, 2), v3(1, 0, 0), 1, 0);
		const gjkResult = gjk(a, b);
		if (!gjkResult.intersecting) {
			throw new Error("GJK should detect overlap");
		}
		const result = epa(gjkResult.simplex, a, b);
		const len = v3Len(result.normal);
		expect(len).toBeCloseTo(1, 3);
	});
});

// ─── CollisionSystem ────────────────────────────────────────────────

describe("CollisionSystem", () => {
	describe("createBody", () => {
		it("creates a body with correct hull", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			expect(body.hull).toHaveLength(8);
			expect(body.mass).toBe(1000);
			expect(body.invMass).toBeCloseTo(0.001);
		});

		it("computes inverse inertia tensor", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			// Ix = mass/12 * (h² + d²) = 1000/12 * (0.25 + 4) = 354.17
			// invIx = 1/354.17 ≈ 0.00282
			expect(body.invInertia.x).toBeGreaterThan(0);
			expect(body.invInertia.y).toBeGreaterThan(0);
			expect(body.invInertia.z).toBeGreaterThan(0);
		});
	});

	describe("checkPair", () => {
		it("detects collision between overlapping bodies", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			const b = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(1, 0, 0),
			});
			const result = checkPair(a, b);
			expect(result).not.toBeNull();
			expect(result?.depth).toBeGreaterThan(0);
		});

		it("returns null for separated bodies", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			const b = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(10, 0, 0),
			});
			const result = checkPair(a, b);
			expect(result).toBeNull();
		});
	});

	describe("resolveCollision", () => {
		it("separates overlapping bodies", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			const b = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(1, 0, 0),
			});
			const result = checkPair(a, b);
			if (!result) throw new Error("Expected collision");
			resolveCollision(result, a, b);
			// Bodies should no longer overlap
			const afterCheck = checkPair(a, b);
			expect(afterCheck).toBeNull();
		});

		it("transfers momentum on head-on collision", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			a.vel = v3(10, 0, 0);
			const b = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(1.5, 0, 0),
			});
			b.vel = v3(-10, 0, 0);

			const result = checkPair(a, b);
			if (!result) throw new Error("Expected collision");
			resolveCollision(result, a, b);

			// A should slow down, B should speed up
			expect(a.vel.x).toBeLessThan(10);
			expect(b.vel.x).toBeGreaterThan(-10);
		});

		it("off-center hit may generate angular velocity", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			a.vel = v3(10, 0, 0);
			const b = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(1.5, 0, 1.5),
			});

			const result = checkPair(a, b);
			if (!result) throw new Error("Expected collision");
			resolveCollision(result, a, b);

			// Collision should change velocities (momentum transfer)
			expect(a.vel.x).not.toBe(10);
		});
	});

	describe("checkGround / resolveGround", () => {
		it("detects body below ground", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, -0.3, 0),
			});
			const result = checkGround(body, 0);
			expect(result).not.toBeNull();
			expect(result?.depth).toBeCloseTo(0.8);
		});

		it("returns null when body is above ground", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 1, 0),
			});
			const result = checkGround(body, 0);
			expect(result).toBeNull();
		});

		it("pushes body up to ground level", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, -0.3, 0),
			});
			body.vel = v3(0, -5, 0);
			const result = checkGround(body, 0);
			if (!result) throw new Error("Expected ground collision");
			resolveGround(result, body);
			// After push: center at y = -0.3 + 0.8 = 0.5
			expect(body.pos.y).toBeCloseTo(0.5, 3);
		});

		it("bounces body with restitution", () => {
			const body = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, -0.3, 0),
				restitution: 0.5,
			});
			body.vel = v3(0, -10, 0);
			const result = checkGround(body, 0);
			if (!result) throw new Error("Expected ground collision");
			resolveGround(result, body);
			// Should bounce upward
			expect(body.vel.y).toBeGreaterThan(0);
		});
	});

	describe("3D angular response", () => {
		it("front hit transfers momentum", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			a.vel = v3(0, 0, 10); // moving forward (Z+)
			const b = createBody({
				mass: 10000, // much heavier (wall)
				halfExtents: [5, 2, 0.5],
				pos: v3(0, 0, 1.5),
			});

			const result = checkPair(a, b);
			if (!result) throw new Error("Expected collision");
			resolveCollision(result, a, b);

			// Car should slow down after hitting wall
			expect(a.vel.z).toBeLessThan(10);
		});

		it("side hit transfers momentum", () => {
			const a = createBody({
				mass: 1000,
				halfExtents: [1, 0.5, 2],
				pos: v3(0, 0, 0),
			});
			a.vel = v3(10, 0, 0); // moving right
			const b = createBody({
				mass: 10000,
				halfExtents: [0.5, 2, 5],
				pos: v3(1.2, 0, 0),
			});

			const result = checkPair(a, b);
			if (!result) throw new Error("Expected collision");
			resolveCollision(result, a, b);

			// Car should slow down after hitting wall
			expect(a.vel.x).toBeLessThan(10);
		});
	});
});
