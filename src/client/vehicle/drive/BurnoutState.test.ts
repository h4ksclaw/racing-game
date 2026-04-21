import { describe, expect, it } from "vitest";
import type { BurnoutEngineParams } from "./BurnoutState.ts";
import { BurnoutState } from "./BurnoutState.ts";

/** Helper: build engine params that keep burnout viable (torque > grip). */
function viableEngine(overrides: Partial<BurnoutEngineParams> = {}): BurnoutEngineParams {
	return {
		gearRatio: 3.59,
		engineTorqueNm: 145,
		finalDrive: 4.3,
		wheelRadius: 0.31,
		mass: 1000,
		tractionPct: 0.25,
		currentGear: 1,
		...overrides,
	};
}

/** Helper: build engine params where traction has caught (torque < grip). */
function caughtEngine(overrides: Partial<BurnoutEngineParams> = {}): BurnoutEngineParams {
	return {
		gearRatio: 1.0,
		engineTorqueNm: 50,
		finalDrive: 4.3,
		wheelRadius: 0.31,
		mass: 1000,
		tractionPct: 0.25,
		currentGear: 3,
		...overrides,
	};
}

/** Helper: run N frames with given inputs and return final result. */
function runFrames(
	bs: BurnoutState,
	n: number,
	opts: {
		handbrake?: boolean;
		throttle?: boolean;
		speed?: number;
		dt?: number;
		drivetrain?: "FWD" | "RWD" | "AWD";
		engine?: Partial<BurnoutEngineParams>;
	} = {},
): ReturnType<BurnoutState["update"]> {
	const eng = viableEngine(opts.engine);
	let result: ReturnType<BurnoutState["update"]>;
	for (let i = 0; i < n; i++) {
		result = bs.update(
			opts.handbrake ?? false,
			opts.throttle ?? false,
			opts.speed ?? 0,
			opts.dt ?? 0.016,
			opts.drivetrain ?? "RWD",
			eng,
		);
	}
	return result!;
}

/** Same as runFrames but with caught engine (torque < grip). */
function runFramesCaught(
	bs: BurnoutState,
	n: number,
	opts: {
		handbrake?: boolean;
		throttle?: boolean;
		speed?: number;
		dt?: number;
		drivetrain?: "FWD" | "RWD" | "AWD";
		engine?: Partial<BurnoutEngineParams>;
	} = {},
): ReturnType<BurnoutState["update"]> {
	const eng = caughtEngine(opts.engine);
	let result: ReturnType<BurnoutState["update"]>;
	for (let i = 0; i < n; i++) {
		result = bs.update(
			opts.handbrake ?? false,
			opts.throttle ?? false,
			opts.speed ?? 0,
			opts.dt ?? 0.016,
			opts.drivetrain ?? "RWD",
			eng,
		);
	}
	return result!;
}

describe("BurnoutState", () => {
	it("starts inactive with no input", () => {
		const bs = new BurnoutState();
		const r = bs.update(false, false, 0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(false);
		expect(r.revvingInNeutral).toBe(false);
	});

	it("enters rev-in-neutral when space+W held", () => {
		const bs = new BurnoutState();
		const r = bs.update(true, true, 0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(false);
		expect(r.revvingInNeutral).toBe(true);
	});

	it("enters rev-in-neutral even when moving", () => {
		const bs = new BurnoutState();
		const r = bs.update(true, true, 10.0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(false);
		expect(r.revvingInNeutral).toBe(true);
	});

	it("does NOT enter rev-in-neutral with space only (no W)", () => {
		const bs = new BurnoutState();
		const r = bs.update(true, false, 0, 0.016, "RWD", viableEngine());
		expect(r.revvingInNeutral).toBe(false);
	});

	it("does NOT enter rev-in-neutral with W only (no space)", () => {
		const bs = new BurnoutState();
		const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
		expect(r.revvingInNeutral).toBe(false);
		expect(r.active).toBe(false);
	});

	it("triggers burnout when space released after revving", () => {
		const bs = new BurnoutState();
		bs.update(true, true, 0, 0.016, "RWD", viableEngine());
		expect(bs.revvingInNeutral).toBe(true);

		const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(true);
		expect(r.revvingInNeutral).toBe(false);
	});

	it("triggers burnout when moving", () => {
		const bs = new BurnoutState();
		bs.update(true, true, 15.0, 0.016, "RWD", viableEngine());
		const r = bs.update(false, true, 15.0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(true);
	});

	it("does NOT trigger burnout without prior revving phase", () => {
		const bs = new BurnoutState();
		const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
		expect(r.active).toBe(false);
	});

	describe("traction and overspin (RWD)", () => {
		it("rear wheels get reduced traction during burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			expect(r.tractionMul[0]).toBe(1.0);
			expect(r.tractionMul[1]).toBe(1.0);
			expect(r.tractionMul[2]).toBeLessThan(1.0);
			expect(r.tractionMul[3]).toBeLessThan(1.0);
		});

		it("rear wheels overspin during burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			expect(r.overspin[0]).toBe(1.0);
			expect(r.overspin[1]).toBe(1.0);
			expect(r.overspin[2]).toBeGreaterThan(1.0);
			expect(r.overspin[3]).toBeGreaterThan(1.0);
		});
	});

	describe("traction and overspin (FWD)", () => {
		it("front wheels get reduced traction during burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "FWD", viableEngine());
			const r = bs.update(false, true, 0, 0.016, "FWD", viableEngine());
			expect(r.tractionMul[0]).toBeLessThan(1.0);
			expect(r.tractionMul[1]).toBeLessThan(1.0);
			expect(r.tractionMul[2]).toBe(1.0);
			expect(r.tractionMul[3]).toBe(1.0);
		});
	});

	describe("traction and overspin (AWD)", () => {
		it("all wheels get reduced traction during burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "AWD", viableEngine());
			const r = bs.update(false, true, 0, 0.016, "AWD", viableEngine());
			for (let i = 0; i < 4; i++) {
				expect(r.tractionMul[i]).toBeLessThan(1.0);
				expect(r.overspin[i]).toBeGreaterThan(1.0);
			}
		});
	});

	describe("physics-based end conditions", () => {
		it("burnout persists when torque exceeds grip (viable params)", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			const r = runFrames(bs, 60, { throttle: true });
			expect(r.active).toBe(true);
		});

		it("burnout fades when torque can't overcome grip (traction caught)", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			// Engine drops to low-torque gear → traction catches
			runFramesCaught(bs, 30, { throttle: true });
			expect(bs.active).toBe(false);
		});

		it("burnout ends on gear upshift (currentGear > launchGear)", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine({ currentGear: 1 }));
			bs.update(false, true, 0, 0.016, "RWD", viableEngine({ currentGear: 1 }));

			// Gearbox shifted to gear 2 — burnout should fade
			runFrames(bs, 30, { throttle: true, engine: { currentGear: 2, gearRatio: 2.06 } });
			expect(bs.active).toBe(false);
		});

		it("burnout does NOT end on same-gear ratio change", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine({ currentGear: 1 }));
			bs.update(false, true, 0, 0.016, "RWD", viableEngine({ currentGear: 1 }));

			// Gear still 1 but ratio changes (shift interpolation) — burnout stays
			const r = runFrames(bs, 30, { throttle: true, engine: { gearRatio: 3.0 } });
			expect(r.active).toBe(true);
		});

		it("fade is irreversible — speed/gear changes don't restart it", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			// Start fade via traction catch
			runFramesCaught(bs, 1, { throttle: true });
			// Switch back to viable engine — fade should NOT reset
			runFrames(bs, 30, { throttle: true });
			expect(bs.active).toBe(false);
		});

		it("burnout fades when W released", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			runFrames(bs, 40, { throttle: false });
			expect(bs.active).toBe(false);
		});
	});

	describe("end() method", () => {
		it("force-ends burnout from any state", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			expect(bs.active).toBe(true);

			bs.end();
			expect(bs.active).toBe(false);
			expect(bs.revvingInNeutral).toBe(false);
		});

		it("resets trigger tracking — new burnout requires fresh sequence", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			bs.end();

			const r = bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			expect(r.active).toBe(false);
		});
	});

	describe("traction fade during burnout end", () => {
		it("traction gradually returns to 1.0 during fade", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			const r = runFrames(bs, 20, { throttle: false });
			expect(r.tractionMul[2]).toBeGreaterThan(0.15);
			expect(r.tractionMul[2]).toBeLessThan(1.0);
		});

		it("overspin gradually returns to 1.0 during fade", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			const r = runFrames(bs, 20, { throttle: false });
			expect(r.overspin[2]).toBeGreaterThan(1.0);
			expect(r.overspin[2]).toBeLessThan(3.0);
		});
	});

	describe("edge cases", () => {
		it("releasing W during rev-in-neutral cancels revving", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			expect(bs.revvingInNeutral).toBe(true);

			bs.update(true, false, 0, 0.016, "RWD", viableEngine());
			expect(bs.revvingInNeutral).toBe(false);
		});

		it("releasing space without W does not trigger burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(true, false, 0, 0.016, "RWD", viableEngine());
			const r = bs.update(false, false, 0, 0.016, "RWD", viableEngine());
			expect(r.active).toBe(false);
		});

		it("multiple rapid input changes don't corrupt state", () => {
			const bs = new BurnoutState();
			for (let i = 0; i < 100; i++) {
				bs.update(i % 3 === 0, i % 5 === 0, 0, 0.016, "RWD", viableEngine());
			}
			const r = bs.update(false, false, 0, 0.016, "RWD", viableEngine());
			expect(r.active).toBe(false);
			expect(r.revvingInNeutral).toBe(false);
		});

		it("all traction/overspin values are 1.0 when inactive", () => {
			const bs = new BurnoutState();
			const r = bs.update(false, false, 0, 0.016, "AWD", viableEngine());
			for (let i = 0; i < 4; i++) {
				expect(r.tractionMul[i]).toBe(1.0);
				expect(r.overspin[i]).toBe(1.0);
			}
		});

		it("can trigger a second burnout after first ends naturally", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			runFrames(bs, 40, { throttle: false });
			expect(bs.active).toBe(false);

			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			expect(bs.revvingInNeutral).toBe(true);
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());
			expect(bs.active).toBe(true);
		});

		it("re-triggering during fade does not restart burnout", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			// Start fade
			runFrames(bs, 2, { throttle: false });

			// Try to re-trigger with space+W
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			expect(bs.revvingInNeutral).toBe(false);
			runFrames(bs, 35, { throttle: true });
			expect(bs.active).toBe(false);
		});

		it("neutral gear ratio (0) triggers traction catch", () => {
			const bs = new BurnoutState();
			bs.update(true, true, 0, 0.016, "RWD", viableEngine());
			bs.update(false, true, 0, 0.016, "RWD", viableEngine());

			// Effective ratio = 0 (neutral) → no drive → traction caught
			runFrames(bs, 30, { throttle: true, engine: { gearRatio: 0 } });
			expect(bs.active).toBe(false);
		});
	});
});
