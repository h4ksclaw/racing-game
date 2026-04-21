import { describe, expect, it } from "vitest";
import { Chassis } from "./Chassis.ts";

const makeSpec = (overrides: Record<string, unknown> = {}) =>
	({
		mass: 1000,
		halfExtents: [0.8, 0.4, 2.0] as [number, number, number],
		wheelRadius: 0.3,
		wheelPositions: [],
		wheelBase: 2.5,
		maxSteerAngle: 0.5,
		suspensionStiffness: 30,
		suspensionRestLength: 0.3,
		dampingRelaxation: 2.3,
		dampingCompression: 4.4,
		rollInfluence: 0.02,
		maxSuspensionTravel: 0.3,
		cgHeight: 0.45,
		weightFront: 0.55,
		...overrides,
	}) as any;

describe("Chassis", () => {
	it("computes cgToFront from weightFront", () => {
		const ch = new Chassis(makeSpec());
		expect(ch.cgToFront).toBeCloseTo(2.5 * 0.55);
	});

	it("computes cgToRear from (1 - weightFront)", () => {
		const ch = new Chassis(makeSpec());
		expect(ch.cgToRear).toBeCloseTo(2.5 * 0.45);
	});

	it("defaults weightFront to 0.55", () => {
		const ch = new Chassis(makeSpec({ weightFront: undefined }));
		expect(ch.cgToFront).toBeCloseTo(2.5 * 0.55);
	});

	it("computes yawInertia = mass * cgToFront * cgToRear", () => {
		const ch = new Chassis(makeSpec());
		expect(ch.yawInertia).toBeCloseTo(1000 * 2.5 * 0.55 * 2.5 * 0.45);
	});

	it("computes inertia tensor for box shape", () => {
		const ch = new Chassis(makeSpec());
		// w=1.6, h=0.8, l=4.0, m=1000
		const xx = (1000 / 12) * (0.8 * 0.8 + 4.0 * 4.0); // pitch
		expect(ch.inertiaTensor.xx).toBeCloseTo(xx);
	});

	it("inertia tensor yy > zz for longer-than-tall car", () => {
		const ch = new Chassis(makeSpec({ halfExtents: [0.8, 0.4, 2.0] }));
		expect(ch.inertiaTensor.yy).toBeGreaterThan(ch.inertiaTensor.zz);
	});

	it("stores cgHeight", () => {
		const ch = new Chassis(makeSpec({ cgHeight: 0.35 }));
		expect(ch.cgHeight).toBe(0.35);
	});

	it("stores spec reference", () => {
		const spec = makeSpec();
		const ch = new Chassis(spec);
		expect(ch.spec).toBe(spec);
	});
});
