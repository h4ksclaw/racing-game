import { describe, expect, it } from "vitest";
import { Brakes } from "./Brakes.ts";

const makeConfig = (overrides: Record<string, unknown> = {}) =>
	({ maxBrakeG: 1.2, handbrakeG: 0.9, brakeBias: 0.55, ...overrides }) as any;

describe("Brakes", () => {
	it("returns 0 when not braking", () => {
		const brakes = new Brakes(makeConfig());
		expect(brakes.getForce(1000)).toBe(0);
	});

	it("returns brake force proportional to mass", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		const force = brakes.getForce(1000);
		expect(force).toBeCloseTo(-1000 * 1.2 * 9.82);
	});

	it("handbrake uses handbrakeG", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isHandbrake = true;
		const force = brakes.getForce(1000);
		expect(force).toBeCloseTo(-1000 * 0.9 * 9.82);
	});

	it("handbrake overrides normal brake", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		brakes.isHandbrake = true;
		const force = brakes.getForce(1000);
		expect(force).toBeCloseTo(-1000 * 0.9 * 9.82);
	});

	it("applyResult returns 0 if brake would reverse", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		brakes.getForce(1000); // sets brakePressure
		expect(brakes.applyResult(-1)).toBe(0);
	});

	it("applyResult passes through positive speed", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		brakes.getForce(1000);
		expect(brakes.applyResult(5)).toBe(5);
	});

	it("rearGripFactor is 0.2 during handbrake", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isHandbrake = true;
		expect(brakes.rearGripFactor).toBe(0.2);
	});

	it("rearGripFactor is 1.0 normally", () => {
		const brakes = new Brakes(makeConfig());
		expect(brakes.rearGripFactor).toBe(1.0);
	});

	it("brake force is negative (opposing motion)", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		expect(brakes.getForce(500)).toBeLessThan(0);
	});

	it("sets brakePressure to 1 when braking", () => {
		const brakes = new Brakes(makeConfig());
		brakes.isBraking = true;
		brakes.getForce(1000);
		expect(brakes.brakePressure).toBe(1);
	});
});
