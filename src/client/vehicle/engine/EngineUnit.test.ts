import { describe, expect, it } from "vitest";
import { EngineUnit } from "./EngineUnit.ts";

const engineSpec = {
	torqueNm: 150,
	idleRPM: 850,
	maxRPM: 7600,
	redlinePct: 0.85,
	finalDrive: 4.3,
	engineBraking: 0.25,
	torqueCurve: [
		[850, 0.3],
		[3000, 0.85],
		[4800, 1.0],
		[7600, 0.85],
	] as [number, number][],
};

const gearboxSpec = {
	gearRatios: [3.59, 2.06, 1.38, 1.0, 0.85],
	shiftTime: 0.15,
};

describe("EngineUnit", () => {
	it("creates engine and gearbox", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		expect(unit.engine).toBeDefined();
		expect(unit.gearbox).toBeDefined();
	});

	it("isTurbo is false for NA engine", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		expect(unit.isTurbo).toBe(false);
	});

	it("isTurbo is true when turbo is set", () => {
		const unit = new EngineUnit({ ...engineSpec, turbo: true }, gearboxSpec, 0.31);
		expect(unit.isTurbo).toBe(true);
	});

	it("getTelemetry returns valid snapshot", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		const telem = unit.getTelemetry(20);
		expect(telem.rpm).toBe(850); // idle
		expect(telem.gear).toBe(0); // 1st
		expect(telem.displayGear).toBe(1);
		expect(telem.isShifting).toBe(false);
		expect(telem.revLimited).toBe(false);
		expect(telem.clutchEngaged).toBe(true);
	});

	it("update increases RPM with throttle", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		unit.engine.throttle = 1;
		for (let i = 0; i < 50; i++) {
			unit.update(0, 0.016);
		}
		expect(unit.engine.rpm).toBeGreaterThan(850);
	});

	it("getTelemetry speed matches input", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		expect(unit.getTelemetry(15.5).speed).toBe(15.5);
	});

	it("boost is always 0 in telemetry (computed externally)", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		expect(unit.getTelemetry(0).boost).toBe(0);
	});

	it("gearbox starts in 1st gear", () => {
		const unit = new EngineUnit(engineSpec, gearboxSpec, 0.31);
		expect(unit.gearbox.currentGear).toBe(0);
	});
});
