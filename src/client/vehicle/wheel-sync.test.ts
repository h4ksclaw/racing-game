import { describe, expect, it } from "vitest";

/**
 * Wheel visual sync tests — verifies pivot positioning math.
 *
 * The renderer sets pivot.position.y = basePos.y + suspOffset where
 * suspOffset = -susLen (the full Rapier suspension length).
 *
 * The wheel's world-Y is then: bodyY + modelGroundOffset + pivot.position.y
 * transformed by the body quaternion. This test verifies the math for
 * various body orientations (level, slope, flip) and suspension states.
 */

// Simplified quaternion rotation of a point (Q × p, Y component only).
function rotatedY(q: { x: number; y: number; z: number; w: number }, p: { x: number; y: number; z: number }): number {
	return (
		2 * (q.x * q.y + q.w * q.z) * p.x + (1 - 2 * (q.x * q.x + q.z * q.z)) * p.y + 2 * (q.y * q.z - q.w * q.x) * p.z
	);
}

// Quaternion from axis-angle.
function quatFromAxisAngle(ax: number, ay: number, az: number, angle: number) {
	const half = angle / 2;
	const s = Math.sin(half);
	return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(half) };
}

// Simulate the sync() pivot positioning and return world-Y of the wheel center.
function computeWheelWorldY(
	bodyY: number,
	modelGroundOffset: number,
	basePos: { x: number; y: number; z: number },
	susLen: number,
	quaternion: { x: number; y: number; z: number; w: number },
): number {
	const suspOffset = -susLen;
	const pivotLocalY = basePos.y + suspOffset;
	// The wheel center world-Y = body rotation applied to (basePos.x, pivotLocalY, basePos.z)
	// then translated by (bodyX, bodyY + modelGroundOffset, bodyZ)
	const rotated = rotatedY(quaternion, { x: basePos.x, y: pivotLocalY, z: basePos.z });
	return bodyY + modelGroundOffset + rotated;
}

// Test parameters matching RACE_CAR config (before autoDerive overrides).
const HALF_H = 0.3;
const BODY_TOP = 0.6;
const WHEEL_CENTER_Y = 0.0;
const GROUND_OFFSET = HALF_H - BODY_TOP; // -0.3
const BASE_POS_Y = WHEEL_CENTER_Y; // wheel marker at GLB origin
const SUS_REST = 0.3;

describe("wheel sync", () => {
	describe("level ground", () => {
		const identityQ = { x: 0, y: 0, z: 0, w: 1 };
		const basePos = { x: 0.35, y: BASE_POS_Y, z: 0.64 };
		const bodyY = 1.0;

		it("wheel center sits at anchor - susLen in world space", () => {
			const susLen = SUS_REST;
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, identityQ);
			// anchor world-Y = bodyY - halfH = 0.7
			// physics wheel center = 0.7 - 0.3 = 0.4
			expect(wy).toBeCloseTo(0.4, 3);
		});

		it("compressed suspension moves wheel UP toward body", () => {
			const susLen = 0.15; // half rest = compressed
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, identityQ);
			// 0.7 - 0.15 = 0.55
			expect(wy).toBeCloseTo(0.55, 3);
		});

		it("extended suspension moves wheel DOWN from body", () => {
			const susLen = 0.4; // extended beyond rest
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, identityQ);
			// 0.7 - 0.4 = 0.3
			expect(wy).toBeCloseTo(0.3, 3);
		});

		it("full compression (susLen=0) puts wheel at anchor", () => {
			const susLen = 0;
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, identityQ);
			// 0.7 - 0 = 0.7 (at anchor level)
			expect(wy).toBeCloseTo(0.7, 3);
		});
	});

	describe("uphill slope (15° pitch)", () => {
		// Car facing uphill = pitched back around X axis
		const pitch15 = quatFromAxisAngle(1, 0, 0, (-15 * Math.PI) / 180);
		const frontWheel = { x: 0.35, y: BASE_POS_Y, z: 0.64 };
		const rearWheel = { x: 0.35, y: BASE_POS_Y, z: -0.88 };
		const bodyY = 1.0;
		const susLen = SUS_REST;

		it("front wheel is HIGHER than rear wheel (car faces uphill)", () => {
			const frontY = computeWheelWorldY(bodyY, GROUND_OFFSET, frontWheel, susLen, pitch15);
			const rearY = computeWheelWorldY(bodyY, GROUND_OFFSET, rearWheel, susLen, pitch15);
			expect(frontY).toBeGreaterThan(rearY);
		});

		it("wheels follow body rotation — no flat-world compensation", () => {
			// On a 15° slope, front wheel should be ~0.64*sin(15°) ≈ 0.166m higher
			const frontY = computeWheelWorldY(bodyY, GROUND_OFFSET, frontWheel, susLen, pitch15);
			const rearY = computeWheelWorldY(bodyY, GROUND_OFFSET, rearWheel, susLen, pitch15);
			const heightDiff = frontY - rearY;
			// Front-rear distance = 0.64 + 0.88 = 1.52
			// Height diff ≈ 1.52 * sin(15°) ≈ 0.393
			expect(heightDiff).toBeCloseTo(1.52 * Math.sin((15 * Math.PI) / 180), 2);
		});
	});

	describe("downhill slope (-15° pitch)", () => {
		const pitchDown = quatFromAxisAngle(1, 0, 0, (15 * Math.PI) / 180);
		const frontWheel = { x: 0.35, y: BASE_POS_Y, z: 0.64 };
		const rearWheel = { x: 0.35, y: BASE_POS_Y, z: -0.88 };
		const bodyY = 1.0;
		const susLen = SUS_REST;

		it("rear wheel is HIGHER than front wheel (car faces downhill)", () => {
			const frontY = computeWheelWorldY(bodyY, GROUND_OFFSET, frontWheel, susLen, pitchDown);
			const rearY = computeWheelWorldY(bodyY, GROUND_OFFSET, rearWheel, susLen, pitchDown);
			expect(rearY).toBeGreaterThan(frontY);
		});
	});

	describe("body roll (10° around Z axis)", () => {
		const roll10 = quatFromAxisAngle(0, 0, 1, (10 * Math.PI) / 180);
		const leftWheel = { x: -0.35, y: BASE_POS_Y, z: 0.0 };
		const rightWheel = { x: 0.35, y: BASE_POS_Y, z: 0.0 };
		const bodyY = 1.0;
		const susLen = SUS_REST;

		it("left wheel is LOWER than right wheel (rolled right)", () => {
			const leftY = computeWheelWorldY(bodyY, GROUND_OFFSET, leftWheel, susLen, roll10);
			const rightY = computeWheelWorldY(bodyY, GROUND_OFFSET, rightWheel, susLen, roll10);
			expect(leftY).toBeLessThan(rightY);
		});

		it("height difference matches sin(10°) × track width", () => {
			const leftY = computeWheelWorldY(bodyY, GROUND_OFFSET, leftWheel, susLen, roll10);
			const rightY = computeWheelWorldY(bodyY, GROUND_OFFSET, rightWheel, susLen, roll10);
			const heightDiff = rightY - leftY;
			// Track width = 0.7, height diff ≈ 0.7 * sin(10°) ≈ 0.122
			expect(heightDiff).toBeCloseTo(0.7 * Math.sin((10 * Math.PI) / 180), 2);
		});
	});

	describe("flipped car (180° pitch)", () => {
		const flipQ = quatFromAxisAngle(1, 0, 0, Math.PI);
		const basePos = { x: 0.35, y: BASE_POS_Y, z: 0.64 };
		const bodyY = 1.0;
		const susLen = SUS_REST;

		it("wheels are above the anchor (upside down, suspension hangs)", () => {
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, flipQ);
			// When flipped, the anchor (at body-local -Y) flips to above body center.
			// Wheels hang below the anchor (which is now above).
			const anchorY = bodyY + GROUND_OFFSET + rotatedY(flipQ, { x: basePos.x, y: BASE_POS_Y, z: basePos.z });
			expect(wy).toBeGreaterThan(anchorY);
		});

		it("wheels don't fly off to infinity — no compensation explosion", () => {
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, flipQ);
			// Should be at bodyY + 0.7 + modelGroundOffset (negated by flip) + susLen
			// = 1.0 - (-0.3) + 0.3 + 0.3 = 1.9 (approximate, depends on full rotation)
			expect(wy).toBeLessThan(3.0); // sane upper bound
			expect(wy).toBeGreaterThan(0); // positive
		});
	});

	describe("combined pitch + roll (cornering on slope)", () => {
		// 8° pitch + 5° roll — typical cornering on a hill
		const pitch = quatFromAxisAngle(1, 0, 0, (-8 * Math.PI) / 180);
		const roll = quatFromAxisAngle(0, 0, 1, (5 * Math.PI) / 180);
		// Combine quaternions: Q = roll × pitch
		const combined = {
			x: roll.w * pitch.x + roll.x * pitch.w + roll.y * pitch.z - roll.z * pitch.y,
			y: roll.w * pitch.y - roll.x * pitch.z + roll.y * pitch.w + roll.z * pitch.x,
			z: roll.w * pitch.z + roll.x * pitch.y - roll.y * pitch.x + roll.z * pitch.w,
			w: roll.w * pitch.w - roll.x * pitch.x - roll.y * pitch.y - roll.z * pitch.z,
		};

		const basePos = { x: -0.35, y: BASE_POS_Y, z: 0.64 };
		const bodyY = 1.0;
		const susLen = SUS_REST;

		it("produces a finite, reasonable wheel position", () => {
			const wy = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, combined);
			expect(Number.isFinite(wy)).toBe(true);
			expect(wy).toBeGreaterThan(0);
			expect(wy).toBeLessThan(3.0);
		});
	});

	describe("anchor-alignment invariant", () => {
		// Regardless of body orientation, the distance from wheel center to anchor
		// in body-local space should always equal susLen.
		const orientations = [
			{ name: "level", q: { x: 0, y: 0, z: 0, w: 1 } },
			{ name: "pitch 30°", q: quatFromAxisAngle(1, 0, 0, (-30 * Math.PI) / 180) },
			{ name: "roll 20°", q: quatFromAxisAngle(0, 0, 1, (20 * Math.PI) / 180) },
			{ name: "flip", q: quatFromAxisAngle(1, 0, 0, Math.PI) },
			{ name: "yaw 45°", q: quatFromAxisAngle(0, 1, 0, (45 * Math.PI) / 180) },
		];

		const basePos = { x: 0.35, y: BASE_POS_Y, z: 0.64 };
		const bodyY = 1.0;
		for (const { name, q } of orientations) {
			it(`suspension offset is -susLen regardless of orientation (${name})`, () => {
				const susLen = 0.22;
				const wheelWorldY = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, susLen, q);
				const noSuspWorldY = computeWheelWorldY(bodyY, GROUND_OFFSET, basePos, 0, q);
				// With no suspension, pivot is at basePos.y. With susLen, pivot shifts by -susLen.
				// The world-Y difference equals the rotated Y-component of (0, -susLen, 0).
				const deltaY = wheelWorldY - noSuspWorldY;
				const expectedDelta = rotatedY(q, { x: 0, y: -susLen, z: 0 });
				expect(deltaY).toBeCloseTo(expectedDelta, 3);
			});
		}
	});
});
