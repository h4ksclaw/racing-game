import { describe, expect, it } from "vitest";
import { CustomSuspension } from "./CustomSuspension.ts";

/** Create a mock Rapier vehicle controller */
function mockVehicle(suspensionLengths: (number | null)[]) {
	return {
		wheelSuspensionLength: (i: number) => suspensionLengths[i] ?? null,
	};
}

/** Create a mock rigid body that records impulses */
function mockBody() {
	const impulses: { point: { x: number; y: number; z: number }; impulse: { x: number; y: number; z: number } }[] = [];
	return {
		translation: () => ({ x: 0, y: 0, z: 0 }),
		rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
		applyImpulseAtPoint: (impulse: any, point: any) => impulses.push({ impulse, point }),
		_impulses: impulses,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (v: any) => v as any;

describe("CustomSuspension", () => {
	it("does nothing with no anchors", () => {
		const body = mockBody();
		const susp = new CustomSuspension();
		susp.apply(asAny(mockVehicle([0.2, 0.2, 0.2, 0.2])), asAny(body), 0.3, 0.016);
		expect(body._impulses.length).toBe(0);
	});

	it("does nothing when disabled", () => {
		const susp = new CustomSuspension();
		susp.setAnchors([{ x: 0, y: 0, z: 0 }]);
		susp.enable(false);
		const body = mockBody();
		susp.apply(asAny(mockVehicle([0.2])), asAny(body), 0.3, 0.016);
		expect(body._impulses.length).toBe(0);
	});

	it("does nothing with < 2 grounded wheels", () => {
		const susp = new CustomSuspension();
		susp.setAnchors([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
		]);
		const body = mockBody();
		susp.apply(asAny(mockVehicle([null, 0.2])), asAny(body), 0.3, 0.016);
		expect(body._impulses.length).toBe(0);
	});

	it("applies forces with uniform compression (net ~zero)", () => {
		const susp = new CustomSuspension();
		susp.setAnchors([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
		]);
		const body = mockBody();
		susp.apply(asAny(mockVehicle([0.2, 0.2])), asAny(body), 0.3, 0.016);
		const totalY = body._impulses.reduce((s, imp) => s + imp.impulse.y, 0);
		expect(Math.abs(totalY)).toBeLessThan(0.01);
	});

	it("applies differential forces when compression differs", () => {
		const susp = new CustomSuspension({ stiffness: 10000, damping: 0, maxForce: 50000 });
		susp.setAnchors([
			{ x: 0, y: 0, z: 1 },
			{ x: 0, y: 0, z: -1 },
		]);
		const body = mockBody();
		susp.apply(asAny(mockVehicle([0.1, 0.3])), asAny(body), 0.3, 0.016);
		expect(body._impulses.length).toBeGreaterThan(0);
	});

	it("reset clears wheel state", () => {
		const susp = new CustomSuspension();
		susp.setAnchors([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
		]);
		susp.apply(asAny(mockVehicle([0.2, 0.1])), asAny(mockBody()), 0.3, 0.016);
		susp.reset();
		const body2 = mockBody();
		susp.apply(asAny(mockVehicle([0.2, 0.2])), asAny(body2), 0.3, 0.016);
		const totalY = body2._impulses.reduce((s, imp) => s + imp.impulse.y, 0);
		expect(Math.abs(totalY)).toBeLessThan(0.01);
	});

	it("uses default config values", () => {
		const susp = new CustomSuspension();
		expect(susp).toBeDefined();
	});

	it("applyWeightTransfer does nothing with < 4 anchors", () => {
		const susp = new CustomSuspension();
		susp.setAnchors([{ x: 0, y: 0, z: 0 }]);
		const body = mockBody();
		susp.applyWeightTransfer(asAny(body), 5, 0, 1000, 0.5, 2.5, 1.5, 0.016);
		expect(body._impulses.length).toBe(0);
	});

	it("applyWeightTransfer applies forces under braking", () => {
		const susp = new CustomSuspension({ stiffness: 10000, damping: 0, maxForce: 50000 });
		susp.setAnchors([
			{ x: 0.7, y: 0, z: 1.2 },
			{ x: -0.7, y: 0, z: 1.2 },
			{ x: 0.7, y: 0, z: -1.2 },
			{ x: -0.7, y: 0, z: -1.2 },
		]);
		const body = mockBody();
		susp.applyWeightTransfer(asAny(body), -8, 0, 1000, 0.5, 2.5, 1.5, 0.016);
		expect(body._impulses.length).toBeGreaterThan(0);
	});
});
