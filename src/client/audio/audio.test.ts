import { describe, expect, it, vi } from "vitest";
import { AudioBus } from "./AudioBus.ts";
import { deriveSoundConfig } from "./audio-profiles.ts";
import { EXHAUST_SYSTEMS, type ExhaustType } from "./audio-types.ts";

describe("AudioBus", () => {
	it("getInstance returns the same instance", () => {
		const a = AudioBus.getInstance();
		const b = AudioBus.getInstance();
		expect(a).toBe(b);
	});

	it("acquire/release manages ref count", () => {
		const MockAC = vi.fn(function AudioContext(this: Record<string, unknown>) {
			Object.assign(this, {
				close: vi.fn(),
				currentTime: 0,
				sampleRate: 44100,
				listener: {},
			});
		});
		vi.stubGlobal("AudioContext", MockAC);
		// Reset singleton so it picks up the mock
		const bus = AudioBus.getInstance();
		const ctx = bus.acquire();
		expect(ctx).toBeDefined();
		bus.release();
		vi.unstubAllGlobals();
	});
});

describe("deriveSoundConfig", () => {
	it("produces valid config from minimal input", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 6500 });
		expect(config.cylinders).toBe(4);
		expect(config.idleRPM).toBe(800);
		expect(config.maxRPM).toBe(6500);
		expect(config.revLimiterRPM).toBe(Math.round(6500 * 0.97));
		expect(config.harmonics.length).toBeGreaterThan(0);
		expect(config.noise).toBeDefined();
	});

	it("respects turbo flag", () => {
		const config = deriveSoundConfig({
			idleRPM: 800,
			maxRPM: 6500,
			turbo: true,
		});
		expect(config.turbo).toBe(true);
	});

	it("defaults revLimiterRPM to maxRPM * 0.97", () => {
		const config = deriveSoundConfig({ idleRPM: 1000, maxRPM: 8000 });
		expect(config.revLimiterRPM).toBe(7760);
	});
});

describe("EXHAUST_SYSTEMS", () => {
	const types: ExhaustType[] = ["stock", "sport", "straight", "race"];
	for (const type of types) {
		it(`${type} has valid params`, () => {
			const sys = EXHAUST_SYSTEMS[type];
			expect(sys.flowRestriction).toBeGreaterThanOrEqual(0);
			expect(sys.flowRestriction).toBeLessThanOrEqual(1);
			expect(sys.resonance).toBeGreaterThanOrEqual(0);
			expect(sys.volumeMultiplier).toBeGreaterThan(0);
			expect(sys.highFreqDamp).toBeGreaterThanOrEqual(0);
		});
	}
});
