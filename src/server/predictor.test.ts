import { describe, expect, it } from "vitest";
import type { CarMetadata } from "./db.ts";
import { classify_era, getProfile, predict_specs } from "./predictor.ts";

// Re-export GEAR_SETS for test access
const GEAR_SETS_80S = { ratios: [3.6, 2.1, 1.4, 1.0, 0.8], final_drive: 4.1 };
const GEAR_SETS_2000S_TURBO = { ratios: [3.3, 2.0, 1.4, 1.0, 0.75, 0.65], final_drive: 3.7 };
const GEAR_SETS_2010S = { ratios: [3.5, 2.1, 1.5, 1.1, 0.85, 0.7], final_drive: 3.5 };

function makeCar(overrides: Partial<CarMetadata> = {}): CarMetadata {
	return {
		id: 1,
		make: "Test",
		model: "Car",
		year: 2020,
		trim: null,
		bodyType: "sedan",
		dimensions: { length_m: 0, width_m: 0, height_m: 0, wheelbase_m: 0, track_width_m: 0, ground_clearance_m: 0 },
		engine: {
			displacement_l: 0,
			cylinders: 0,
			configuration: "I4",
			aspiration: "NA",
			power_hp: 0,
			torque_nm: 0,
			max_rpm: 0,
		},
		performance: {},
		drivetrain: "fwd",
		transmission: { gear_count: 0, type: "manual" },
		brakes: {},
		suspension: {},
		tires: {},
		aero: {},
		weightKg: null,
		weightFrontPct: null,
		fuelType: null,
		price: { min_usd: 0, max_usd: 0 },
		eras: null,
		tags: [],
		source: "test",
		confidence: 0.5,
		...overrides,
	};
}

// ── Era classification ────────────────────────────────────────────────

describe("classify_era", () => {
	it("classifies 80s", () => {
		expect(classify_era(1989)).toBe("80s");
		expect(classify_era(1980)).toBe("80s");
		expect(classify_era(1970)).toBe("80s");
	});

	it("classifies 90s", () => {
		expect(classify_era(1990)).toBe("90s");
		expect(classify_era(1999)).toBe("90s");
	});

	it("classifies 2000s", () => {
		expect(classify_era(2000)).toBe("2000s");
		expect(classify_era(2009)).toBe("2000s");
	});

	it("classifies 2010s", () => {
		expect(classify_era(2010)).toBe("2010s");
		expect(classify_era(2019)).toBe("2010s");
	});

	it("classifies 2020s", () => {
		expect(classify_era(2020)).toBe("2020s");
		expect(classify_era(2025)).toBe("2020s");
	});

	it("returns 2000s for invalid input", () => {
		expect(classify_era(null)).toBe("2000s");
		expect(classify_era("abc")).toBe("2000s");
	});
});

// ── Profile lookup ────────────────────────────────────────────────────

describe("getProfile", () => {
	it("exact match", () => {
		const p = getProfile("sedan", "80s", "fwd");
		expect(p.cd).toBe(0.34);
		expect(p.wheelbase_m).toBe(2.5);
	});

	it("era fallback", () => {
		// hatchback|90s|rwd: no exact match, falls to hatchback|90s|fwd
		const p = getProfile("hatchback", "90s", "rwd");
		expect("cd" in p).toBe(true);
		expect(p.suspension_front).toBe("strut");
		expect(p.cd).toBe(0.33);
	});

	it("body fallback — convertible|90s|awd falls to convertible|90s|fwd", () => {
		const p = getProfile("convertible", "90s", "awd");
		expect(p.cd).toBe(0.35);
	});

	it("exact wagon profile exists now", () => {
		const p = getProfile("wagon", "2010s", "awd");
		expect(p.cd).toBe(0.3);
		expect(p.wheelbase_m).toBe(2.72);
	});

	it("default fallback for null inputs", () => {
		const p = getProfile(null, "2000s", null);
		expect(p.cd).toBe(0.32);
	});
});

// ── Cd prediction ─────────────────────────────────────────────────────

describe("Cd prediction", () => {
	it("base cd", () => {
		const car = makeCar({ bodyType: "sedan", drivetrain: "fwd", year: 2020 });
		const result = predict_specs(car);
		expect(result.cd).toBe(0.26);
		expect(result.cd_predicted).toBe(true);
	});

	it("cd length adjustment long", () => {
		const car = makeCar({
			bodyType: "sedan",
			drivetrain: "fwd",
			year: 2020,
			dimensions: { length_m: 4.8 } as never,
		});
		const result = predict_specs(car);
		expect(result.cd).toBeLessThan(0.26);
	});

	it("cd length adjustment short", () => {
		const car = makeCar({
			bodyType: "sedan",
			drivetrain: "fwd",
			year: 2020,
			dimensions: { length_m: 3.8 } as never,
		});
		const result = predict_specs(car);
		expect(result.cd).toBeGreaterThan(0.26);
	});

	it("cd not overwritten when exists", () => {
		const car = makeCar({
			bodyType: "sedan",
			drivetrain: "fwd",
			year: 2020,
			aero: { drag_coefficient: 0.22 } as never,
		});
		const result = predict_specs(car);
		expect("cd" in result).toBe(false);
	});
});

// ── Wheelbase prediction ──────────────────────────────────────────────

describe("Wheelbase prediction", () => {
	it("profile wheelbase", () => {
		const car = makeCar({ bodyType: "roadster", drivetrain: "rwd", year: 1990 });
		const result = predict_specs(car);
		expect(result.wheelbase_m).toBe(2.27);
		expect(result.wheelbase_m_predicted).toBe(true);
	});

	it("wheelbase from length", () => {
		const car = makeCar({
			bodyType: "roadster",
			drivetrain: "rwd",
			year: 1990,
			dimensions: { length_m: 4.5 } as never,
		});
		const result = predict_specs(car);
		expect(Math.abs(result.wheelbase_m! - 2.565)).toBeLessThan(0.01);
	});

	it("wheelbase not overwritten when exists", () => {
		const car = makeCar({
			bodyType: "roadster",
			drivetrain: "rwd",
			year: 1990,
			dimensions: { wheelbase_m: 2.3 } as never,
		});
		const result = predict_specs(car);
		expect("wheelbase_m" in result).toBe(false);
	});
});

// ── Weight distribution ───────────────────────────────────────────────

describe("Weight distribution", () => {
	it("profile base", () => {
		const car = makeCar({ bodyType: "sedan", drivetrain: "rwd", year: 2020 });
		const result = predict_specs(car);
		expect("weight_front_pct" in result).toBe(true);
		expect(result.weight_front_pct_predicted).toBe(true);
	});

	it("fwd adjustment", () => {
		const car = makeCar({ bodyType: "sedan", drivetrain: "fwd", year: 2020 });
		const result = predict_specs(car);
		expect(result.weight_front_pct).toBe(63);
	});

	it("awd adjustment", () => {
		const car = makeCar({ bodyType: "sedan", drivetrain: "awd", year: 2005 });
		const result = predict_specs(car);
		expect(result.weight_front_pct).toBe(59);
	});

	it("not overwritten when exists", () => {
		const car = makeCar({ bodyType: "sedan", drivetrain: "fwd", year: 2020, weightFrontPct: 55 });
		const result = predict_specs(car);
		expect("weight_front_pct" in result).toBe(false);
	});
});

// ── Gear ratios ───────────────────────────────────────────────────────

describe("Gear ratios", () => {
	it("80s na", () => {
		const car = makeCar({
			year: 1985,
			engine: { displacement_l: 1.6 } as never,
		});
		const result = predict_specs(car);
		expect(result.gear_ratios?.ratios).toEqual(GEAR_SETS_80S.ratios);
		expect(result.gear_ratios?.ratios.length).toBe(5);
	});

	it("2000s turbo", () => {
		const car = makeCar({
			year: 2005,
			engine: { displacement_l: 2.0, aspiration: "turbo" } as never,
		});
		const result = predict_specs(car);
		expect(result.gear_ratios?.ratios).toEqual(GEAR_SETS_2000S_TURBO.ratios);
		expect(result.gear_ratios?.ratios.length).toBe(6);
	});

	it("2010s na", () => {
		const car = makeCar({
			year: 2015,
			engine: { displacement_l: 2.0 } as never,
		});
		const result = predict_specs(car);
		expect(result.gear_ratios?.ratios).toEqual(GEAR_SETS_2010S.ratios);
	});
});

// ── Integration ───────────────────────────────────────────────────────

describe("predict_specs integration", () => {
	it("only fills missing fields", () => {
		const car = makeCar({
			bodyType: "sedan",
			drivetrain: "fwd",
			year: 2020,
			aero: { drag_coefficient: 0.25 } as never,
			dimensions: { wheelbase_m: 2.8 } as never,
			weightFrontPct: 58,
			suspension: { front_type: "strut", rear_type: "multilink" } as never,
		});
		const result = predict_specs(car);
		expect("cd" in result).toBe(false);
		expect("wheelbase_m" in result).toBe(false);
		expect("weight_front_pct" in result).toBe(false);
		expect("suspension_front" in result).toBe(false);
		expect("suspension_rear" in result).toBe(false);
		expect("gear_ratios" in result).toBe(true);
	});

	it("all predicted flags present", () => {
		const car = makeCar({ bodyType: "coupe", drivetrain: "rwd", year: 1990 });
		const result = predict_specs(car);
		for (const key of Object.keys(result)) {
			if (!key.endsWith("_predicted")) {
				expect(`${key}_predicted` in result).toBe(true);
			}
		}
	});

	it("empty car still predicts from defaults", () => {
		const result = predict_specs(makeCar());
		expect(Object.keys(result).length).toBeGreaterThan(0);
	});

	it("null car returns empty object", () => {
		const result = predict_specs(null as unknown as CarMetadata);
		expect(result).toEqual({});
	});

	it("dimensions with length predict cd and wheelbase", () => {
		const car = makeCar({
			bodyType: "sedan",
			drivetrain: "fwd",
			year: 2020,
			dimensions: { length_m: 4.8 } as never,
		});
		const result = predict_specs(car);
		expect("cd" in result).toBe(true);
		expect("wheelbase_m" in result).toBe(true);
		expect(result.wheelbase_m_predicted).toBe(true);
	});
});
