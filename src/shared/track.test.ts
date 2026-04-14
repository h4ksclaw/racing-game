import { describe, expect, it } from "vitest";
import { generateTrack, mulberry32 } from "./track.ts";

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
			for (const field of [
				"point",
				"left",
				"right",
				"kerbLeft",
				"kerbRight",
				"tangent",
				"binormal",
			] as const) {
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
