import { describe, expect, it } from "vitest";
import type { Engine } from "./Engine.ts";
import { Gearbox } from "./Gearbox.ts";

function makeEngine(_rpm: number, shouldUp = false, shouldDown = false): Engine {
	return {
		shouldUpshift: () => shouldUp,
		shouldDownshift: () => shouldDown,
	} as unknown as Engine;
}

const makeConfig = (overrides: Record<string, unknown> = {}) =>
	({
		gearRatios: [3.59, 2.06, 1.38, 1.0, 0.85],
		shiftTime: 0.15,
		downshiftThresholds: [0, 35, 55, 75, 100],
		...overrides,
	}) as any;

describe("Gearbox", () => {
	it("starts in 1st gear (index 0)", () => {
		const gb = new Gearbox(makeConfig());
		expect(gb.currentGear).toBe(0);
	});

	it("currentRatio returns ratio for current gear", () => {
		const gb = new Gearbox(makeConfig());
		expect(gb.currentRatio).toBe(3.59);
	});

	it("gearCount returns number of gears", () => {
		const gb = new Gearbox(makeConfig());
		expect(gb.gearCount).toBe(5);
	});

	it("upshifts when engine says shouldUpshift", () => {
		const gb = new Gearbox(makeConfig());
		gb.update(0.016, makeEngine(7000, true), 20, false);
		expect(gb.currentGear).toBe(1);
		expect(gb.isShifting).toBe(true);
	});

	it("downshifts when engine says shouldDownshift", () => {
		const gb = new Gearbox(makeConfig());
		gb.currentGear = 2;
		gb.effectiveRatio = gb.currentRatio;
		gb.update(0.016, makeEngine(1000, false, true), 5, false);
		expect(gb.currentGear).toBe(1);
	});

	it("downshifts on brake below threshold", () => {
		const gb = new Gearbox(makeConfig());
		gb.currentGear = 2;
		gb.effectiveRatio = gb.currentRatio;
		// threshold for gear 2 = 55 km/h, 5 m/s = 18 km/h < 55
		gb.update(0.016, makeEngine(3000, false, false), 5, true);
		expect(gb.currentGear).toBe(1);
	});

	it("does not downshift below 1st gear", () => {
		const gb = new Gearbox(makeConfig());
		gb.update(0.016, makeEngine(800, false, true), 1, true);
		expect(gb.currentGear).toBe(0);
	});

	it("shift completes after shiftTime", () => {
		const gb = new Gearbox(makeConfig({ shiftTime: 0.1 }));
		gb.update(0.016, makeEngine(7000, true), 20, false);
		expect(gb.isShifting).toBe(true);
		// Run update for remaining time
		for (let i = 0; i < 20; i++) {
			gb.update(0.016, makeEngine(3000), 20, false);
		}
		expect(gb.isShifting).toBe(false);
	});

	it("effectiveRatio matches currentRatio after shift", () => {
		const gb = new Gearbox(makeConfig());
		gb.update(0.016, makeEngine(7000, true), 20, false);
		for (let i = 0; i < 20; i++) {
			gb.update(0.016, makeEngine(3000), 20, false);
		}
		expect(gb.effectiveRatio).toBe(gb.currentRatio);
	});

	it("does not upshift beyond last gear", () => {
		const gb = new Gearbox(makeConfig());
		gb.currentGear = 4;
		gb.effectiveRatio = gb.currentRatio;
		gb.update(0.016, makeEngine(8000, true), 50, false);
		expect(gb.currentGear).toBe(4);
	});

	it("initial effectiveRatio is 1st gear ratio", () => {
		const gb = new Gearbox(makeConfig());
		expect(gb.effectiveRatio).toBe(3.59);
	});
});
