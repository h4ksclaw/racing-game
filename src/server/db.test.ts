/**
 * Tests for database module — car queries and asset queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, filterCars, getAllCars, getAssets, searchCars } from "./db.ts";

beforeAll(() => {
	// DB auto-initializes on first call
});

afterAll(() => {
	closeDb();
});

describe("getAllCars", () => {
	it("returns an array", () => {
		const cars = getAllCars();
		expect(Array.isArray(cars)).toBe(true);
	}, 15_000);
});

describe("searchCars", () => {
	it("finds the AE86 when searching for 'ae86'", () => {
		const results = searchCars("ae86");
		expect(results.length).toBeGreaterThan(0);
		const names = results.map((c) => `${c.make} ${c.model}`.toLowerCase());
		expect(names.some((n) => n.includes("ae86"))).toBe(true);
	});
});

describe("getAssets", () => {
	it("returns pending assets when filtered by status", () => {
		const assets = getAssets("pending");
		expect(Array.isArray(assets)).toBe(true);
	});
});

describe("filterCars", () => {
	it("returns RWD cars when filtered by drivetrain", () => {
		const cars = filterCars({ drivetrain: "rwd" });
		expect(cars.length).toBeGreaterThan(0);
		for (const car of cars) {
			expect(car.drivetrain).toBe("rwd");
		}
	});
});
