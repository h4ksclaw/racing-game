import { describe, expect, it } from "vitest";
import { computeForces, type EngineState, type ForceInput, type GearboxState } from "./ForceComputer.ts";

const engineSpec = { torqueNm: 150, finalDrive: 4.3, gearRatios: [3.59, 2.06, 1.38], maxBrakeG: 1.2 };
const chassis = { mass: 1000, wheelRadius: 0.31 };
const drag = { aeroDrag: 0.44 };

const defaultInput: ForceInput = {
	dsIsBraking: false,
	dsIsReverse: false,
	dsNeutral: false,
	absSpeedMs: 10,
	localVelX: 10,
	heading: 0,
	handbrake: false,
	wantsForward: true,
	tractionPerWheel: 5000,
};

const defaultEngine: EngineState = {
	throttle: 1,
	rpm: 4000,
	revLimited: false,
	config: { engineBraking: 0.25, maxRPM: 7600 },
	getWheelForce: () => 3000,
	getTorqueMultiplier: () => 1,
};

const defaultGearbox: GearboxState = { effectiveRatio: 3.59, isShifting: false };

describe("computeForces", () => {
	it("returns positive engine force when wanting forward", () => {
		const result = computeForces(defaultInput, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.engF).toBeGreaterThan(0);
	});

	it("engine force is 0 when wantsForward is false", () => {
		const input = { ...defaultInput, wantsForward: false };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.engF).toBe(0);
	});

	it("engine force is 0 when handbrake is on", () => {
		const input = { ...defaultInput, handbrake: true };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.engF).toBe(0);
	});

	it("engine force reduced by 0.3 when shifting", () => {
		const gearbox = { ...defaultGearbox, isShifting: true };
		const result = computeForces(defaultInput, defaultEngine, gearbox, engineSpec, chassis, drag, 0.016);
		expect(result.engF).toBeCloseTo(3000 * 0.3);
	});

	it("braking produces negative rapierBrakeForce and brakeBodyN", () => {
		const input = { ...defaultInput, dsIsBraking: true, wantsForward: false };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.rapierBrakeForce).toBe(5.0);
		expect(result.brakeBodyN).toBeGreaterThan(0);
	});

	it("reverse produces negative engine force", () => {
		const input = { ...defaultInput, dsIsReverse: true, wantsForward: false };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.engF).toBeLessThan(0);
	});

	it("totalRetard includes rolling + aero when moving forward", () => {
		const result = computeForces(defaultInput, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.debugRolling).toBeGreaterThan(0);
		expect(result.debugAero).toBeGreaterThan(0);
	});

	it("neutral coast produces coastBodyBrakeN", () => {
		const input = { ...defaultInput, dsNeutral: true, wantsForward: false };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(result.coastBodyBrakeN).toBeGreaterThan(0);
	});

	it("handbrake adds extra retard", () => {
		const input = { ...defaultInput, handbrake: true, wantsForward: false };
		const noHandbrake = computeForces(
			{ ...input, handbrake: false },
			defaultEngine,
			defaultGearbox,
			engineSpec,
			chassis,
			drag,
			0.016,
		);
		const withHandbrake = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		expect(withHandbrake.totalRetard).toBeGreaterThan(noHandbrake.totalRetard);
	});

	it("forcesDebug has correct sign for forward motion", () => {
		const result = computeForces(defaultInput, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		// Forward motion → retard forces should be negative
		expect(result.forcesDebug.rolling).toBeLessThan(0);
		expect(result.forcesDebug.aero).toBeLessThan(0);
	});

	it("zero speed produces minimal retard (rolling only)", () => {
		const input = { ...defaultInput, localVelX: 0, absSpeedMs: 0 };
		const result = computeForces(input, defaultEngine, defaultGearbox, engineSpec, chassis, drag, 0.016);
		// Rolling resistance is always computed (CRR * mass * g * 0.5)
		expect(result.debugAero).toBe(0);
		expect(result.debugEngineBrake).toBe(0);
	});
});
