import { describe, expect, it } from "vitest";
import { DragModel } from "./DragModel.ts";

const makeConfig = (rollingResistance = 10, aeroDrag = 0.5) => ({ rollingResistance, aeroDrag });

describe("DragModel", () => {
	it("returns 0 at zero speed", () => {
		const model = new DragModel(makeConfig());
		expect(model.getForce(0)).toBe(0);
	});

	it("computes rolling resistance only at low speed", () => {
		const model = new DragModel(makeConfig(10, 0));
		expect(model.getForce(5)).toBe(50); // 10 * 5
	});

	it("computes aero drag only when rolling resistance is 0", () => {
		const model = new DragModel(makeConfig(0, 0.5));
		expect(model.getForce(10)).toBe(50); // 0.5 * 10 * 10
	});

	it("combines rolling resistance and aero drag", () => {
		const model = new DragModel(makeConfig(10, 0.5));
		// 10*20 + 0.5*20*20 = 200 + 200 = 400
		expect(model.getForce(20)).toBe(400);
	});

	it("force increases quadratically with speed (aero dominates)", () => {
		const model = new DragModel(makeConfig(1, 1));
		const f10 = model.getForce(10);
		const f20 = model.getForce(20);
		// f20 should be more than 2x f10 due to aero term
		expect(f20).toBeGreaterThan(f10 * 3);
	});

	it("force is always positive (opposes motion)", () => {
		const model = new DragModel(makeConfig(10, 0.5));
		expect(model.getForce(100)).toBeGreaterThan(0);
	});

	it("stores config reference", () => {
		const config = makeConfig(5, 0.3);
		const model = new DragModel(config);
		expect(model.config).toBe(config);
	});
});
