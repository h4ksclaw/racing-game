import { describe, expect, it } from "vitest";
import { buildDebugInfo, type DebugInfoInput } from "./DebugInfoBuilder.js";

function makeInput(overrides: Partial<DebugInfoInput> = {}): DebugInfoInput {
	return {
		pos: { x: 10, y: 0.5, z: -20 },
		vel: { x: 0, y: 0, z: 15 },
		angvel: { x: 0, y: 0.1, z: 0 },
		heading: Math.PI / 4,
		pitch: 0.02,
		roll: -0.01,
		speed: 15.3,
		rpm: 4500,
		steerAngle: 0.1,
		gear: 3,
		contacts: 4,
		suspRestLength: 0.35,
		wheelRadius: 0.33,
		wheelY: 0.3,
		halfExtentsY: 0.5,
		guardrailCount: 0,
		tireDynState: null,
		wheel: {
			wheelIsInContact: (_i: number) => true,
			wheelSuspensionLength: (_i: number) => 0.3,
			wheelSuspensionRestLength: (_i: number) => 0.35,
			wheelSuspensionForce: (_i: number) => 5000,
		},
		...overrides,
	};
}

describe("buildDebugInfo", () => {
	it("formats position with expected precision", () => {
		const info = buildDebugInfo(makeInput());
		expect(info.pos).toBe("10.0, 0.50, -20.0");
	});

	it("formats velocity with 2 decimal places", () => {
		const info = buildDebugInfo(makeInput());
		expect(info.vel).toBe("0.00, 0.00, 15.00");
	});

	it("formats angular velocity with 3 decimal places", () => {
		const info = buildDebugInfo(makeInput());
		expect(info.angvel).toBe("0.000, 0.100, 0.000");
	});

	it("converts heading radians to degrees", () => {
		const info = buildDebugInfo(makeInput({ heading: Math.PI }));
		expect(info.heading).toBe("180.0°");
	});

	it("converts zero heading to 0 degrees", () => {
		const info = buildDebugInfo(makeInput({ heading: 0 }));
		expect(info.heading).toBe("0.0°");
	});

	it("converts negative heading to negative degrees", () => {
		const info = buildDebugInfo(makeInput({ heading: -Math.PI / 2 }));
		expect(info.heading).toBe("-90.0°");
	});

	it("converts pitch radians to degrees", () => {
		const info = buildDebugInfo(makeInput({ pitch: 0.05 }));
		expect(info.pitch).toBe("2.86°");
	});

	it("converts roll radians to degrees", () => {
		const info = buildDebugInfo(makeInput({ roll: -0.05 }));
		expect(info.roll).toBe("-2.86°");
	});

	it("formats speed with 1 decimal place", () => {
		const info = buildDebugInfo(makeInput({ speed: 15.345 }));
		expect(info.speed).toBe("15.3");
	});

	it("converts speed to km/h using absolute value", () => {
		const info = buildDebugInfo(makeInput({ speed: 10 }));
		expect(info.speedKmh).toBe("36");
	});

	it("converts negative speed to positive km/h", () => {
		const info = buildDebugInfo(makeInput({ speed: -10 }));
		expect(info.speedKmh).toBe("36");
	});

	it("formats rpm with 0 decimal places", () => {
		const info = buildDebugInfo(makeInput({ rpm: 4500.7 }));
		expect(info.rpm).toBe("4501");
	});

	it("outputs gear number", () => {
		const info = buildDebugInfo(makeInput({ gear: 5 }));
		expect(info.gear).toBe(5);
	});

	it("outputs gear 0 for neutral", () => {
		const info = buildDebugInfo(makeInput({ gear: 0 }));
		expect(info.gear).toBe(0);
	});

	it("outputs negative gear for reverse", () => {
		const info = buildDebugInfo(makeInput({ gear: -1 }));
		expect(info.gear).toBe(-1);
	});

	it("converts steer angle to degrees", () => {
		const info = buildDebugInfo(makeInput({ steerAngle: Math.PI / 6 }));
		expect(info.steer).toBe("30.0°");
	});

	it("formats contacts as N/4 with wheel contact indicators", () => {
		const info = buildDebugInfo(makeInput({ contacts: 3 }));
		expect(info.contacts).toBe("3/4 [● ● ● ●]");
	});

	it("shows hollow circles for wheels not in contact", () => {
		const info = buildDebugInfo(
			makeInput({
				contacts: 2,
				wheel: {
					wheelIsInContact: (i: number) => i < 2,
					wheelSuspensionLength: (_i: number) => 0.3,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 5000,
				},
			}),
		);
		expect(info.contacts).toBe("2/4 [● ● ○ ○]");
	});

	it("computes suspension compression from rest and current length", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.25,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 6000,
				},
			}),
		);
		expect(info.susp).toBe("[0.100m/6kN | 0.100m/6kN | 0.100m/6kN | 0.100m/6kN]");
	});

	it("shows dash when suspension length is null", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => null,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 5000,
				},
			}),
		);
		expect(info.susp).toBe("[- | - | - | -]");
	});

	it("shows question mark for force when null", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.3,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => null,
				},
			}),
		);
		expect(info.susp).toBe("[0.050m/? | 0.050m/? | 0.050m/? | 0.050m/?]");
	});

	it("computes wheelBotY as pos.y - halfExtentsY - suspLen - wheelRadius", () => {
		const info = buildDebugInfo(
			makeInput({
				pos: { x: 0, y: 1.0, z: 0 },
				halfExtentsY: 0.5,
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.2,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 5000,
				},
			}),
		);
		// wheelBotY = pos.y + (-halfExtentsY) - currentLen - wheelRadius = 1.0 - 0.5 - 0.2 - 0.33 = -0.03
		expect(info.wheelBotY).toBe("[-0.030 -0.030 -0.030 -0.030]");
	});

	it("shows question mark for wheelBotY when suspension is null", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => null,
					wheelSuspensionRestLength: (_i: number) => null,
					wheelSuspensionForce: (_i: number) => null,
				},
			}),
		);
		expect(info.wheelBotY).toBe("[? ? ? ?]");
	});

	it("formats patch center when provided", () => {
		const info = buildDebugInfo(makeInput({ patchCenterX: 5.5, patchCenterZ: -10.2 }));
		expect(info.patchCenter).toBe("6, -10");
	});

	it("shows question marks for patch center when not provided", () => {
		const info = buildDebugInfo(makeInput());
		expect(info.patchCenter).toBe("?, ?");
	});

	it("outputs guardrail count", () => {
		const info = buildDebugInfo(makeInput({ guardrailCount: 3 }));
		expect(info.guardrails).toBe(3);
	});

	it("outputs suspRestLength", () => {
		const info = buildDebugInfo(makeInput({ suspRestLength: 0.4 }));
		expect(info.suspRest).toBe(0.4);
	});

	it("outputs wheelRadius", () => {
		const info = buildDebugInfo(makeInput({ wheelRadius: 0.35 }));
		expect(info.wheelRadius).toBe(0.35);
	});

	it("outputs wheelY", () => {
		const info = buildDebugInfo(makeInput({ wheelY: 0.25 }));
		expect(info.wheelY).toBe(0.25);
	});

	it("includes tire dynamics state when provided", () => {
		const info = buildDebugInfo(
			makeInput({
				tireDynState: {
					rearGripMultiplier: 0.6,
					isDrifting: true,
					driftYawTorque: 150.5,
					localCOM: { x: 0, y: -0.3, z: -0.1 },
				} as DebugInfoInput["tireDynState"],
			}),
		);
		expect(info.rearGrip).toBe("0.60");
		expect(info.drifting).toBe("YES");
		expect(info.driftTorque).toBe("150.5");
		expect(info.comLocal).toBe("0.00, -0.30, -0.10");
	});

	it("shows no drifting when isDrifting is false", () => {
		const info = buildDebugInfo(
			makeInput({
				tireDynState: {
					rearGripMultiplier: 1.0,
					isDrifting: false,
					driftYawTorque: 0,
					localCOM: { x: 0, y: 0, z: 0 },
				} as DebugInfoInput["tireDynState"],
			}),
		);
		expect(info.drifting).toBe("no");
	});

	it("omits tire dynamics fields when tireDynState is null", () => {
		const info = buildDebugInfo(makeInput({ tireDynState: null }));
		expect(info).not.toHaveProperty("rearGrip");
		expect(info).not.toHaveProperty("drifting");
		expect(info).not.toHaveProperty("driftTorque");
		expect(info).not.toHaveProperty("comLocal");
	});

	it("handles extended suspension (negative compression)", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.45,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 1000,
				},
			}),
		);
		expect(info.susp).toBe("[-0.100m/1kN | -0.100m/1kN | -0.100m/1kN | -0.100m/1kN]");
	});

	it("handles zero suspension force", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.35,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 0,
				},
			}),
		);
		expect(info.susp).toBe("[0.000m/0kN | 0.000m/0kN | 0.000m/0kN | 0.000m/0kN]");
	});

	it("rounds suspension force in kN to integer", () => {
		const info = buildDebugInfo(
			makeInput({
				wheel: {
					wheelIsInContact: (_i: number) => true,
					wheelSuspensionLength: (_i: number) => 0.3,
					wheelSuspensionRestLength: (_i: number) => 0.35,
					wheelSuspensionForce: (_i: number) => 5500,
				},
			}),
		);
		expect(info.susp).toBe("[0.050m/6kN | 0.050m/6kN | 0.050m/6kN | 0.050m/6kN]");
	});

	it("handles per-wheel varying suspension data", () => {
		const info = buildDebugInfo(
			makeInput({
				contacts: 3,
				wheel: {
					wheelIsInContact: (i: number) => i !== 3,
					wheelSuspensionLength: (i: number) => [0.3, 0.28, 0.32, null][i],
					wheelSuspensionRestLength: (i: number) => [0.35, 0.35, 0.35, null][i],
					wheelSuspensionForce: (i: number) => [5000, 5500, 4500, null][i],
				},
			}),
		);
		expect(info.contacts).toBe("3/4 [● ● ● ○]");
		expect(info.susp).toBe("[0.050m/5kN | 0.070m/6kN | 0.030m/5kN | -]");
	});

	it("handles very large speed values", () => {
		const info = buildDebugInfo(makeInput({ speed: 100.5 }));
		expect(info.speed).toBe("100.5");
		expect(info.speedKmh).toBe("362");
	});

	it("handles zero speed", () => {
		const info = buildDebugInfo(makeInput({ speed: 0 }));
		expect(info.speed).toBe("0.0");
		expect(info.speedKmh).toBe("0");
	});
});
