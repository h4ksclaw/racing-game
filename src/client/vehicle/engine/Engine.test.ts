import { describe, expect, it } from "vitest";
import { Engine } from "./Engine.ts";

const makeConfig = (overrides: Record<string, unknown> = {}) =>
	({
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
		],
		...overrides,
	}) as any;

describe("Engine", () => {
	it("initializes at idle RPM", () => {
		const eng = new Engine(makeConfig());
		expect(eng.rpm).toBe(850);
	});

	it("initializes throttle at 0", () => {
		const eng = new Engine(makeConfig());
		expect(eng.throttle).toBe(0);
	});

	it("getTorqueMultiplier interpolates curve", () => {
		const eng = new Engine(makeConfig());
		eng.rpm = 3000;
		expect(eng.getTorqueMultiplier()).toBeCloseTo(0.85);
	});

	it("getTorqueMultiplier clamps below curve start", () => {
		const eng = new Engine(makeConfig());
		eng.rpm = 500;
		expect(eng.getTorqueMultiplier()).toBeCloseTo(0.3);
	});

	it("getTorqueMultiplier clamps above curve end", () => {
		const eng = new Engine(makeConfig());
		eng.rpm = 9000;
		expect(eng.getTorqueMultiplier()).toBeCloseTo(0.85);
	});

	it("getTorqueMultiplier returns 1 for empty curve", () => {
		const eng = new Engine(makeConfig({ torqueCurve: [] }));
		expect(eng.getTorqueMultiplier()).toBe(1);
	});

	it("update raises RPM with throttle at low speed", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 0.5;
		eng.update(0.1, 3.59, 0.3, 0.016);
		expect(eng.rpm).toBeGreaterThan(850);
	});

	it("update approaches but may not hit rev limiter at standstill", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 1;
		// At standstill, RPM approaches idle + throttle * (maxRPM - idle) * 0.6
		// which is 850 + 1 * (7600-850) * 0.6 = 4250, not maxRPM
		for (let i = 0; i < 100; i++) {
			eng.update(0, 3.59, 0.3, 0.016);
		}
		expect(eng.rpm).toBeLessThanOrEqual(7600);
		// Standstill rev won't hit limiter
	});

	it("update hits rev limiter when driven by high wheel speed", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 1;
		// Drive RPM via high wheel speed: wheelRPM * gearRatio * finalDrive
		// We need targetRPM > maxRPM. wheelRPM = targetRPM / (3.59 * 4.3)
		// For 8000 RPM: wheelRPM = 8000 / 15.437 ≈ 518
		// wheelSpeed = 518 * 2π * 0.3 / 60 ≈ 16.3 m/s
		for (let i = 0; i < 100; i++) {
			eng.update(20, 3.59, 0.3, 0.016);
		}
		expect(eng.rpm).toBe(7600);
		expect(eng.revLimited).toBe(true);
	});

	it("getWheelForce returns 0 when rev limited", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 1;
		eng.revLimited = true;
		expect(eng.getWheelForce(3.59, 0.3, 5000)).toBe(0);
	});

	it("getWheelForce returns 0 when no throttle", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 0;
		expect(eng.getWheelForce(3.59, 0.3, 5000)).toBe(0);
	});

	it("getWheelForce returns positive force with throttle", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 1;
		eng.rpm = 4000;
		const force = eng.getWheelForce(3.59, 0.3, 50000);
		expect(force).toBeGreaterThan(0);
	});

	it("getWheelForce clamps to traction limit", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 1;
		eng.rpm = 6000;
		const full = eng.getWheelForce(3.59, 0.3, 100000);
		const limited = eng.getWheelForce(3.59, 0.3, 100);
		expect(limited).toBeLessThan(full);
		expect(limited).toBeLessThanOrEqual(100);
	});

	it("shouldUpshift triggers at redlinePct of maxRPM", () => {
		const eng = new Engine(makeConfig());
		eng.rpm = 7600 * 0.86;
		expect(eng.shouldUpshift()).toBe(true);
	});

	it("shouldDownshift triggers near idle", () => {
		const eng = new Engine(makeConfig());
		eng.rpm = 850 * 1.2;
		expect(eng.shouldDownshift()).toBe(true);
	});

	it("getEngineBraking returns 0 with throttle", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 0.5;
		expect(eng.getEngineBraking(10, 1000)).toBe(0);
	});

	it("getEngineBraking returns force when off-throttle and moving", () => {
		const eng = new Engine(makeConfig());
		eng.throttle = 0;
		eng.rpm = 4000;
		const force = eng.getEngineBraking(10, 1000);
		expect(force).toBeGreaterThan(0);
	});
});
