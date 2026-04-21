import { describe, expect, it } from "vitest";
import {
	generateHouses,
	generateScenery,
	generateTrack,
	type HouseConfig,
	mulberry32,
	type TrackSample,
} from "./track.js";

describe("mulberry32", () => {
	it("returns a function", () => {
		expect(typeof mulberry32(42)).toBe("function");
	});

	it("produces deterministic sequence for same seed", () => {
		const rng1 = mulberry32(12345);
		const rng2 = mulberry32(12345);
		for (let i = 0; i < 100; i++) {
			expect(rng1()).toBe(rng2());
		}
	});

	it("produces different values for different seeds", () => {
		const rng1 = mulberry32(1);
		const rng2 = mulberry32(999);
		const vals1 = Array.from({ length: 10 }, () => rng1());
		const vals2 = Array.from({ length: 10 }, () => rng2());
		expect(vals1).not.toEqual(vals2);
	});

	it("produces values in [0, 1) range", () => {
		const rng = mulberry32(42);
		for (let i = 0; i < 1000; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe("generateTrack", () => {
	it("returns identical output for same seed", () => {
		const a = generateTrack(42);
		const b = generateTrack(42);
		expect(a.numSamples).toBe(b.numSamples);
		expect(a.samples.length).toBe(b.samples.length);
		for (let i = 0; i < a.samples.length; i++) {
			expect(a.samples[i].point.x).toBeCloseTo(b.samples[i].point.x, 10);
			expect(a.samples[i].point.y).toBeCloseTo(b.samples[i].point.y, 10);
			expect(a.samples[i].point.z).toBeCloseTo(b.samples[i].point.z, 10);
		}
	});

	it("returns different tracks for different seeds", () => {
		const a = generateTrack(1);
		const b = generateTrack(2);
		expect(a.samples[0].point.x).not.toBeCloseTo(b.samples[0].point.x, 5);
	});

	it("populates all TrackData fields with valid data", () => {
		const track = generateTrack(99);
		expect(track.controlPoints3D.length).toBeGreaterThan(0);
		expect(track.samples.length).toBeGreaterThan(0);
		expect(track.splinePoints.length).toBeGreaterThan(0);
		expect(track.roadVerts.length).toBeGreaterThan(0);
		expect(track.roadUVs.length).toBeGreaterThan(0);
		expect(track.roadIndices.length).toBeGreaterThan(0);
		expect(track.kerbVerts.length).toBeGreaterThan(0);
		expect(track.kerbColors.length).toBeGreaterThan(0);
		expect(track.kerbIndices.length).toBeGreaterThan(0);
		expect(track.grassVerts.length).toBeGreaterThan(0);
		expect(track.grassColors.length).toBeGreaterThan(0);
		expect(track.grassIndices.length).toBeGreaterThan(0);
		expect(track.centerVerts.length).toBeGreaterThan(0);
		expect(track.centerIndices.length).toBeGreaterThan(0);
		expect(track.checkerVerts.length).toBeGreaterThan(0);
		expect(track.checkerIndices.length).toBeGreaterThan(0);
		expect(track.length).toBeGreaterThan(0);
		expect(track.numControlPoints).toBe(track.controlPoints3D.length);
		expect(track.numSamples).toBe(track.samples.length);
		expect(track.elevationRange.max).toBeGreaterThanOrEqual(track.elevationRange.min);
		expect(track.maxExtent).toBeGreaterThan(0);
	});

	it("produces valid TrackSample entries", () => {
		const track = generateTrack(7);
		for (const s of track.samples) {
			for (const key of [
				"point",
				"left",
				"right",
				"kerbLeft",
				"kerbRight",
				"grassLeft",
				"grassRight",
				"binormal",
				"tangent",
			] as const) {
				expect(typeof s[key].x).toBe("number");
				expect(typeof s[key].y).toBe("number");
				expect(typeof s[key].z).toBe("number");
				expect(Number.isNaN(s[key].x)).toBe(false);
			}
		}
	});

	it("respects custom roadWidth option", () => {
		const narrow = generateTrack(10, { width: 4 });
		const wide = generateTrack(10, { width: 20 });
		// Road width affects left/right offsets
		const narrowWidth = Math.abs(narrow.samples[0].right.x - narrow.samples[0].left.x);
		const wideWidth = Math.abs(wide.samples[0].right.x - wide.samples[0].left.x);
		expect(wideWidth).toBeGreaterThan(narrowWidth);
	});

	it("handles very short track via minSamples", () => {
		const track = generateTrack(5, { minSamples: 50 });
		expect(track.numSamples).toBeGreaterThanOrEqual(50);
	});

	it("handles very long track with high minSamples", () => {
		const track = generateTrack(5, { minSamples: 2000 });
		expect(track.numSamples).toBeGreaterThanOrEqual(1999); // splineClean drops last sample
	});
});

describe("generateScenery", () => {
	const makeSamples = (seed: number, count: number): TrackSample[] => {
		const track = generateTrack(seed, { minSamples: count });
		return track.samples;
	};

	it("returns identical output for same seed and samples", () => {
		const samples = makeSamples(42, 100);
		const a = generateScenery(1, samples);
		const b = generateScenery(1, samples);
		expect(a.length).toBe(b.length);
		for (let i = 0; i < a.length; i++) {
			expect(a[i].type).toBe(b[i].type);
			expect(a[i].position.x).toBeCloseTo(b[i].position.x, 10);
			expect(a[i].scale).toBeCloseTo(b[i].scale, 10);
		}
	});

	it("returns valid SceneryItem entries", () => {
		const samples = makeSamples(42, 100);
		const items = generateScenery(1, samples, { sceneryDensity: 0.5 });
		for (const item of items) {
			expect(typeof item.type).toBe("string");
			expect(typeof item.position.x).toBe("number");
			expect(typeof item.rotation).toBe("number");
			expect(typeof item.scale).toBe("number");
			expect(item.scale).toBeGreaterThan(0);
		}
	});

	it("returns empty array for empty samples", () => {
		const items = generateScenery(1, []);
		expect(items).toEqual([]);
	});

	it("produces multiple scenery types", () => {
		const samples = makeSamples(42, 100);
		const items = generateScenery(1, samples, { sceneryDensity: 0.5 });
		const types = new Set(items.map((i) => i.type));
		expect(types.size).toBeGreaterThan(1);
	});
});

describe("generateHouses", () => {
	const makeSamples = (seed: number, count: number): TrackSample[] => {
		const track = generateTrack(seed, { minSamples: count });
		return track.samples;
	};

	const defaultConfig: HouseConfig = {
		enabled: true,
		wallColor: [0.9, 0.85, 0.8],
		roofColor: [0.4, 0.2, 0.1],
		minSize: [6, 8],
		maxSize: [10, 14],
		heightRange: [3, 5],
		roofPitch: 0.5,
		spacing: 50,
		distanceRange: [15, 30],
		flattenRadius: 12,
		chimney: false,
	};

	it("returns identical output for same seed and samples", () => {
		const samples = makeSamples(42, 200);
		const a = generateHouses(1, samples, defaultConfig);
		const b = generateHouses(1, samples, defaultConfig);
		expect(a.length).toBe(b.length);
		for (let i = 0; i < a.length; i++) {
			expect(a[i].position.x).toBeCloseTo(b[i].position.x, 10);
			expect(a[i].rotation).toBeCloseTo(b[i].rotation, 10);
		}
	});

	it("returns valid HouseItem entries", () => {
		const samples = makeSamples(42, 200);
		const houses = generateHouses(1, samples, defaultConfig);
		for (const h of houses) {
			expect(typeof h.position.x).toBe("number");
			expect(typeof h.rotation).toBe("number");
			expect(typeof h.width).toBe("number");
			expect(typeof h.depth).toBe("number");
			expect(typeof h.wallHeight).toBe("number");
			expect(typeof h.roofPitch).toBe("number");
			expect(h.side === -1 || h.side === 1).toBe(true);
		}
	});

	it("returns empty array for empty samples", () => {
		const houses = generateHouses(1, [], defaultConfig);
		expect(houses).toEqual([]);
	});

	it("returns empty array when disabled", () => {
		const samples = makeSamples(42, 200);
		const houses = generateHouses(1, samples, { ...defaultConfig, enabled: false });
		expect(houses).toEqual([]);
	});
});
