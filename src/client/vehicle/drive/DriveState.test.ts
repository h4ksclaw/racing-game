import { describe, expect, it } from "vitest";
import { DriveState } from "./DriveState.ts";

describe("DriveState", () => {
	it("returns isBraking=true when pressing backward while moving forward", () => {
		const ds = new DriveState();
		const result = ds.compute(false, true, 5);
		expect(result.isBraking).toBe(true);
		expect(result.isReverse).toBe(false);
	});

	it("returns isReverse=true when pressing backward while stationary", () => {
		const ds = new DriveState();
		const result = ds.compute(false, true, 0);
		expect(result.isReverse).toBe(true);
		expect(result.isBraking).toBe(false);
	});

	it("passes through wantsForward", () => {
		const ds = new DriveState();
		expect(ds.compute(true, false, 0).wantsForward).toBe(true);
	});

	it("effectiveNeutral when no inputs", () => {
		const ds = new DriveState();
		expect(ds.compute(false, false, 5).effectiveNeutral).toBe(true);
	});

	it("effectiveNeutral is false with forward input", () => {
		const ds = new DriveState();
		expect(ds.compute(true, false, 0).effectiveNeutral).toBe(false);
	});

	it("braking when speed above hysteresis (0.15 m/s)", () => {
		const ds = new DriveState();
		expect(ds.compute(false, true, 0.2).isBraking).toBe(true);
	});

	it("reverse when speed below hysteresis", () => {
		const ds = new DriveState();
		expect(ds.compute(false, true, 0.1).isReverse).toBe(true);
	});

	it("always reverse when already moving backward (< -0.3)", () => {
		const ds = new DriveState();
		const result = ds.compute(false, true, -5);
		expect(result.isReverse).toBe(true);
		expect(result.isBraking).toBe(false);
	});

	it("hysteresis: once reverse engaged, stays reverse even if speed increases slightly", () => {
		const ds = new DriveState();
		// First: stationary → reverse
		ds.compute(false, true, 0);
		// Now speed creeps up but prevReverse=true
		const result = ds.compute(false, true, 0.1);
		// Since prevReverse=true, the `localVelX > BRAKE_HYSTERESIS && !prevReverse` check fails
		expect(result.isReverse).toBe(true);
	});

	it("forward input with backward input: backward wins", () => {
		const ds = new DriveState();
		const result = ds.compute(true, true, 0);
		expect(result.isReverse).toBe(true);
	});
});
