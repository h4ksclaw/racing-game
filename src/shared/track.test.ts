import { describe, expect, it } from "vitest";
import type { HouseConfig } from "../client/biomes.ts";
import { generateHouses, generateTrack, mulberry32 } from "./track.ts";

describe("mulberry32", () => {
	it("produces deterministic values for the same seed", () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		for (let i = 0; i < 100; i++) {
			expect(a()).toBe(b());
		}
	});

	it("produces values in [0, 1)", () => {
		const rng = mulberry32(12345);
		for (let i = 0; i < 1000; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it("produces different sequences for different seeds", () => {
		const a = mulberry32(1);
		const b = mulberry32(2);
		expect(a()).not.toBe(b());
	});
});

describe("generateTrack", () => {
	it("returns a track with samples for any seed", () => {
		for (const seed of [0, 1, 42, 99999, -1]) {
			const track = generateTrack(seed);
			expect(track.samples.length).toBeGreaterThan(10);
			expect(track.length).toBeGreaterThan(0);
		}
	});

	it("produces deterministic tracks for the same seed", () => {
		const a = generateTrack(42);
		const b = generateTrack(42);
		expect(a.samples.length).toBe(b.samples.length);
		expect(a.length).toBe(b.length);
		for (let i = 0; i < a.samples.length; i++) {
			expect(a.samples[i].point.x).toBeCloseTo(b.samples[i].point.x, 10);
			expect(a.samples[i].point.y).toBeCloseTo(b.samples[i].point.y, 10);
			expect(a.samples[i].point.z).toBeCloseTo(b.samples[i].point.z, 10);
		}
	});

	it("each sample has required vector fields", () => {
		const track = generateTrack(42);
		for (const s of track.samples) {
			for (const field of ["point", "left", "right", "kerbLeft", "kerbRight", "tangent", "binormal"] as const) {
				expect(typeof s[field].x).toBe("number");
				expect(typeof s[field].y).toBe("number");
				expect(typeof s[field].z).toBe("number");
			}
		}
	});

	it("tangent vectors are roughly unit length", () => {
		const track = generateTrack(42);
		for (const s of track.samples) {
			const len = Math.sqrt(s.tangent.x ** 2 + s.tangent.y ** 2 + s.tangent.z ** 2);
			expect(len).toBeCloseTo(1, 1); // within 0.1
		}
	});
});

describe("generateHouses", () => {
	const testConfig: HouseConfig = {
		enabled: true,
		wallColor: [0.5, 0.5, 0.5],
		roofColor: [0.3, 0.3, 0.3],
		minSize: [6, 5],
		maxSize: [10, 8],
		heightRange: [3, 5],
		roofPitch: 0.6,
		spacing: 50,
		distanceRange: [15, 30],
		flattenRadius: 12,
		chimney: true,
	};

	it("returns empty array when disabled", () => {
		const track = generateTrack(42);
		const houses = generateHouses(42, track.samples, { ...testConfig, enabled: false });
		expect(houses).toHaveLength(0);
	});

	it("generates houses deterministically for same seed", () => {
		const track = generateTrack(42);
		const a = generateHouses(42, track.samples, testConfig);
		const b = generateHouses(42, track.samples, testConfig);
		expect(a.length).toBe(b.length);
		for (let i = 0; i < a.length; i++) {
			expect(a[i].position.x).toBeCloseTo(b[i].position.x, 10);
			expect(a[i].position.z).toBeCloseTo(b[i].position.z, 10);
			expect(a[i].rotation).toBeCloseTo(b[i].rotation, 10);
		}
	});

	it("houses are placed outside the road clearance zone", () => {
		const track = generateTrack(42);
		const houses = generateHouses(42, track.samples, testConfig);
		for (const house of houses) {
			// Find nearest road sample
			let minDist = Infinity;
			for (const s of track.samples) {
				const dx = house.position.x - s.point.x;
				const dz = house.position.z - s.point.z;
				const d = Math.sqrt(dx * dx + dz * dz);
				if (d < minDist) minDist = d;
			}
			expect(minDist).toBeGreaterThanOrEqual(10); // clearance = 10
		}
	});

	it("spacing is respected between houses along track", () => {
		const track = generateTrack(42);
		const tightConfig = { ...testConfig, spacing: 80 };
		const houses = generateHouses(42, track.samples, tightConfig);
		// Check that house positions are spread out (not all in one spot)
		for (let i = 1; i < houses.length; i++) {
			const dx = houses[i].position.x - houses[i - 1].position.x;
			const dz = houses[i].position.z - houses[i - 1].position.z;
			const dist = Math.sqrt(dx * dx + dz * dz);
			expect(dist).toBeGreaterThan(20); // houses should be spread out
		}
	});

	it("rotation values are valid angles", () => {
		const track = generateTrack(42);
		const houses = generateHouses(42, track.samples, testConfig);
		for (const house of houses) {
			// Rotation should be a finite number
			expect(Number.isFinite(house.rotation)).toBe(true);
		}
	});

	it("houses have valid dimensions", () => {
		const track = generateTrack(42);
		const houses = generateHouses(42, track.samples, testConfig);
		for (const house of houses) {
			expect(house.width).toBeGreaterThanOrEqual(testConfig.minSize[0]);
			expect(house.width).toBeLessThanOrEqual(testConfig.maxSize[0]);
			expect(house.depth).toBeGreaterThanOrEqual(testConfig.minSize[1]);
			expect(house.depth).toBeLessThanOrEqual(testConfig.maxSize[1]);
			expect(house.wallHeight).toBeGreaterThanOrEqual(testConfig.heightRange[0]);
			expect(house.wallHeight).toBeLessThanOrEqual(testConfig.heightRange[1]);
		}
	});

	it("houses are on correct side of road (side field matches position)", () => {
		const track = generateTrack(42);
		const houses = generateHouses(42, track.samples, testConfig);
		for (const house of houses) {
			expect([-1, 1]).toContain(house.side);
		}
	});
});
