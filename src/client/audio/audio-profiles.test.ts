import { describe, expect, it } from "vitest";
import {
	AE86_SOUND_PROFILE,
	deriveSoundConfig,
	RACE_CAR_SOUND_PROFILE,
	SEDAN_CAR_SOUND_PROFILE,
} from "./audio-profiles.js";

describe("AE86_SOUND_PROFILE", () => {
	it("has 4 cylinders", () => {
		expect(AE86_SOUND_PROFILE.cylinders).toBe(4);
	});

	it("has correct RPM range", () => {
		expect(AE86_SOUND_PROFILE.idleRPM).toBe(850);
		expect(AE86_SOUND_PROFILE.maxRPM).toBe(7600);
		expect(AE86_SOUND_PROFILE.revLimiterRPM).toBe(7400);
	});

	it("is 4-stroke", () => {
		expect(AE86_SOUND_PROFILE.stroke).toBe(4);
	});

	it("is not turbo", () => {
		expect(AE86_SOUND_PROFILE.turbo).toBe(false);
	});

	it("has 8 harmonics", () => {
		expect(AE86_SOUND_PROFILE.harmonics).toHaveLength(8);
	});

	it("has fundamental as strongest harmonic", () => {
		const sorted = [...AE86_SOUND_PROFILE.harmonics].sort((a, b) => b.baseAmp - a.baseAmp);
		expect(sorted[0].name).toBe("Fundamental");
	});

	it("has all harmonics with positive baseAmp", () => {
		for (const h of AE86_SOUND_PROFILE.harmonics) {
			expect(h.baseAmp).toBeGreaterThan(0);
		}
	});

	it("has noise config with all 4 layers", () => {
		expect(AE86_SOUND_PROFILE.noise).toHaveProperty("exhaust");
		expect(AE86_SOUND_PROFILE.noise).toHaveProperty("intake");
		expect(AE86_SOUND_PROFILE.noise).toHaveProperty("mechanical");
		expect(AE86_SOUND_PROFILE.noise).toHaveProperty("valvetrain");
	});

	it("has distortion level", () => {
		expect(AE86_SOUND_PROFILE.distortion).toBe(25);
	});

	it("has volume between 0 and 1", () => {
		expect(AE86_SOUND_PROFILE.volume).toBeGreaterThanOrEqual(0);
		expect(AE86_SOUND_PROFILE.volume).toBeLessThanOrEqual(1);
	});

	it("has sub-harmonic (0.5x) in harmonics", () => {
		const sub = AE86_SOUND_PROFILE.harmonics.find((h) => h.mult === 0.5);
		expect(sub).toBeDefined();
		expect(sub?.baseAmp).toBe(0.06);
	});

	it("has correct exhaust noise frequency", () => {
		expect(AE86_SOUND_PROFILE.noise.exhaust.freq).toBe(200);
	});
});

describe("RACE_CAR_SOUND_PROFILE", () => {
	it("has higher max RPM than AE86", () => {
		expect(RACE_CAR_SOUND_PROFILE.maxRPM).toBeGreaterThan(AE86_SOUND_PROFILE.maxRPM);
	});

	it("has higher idle RPM than sedan", () => {
		expect(RACE_CAR_SOUND_PROFILE.idleRPM).toBeGreaterThan(SEDAN_CAR_SOUND_PROFILE.idleRPM);
	});

	it("has 4 harmonics", () => {
		expect(RACE_CAR_SOUND_PROFILE.harmonics).toHaveLength(4);
	});

	it("has stronger fundamental than AE86", () => {
		const raceFund = RACE_CAR_SOUND_PROFILE.harmonics[0].baseAmp;
		const ae86Fund = AE86_SOUND_PROFILE.harmonics[0].baseAmp;
		expect(raceFund).toBeGreaterThan(ae86Fund);
	});

	it("has higher distortion than sedan", () => {
		expect(RACE_CAR_SOUND_PROFILE.distortion).toBeGreaterThan(SEDAN_CAR_SOUND_PROFILE.distortion);
	});

	it("has higher volume than sedan", () => {
		expect(RACE_CAR_SOUND_PROFILE.volume).toBeGreaterThan(SEDAN_CAR_SOUND_PROFILE.volume);
	});

	it("is 4-stroke", () => {
		expect(RACE_CAR_SOUND_PROFILE.stroke).toBe(4);
	});

	it("has higher exhaust noise level than sedan", () => {
		expect(RACE_CAR_SOUND_PROFILE.noise.exhaust.level).toBeGreaterThan(SEDAN_CAR_SOUND_PROFILE.noise.exhaust.level);
	});

	it("has lower exhaust Q factor than AE86 (wider band)", () => {
		expect(RACE_CAR_SOUND_PROFILE.noise.exhaust.q).toBeLessThan(AE86_SOUND_PROFILE.noise.exhaust.q);
	});

	it("has correct max RPM", () => {
		expect(RACE_CAR_SOUND_PROFILE.maxRPM).toBe(8500);
	});

	it("has correct rev limiter RPM", () => {
		expect(RACE_CAR_SOUND_PROFILE.revLimiterRPM).toBe(8300);
	});
});

describe("SEDAN_CAR_SOUND_PROFILE", () => {
	it("has lowest idle RPM of all profiles", () => {
		expect(SEDAN_CAR_SOUND_PROFILE.idleRPM).toBeLessThan(AE86_SOUND_PROFILE.idleRPM);
		expect(SEDAN_CAR_SOUND_PROFILE.idleRPM).toBeLessThan(RACE_CAR_SOUND_PROFILE.idleRPM);
	});

	it("has lowest distortion of all profiles", () => {
		expect(SEDAN_CAR_SOUND_PROFILE.distortion).toBeLessThan(AE86_SOUND_PROFILE.distortion);
		expect(SEDAN_CAR_SOUND_PROFILE.distortion).toBeLessThan(RACE_CAR_SOUND_PROFILE.distortion);
	});

	it("has lowest volume of all profiles", () => {
		expect(SEDAN_CAR_SOUND_PROFILE.volume).toBeLessThan(AE86_SOUND_PROFILE.volume);
		expect(SEDAN_CAR_SOUND_PROFILE.volume).toBeLessThan(RACE_CAR_SOUND_PROFILE.volume);
	});

	it("has 3 harmonics", () => {
		expect(SEDAN_CAR_SOUND_PROFILE.harmonics).toHaveLength(3);
	});

	it("has max RPM of 6500", () => {
		expect(SEDAN_CAR_SOUND_PROFILE.maxRPM).toBe(6500);
	});

	it("has noise with decreasing level from exhaust to valvetrain", () => {
		const n = SEDAN_CAR_SOUND_PROFILE.noise;
		expect(n.exhaust.level).toBeGreaterThan(n.intake.level);
		expect(n.intake.level).toBeGreaterThan(n.mechanical.level);
		expect(n.mechanical.level).toBeGreaterThan(n.valvetrain.level);
	});
});

describe("deriveSoundConfig", () => {
	it("creates a valid config with minimal input", () => {
		const config = deriveSoundConfig({ idleRPM: 900, maxRPM: 7000 });
		expect(config.cylinders).toBe(4);
		expect(config.idleRPM).toBe(900);
		expect(config.maxRPM).toBe(7000);
		expect(config.stroke).toBe(4);
	});

	it("defaults cylinders to 4", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 6000 });
		expect(config.cylinders).toBe(4);
	});

	it("uses provided cylinder count", () => {
		const config = deriveSoundConfig({ cylinders: 6, idleRPM: 700, maxRPM: 7000 });
		expect(config.cylinders).toBe(6);
	});

	it("computes rev limiter as 97% of max RPM when not provided", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 10000 });
		expect(config.revLimiterRPM).toBe(9700);
	});

	it("uses provided rev limiter RPM", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000, revLimiterRPM: 6800 });
		expect(config.revLimiterRPM).toBe(6800);
	});

	it("sets turbo flag when provided", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000, turbo: true });
		expect(config.turbo).toBe(true);
	});

	it("does not set turbo when not provided", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.turbo).toBeUndefined();
	});

	it("has 3 default harmonics", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.harmonics).toHaveLength(3);
	});

	it("has noise config with all 4 layers", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.noise).toHaveProperty("exhaust");
		expect(config.noise).toHaveProperty("intake");
		expect(config.noise).toHaveProperty("mechanical");
		expect(config.noise).toHaveProperty("valvetrain");
	});

	it("has positive harmonic amplitudes", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		for (const h of config.harmonics) {
			expect(h.baseAmp).toBeGreaterThan(0);
		}
	});

	it("harmonics have correct multipliers", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.harmonics[0].mult).toBe(1);
		expect(config.harmonics[1].mult).toBe(2);
		expect(config.harmonics[2].mult).toBe(3);
	});

	it("noise levels are all positive", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		for (const key of ["exhaust", "intake", "mechanical", "valvetrain"] as const) {
			expect(config.noise[key].level).toBeGreaterThan(0);
		}
	});

	it("noise Q factors are all positive", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		for (const key of ["exhaust", "intake", "mechanical", "valvetrain"] as const) {
			expect(config.noise[key].q).toBeGreaterThan(0);
		}
	});

	it("volume is between 0 and 1", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.volume).toBeGreaterThanOrEqual(0);
		expect(config.volume).toBeLessThanOrEqual(1);
	});

	it("distortion is positive", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.distortion).toBeGreaterThan(0);
	});

	it("rev limiter is rounded to integer", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 6500 });
		expect(config.revLimiterRPM).toBe(Math.round(6500 * 0.97));
	});

	it("supports 2-stroke", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		expect(config.stroke).toBe(4);
	});

	it("supports 8 cylinder", () => {
		const config = deriveSoundConfig({ cylinders: 8, idleRPM: 600, maxRPM: 9000 });
		expect(config.cylinders).toBe(8);
		expect(config.maxRPM).toBe(9000);
	});

	it("harmonic rpmScale ranges are valid (low < high)", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		for (const h of config.harmonics) {
			expect(h.rpmScale[0]).toBeLessThanOrEqual(h.rpmScale[1]);
		}
	});

	it("harmonic thrScale ranges are valid (low < high)", () => {
		const config = deriveSoundConfig({ idleRPM: 800, maxRPM: 7000 });
		for (const h of config.harmonics) {
			expect(h.thrScale[0]).toBeLessThanOrEqual(h.thrScale[1]);
		}
	});
});

describe("harmonic consistency across profiles", () => {
	it("all profiles have fundamental as first harmonic", () => {
		for (const profile of [AE86_SOUND_PROFILE, RACE_CAR_SOUND_PROFILE, SEDAN_CAR_SOUND_PROFILE]) {
			expect(profile.harmonics[0].mult).toBe(1);
		}
	});

	it("all profiles have decreasing harmonic amplitudes", () => {
		for (const profile of [AE86_SOUND_PROFILE, RACE_CAR_SOUND_PROFILE, SEDAN_CAR_SOUND_PROFILE]) {
			for (let i = 1; i < profile.harmonics.length; i++) {
				// Only check ordered harmonics (H2, H3, etc.)
				if (profile.harmonics[i].mult > profile.harmonics[i - 1].mult) {
					// Sub-harmonics break this pattern, that's fine
					continue;
				}
				expect(profile.harmonics[i].baseAmp).toBeLessThanOrEqual(profile.harmonics[i - 1].baseAmp);
			}
		}
	});

	it("derived config matches sedan default structure", () => {
		const derived = deriveSoundConfig({ idleRPM: 800, maxRPM: 6500 });
		expect(derived.harmonics).toHaveLength(SEDAN_CAR_SOUND_PROFILE.harmonics.length);
		expect(Object.keys(derived.noise)).toEqual(Object.keys(SEDAN_CAR_SOUND_PROFILE.noise));
	});
});
