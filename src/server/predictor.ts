/**
 * Car Spec Predictor — predicts missing physics specs from archetypal profiles.
 *
 * Ported from pipelines/car_predictor.py. Prediction is on-the-fly (not stored in DB).
 * Profiles are composable based on body_type + era + drivetrain.
 */

import type { CarMetadata } from "./db.ts";

// ── Profile types ──────────────────────────────────────────────────────

interface ArchetypeProfile {
	cd: number;
	wheelbase_m: number;
	weight_front_pct: number;
	suspension_front: string;
	suspension_rear: string;
}

interface GearSet {
	ratios: number[];
	final_drive: number;
}

// ── Profiles ──────────────────────────────────────────────────────────

const PROFILES: Record<string, ArchetypeProfile> = {
	// ── Sedan ──
	"sedan|80s|fwd": {
		cd: 0.34,
		wheelbase_m: 2.5,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "strut",
	},
	"sedan|80s|rwd": {
		cd: 0.33,
		wheelbase_m: 2.6,
		weight_front_pct: 55,
		suspension_front: "double_wishbone",
		suspension_rear: "four_link",
	},
	"sedan|80s|awd": {
		cd: 0.35,
		wheelbase_m: 2.55,
		weight_front_pct: 58,
		suspension_front: "strut",
		suspension_rear: "four_link",
	},
	"sedan|90s|fwd": {
		cd: 0.32,
		wheelbase_m: 2.55,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"sedan|90s|rwd": {
		cd: 0.31,
		wheelbase_m: 2.65,
		weight_front_pct: 53,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"sedan|90s|awd": {
		cd: 0.32,
		wheelbase_m: 2.6,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2000s|fwd": {
		cd: 0.3,
		wheelbase_m: 2.65,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2000s|rwd": {
		cd: 0.29,
		wheelbase_m: 2.8,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"sedan|2000s|awd": {
		cd: 0.3,
		wheelbase_m: 2.65,
		weight_front_pct: 58,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2010s|fwd": {
		cd: 0.28,
		wheelbase_m: 2.7,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2010s|rwd": {
		cd: 0.27,
		wheelbase_m: 2.85,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"sedan|2010s|awd": {
		cd: 0.28,
		wheelbase_m: 2.75,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2020s|fwd": {
		cd: 0.26,
		wheelbase_m: 2.75,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"sedan|2020s|rwd": {
		cd: 0.26,
		wheelbase_m: 2.85,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"sedan|2020s|awd": {
		cd: 0.27,
		wheelbase_m: 2.78,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	// ── Coupe ──
	"coupe|80s|rwd": {
		cd: 0.33,
		wheelbase_m: 2.45,
		weight_front_pct: 53,
		suspension_front: "double_wishbone",
		suspension_rear: "four_link",
	},
	"coupe|90s|fwd": {
		cd: 0.32,
		wheelbase_m: 2.45,
		weight_front_pct: 62,
		suspension_front: "double_wishbone",
		suspension_rear: "double_wishbone",
	},
	"coupe|90s|rwd": {
		cd: 0.31,
		wheelbase_m: 2.55,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"coupe|2000s|fwd": {
		cd: 0.31,
		wheelbase_m: 2.55,
		weight_front_pct: 62,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"coupe|2000s|rwd": {
		cd: 0.3,
		wheelbase_m: 2.65,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"coupe|2000s|awd": {
		cd: 0.31,
		wheelbase_m: 2.6,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"coupe|2010s|fwd": {
		cd: 0.29,
		wheelbase_m: 2.6,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"coupe|2010s|rwd": {
		cd: 0.28,
		wheelbase_m: 2.7,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"coupe|2010s|awd": {
		cd: 0.29,
		wheelbase_m: 2.65,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"coupe|2020s|rwd": {
		cd: 0.28,
		wheelbase_m: 2.7,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"coupe|2020s|fwd": {
		cd: 0.28,
		wheelbase_m: 2.65,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"coupe|2020s|awd": {
		cd: 0.29,
		wheelbase_m: 2.68,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	// ── Hatchback ──
	"hatchback|80s|fwd": {
		cd: 0.34,
		wheelbase_m: 2.35,
		weight_front_pct: 62,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"hatchback|90s|fwd": {
		cd: 0.33,
		wheelbase_m: 2.4,
		weight_front_pct: 62,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"hatchback|2000s|fwd": {
		cd: 0.31,
		wheelbase_m: 2.5,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"hatchback|2000s|awd": {
		cd: 0.32,
		wheelbase_m: 2.5,
		weight_front_pct: 58,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"hatchback|2010s|fwd": {
		cd: 0.29,
		wheelbase_m: 2.55,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"hatchback|2010s|rwd": {
		cd: 0.3,
		wheelbase_m: 2.55,
		weight_front_pct: 53,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"hatchback|2010s|awd": {
		cd: 0.3,
		wheelbase_m: 2.55,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"hatchback|2020s|fwd": {
		cd: 0.28,
		wheelbase_m: 2.6,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	// ── Wagon ──
	"wagon|80s|rwd": {
		cd: 0.35,
		wheelbase_m: 2.6,
		weight_front_pct: 55,
		suspension_front: "double_wishbone",
		suspension_rear: "four_link",
	},
	"wagon|90s|rwd": {
		cd: 0.34,
		wheelbase_m: 2.65,
		weight_front_pct: 55,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"wagon|90s|fwd": {
		cd: 0.34,
		wheelbase_m: 2.5,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"wagon|2000s|rwd": {
		cd: 0.32,
		wheelbase_m: 2.7,
		weight_front_pct: 54,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"wagon|2000s|fwd": {
		cd: 0.31,
		wheelbase_m: 2.6,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"wagon|2000s|awd": {
		cd: 0.32,
		wheelbase_m: 2.65,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"wagon|2010s|fwd": {
		cd: 0.29,
		wheelbase_m: 2.65,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"wagon|2010s|rwd": {
		cd: 0.29,
		wheelbase_m: 2.8,
		weight_front_pct: 53,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"wagon|2010s|awd": {
		cd: 0.3,
		wheelbase_m: 2.72,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"wagon|2020s|fwd": {
		cd: 0.28,
		wheelbase_m: 2.7,
		weight_front_pct: 60,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"wagon|2020s|rwd": {
		cd: 0.28,
		wheelbase_m: 2.8,
		weight_front_pct: 53,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"wagon|2020s|awd": {
		cd: 0.29,
		wheelbase_m: 2.75,
		weight_front_pct: 57,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	// ── Convertible ──
	"convertible|80s|rwd": {
		cd: 0.37,
		wheelbase_m: 2.4,
		weight_front_pct: 53,
		suspension_front: "double_wishbone",
		suspension_rear: "four_link",
	},
	"convertible|90s|fwd": {
		cd: 0.35,
		wheelbase_m: 2.4,
		weight_front_pct: 62,
		suspension_front: "strut",
		suspension_rear: "torsion_beam",
	},
	"convertible|90s|rwd": {
		cd: 0.34,
		wheelbase_m: 2.5,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"convertible|2000s|fwd": {
		cd: 0.33,
		wheelbase_m: 2.45,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"convertible|2000s|rwd": {
		cd: 0.32,
		wheelbase_m: 2.55,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"convertible|2000s|awd": {
		cd: 0.33,
		wheelbase_m: 2.5,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"convertible|2010s|fwd": {
		cd: 0.31,
		wheelbase_m: 2.5,
		weight_front_pct: 61,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"convertible|2010s|rwd": {
		cd: 0.3,
		wheelbase_m: 2.6,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"convertible|2010s|awd": {
		cd: 0.31,
		wheelbase_m: 2.58,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	"convertible|2020s|rwd": {
		cd: 0.29,
		wheelbase_m: 2.6,
		weight_front_pct: 52,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"convertible|2020s|awd": {
		cd: 0.3,
		wheelbase_m: 2.6,
		weight_front_pct: 56,
		suspension_front: "strut",
		suspension_rear: "multilink",
	},
	// ── Roadster ──
	"roadster|90s|rwd": {
		cd: 0.38,
		wheelbase_m: 2.27,
		weight_front_pct: 50,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
	"roadster|2000s|rwd": {
		cd: 0.36,
		wheelbase_m: 2.33,
		weight_front_pct: 50,
		suspension_front: "double_wishbone",
		suspension_rear: "multilink",
	},
};

const DEFAULT_PROFILE: ArchetypeProfile = {
	cd: 0.32,
	wheelbase_m: 2.6,
	weight_front_pct: 57,
	suspension_front: "strut",
	suspension_rear: "multilink",
};

// ── Gear sets ─────────────────────────────────────────────────────────

const GEAR_SETS: Record<string, GearSet> = {
	"80s_90s_na": { ratios: [3.6, 2.1, 1.4, 1.0, 0.8], final_drive: 4.1 },
	"2000s_turbo": { ratios: [3.3, 2.0, 1.4, 1.0, 0.75, 0.65], final_drive: 3.7 },
	"2010s+_na": { ratios: [3.5, 2.1, 1.5, 1.1, 0.85, 0.7], final_drive: 3.5 },
};

// ── PredictedSpecs output ─────────────────────────────────────────────

export interface PredictedSpecs {
	cd?: number;
	cd_predicted?: true;
	wheelbase_m?: number;
	wheelbase_m_predicted?: true;
	weight_front_pct?: number;
	weight_front_pct_predicted?: true;
	gear_ratios?: GearSet;
	gear_ratios_predicted?: true;
	suspension_front?: string;
	suspension_front_predicted?: true;
	suspension_rear?: string;
	suspension_rear_predicted?: true;
}

// ── Era classification ────────────────────────────────────────────────

export function classify_era(year: unknown): string {
	if (typeof year !== "number" || !Number.isInteger(year) || year < 1900) return "2000s";
	if (year < 1990) return "80s";
	if (year < 2000) return "90s";
	if (year < 2010) return "2000s";
	if (year < 2020) return "2010s";
	return "2020s";
}

// ── Profile lookup ────────────────────────────────────────────────────

const ALL_DRIVETRAINS = ["fwd", "rwd", "awd"] as const;
const ALL_ERAS = ["2020s", "2010s", "2000s", "90s", "80s"] as const;

export function getProfile(
	bodyType: string | null | undefined,
	era: string,
	drivetrain: string | null | undefined,
): ArchetypeProfile {
	// Exact match
	if (bodyType && drivetrain) {
		const key = `${bodyType}|${era}|${drivetrain}`;
		if (key in PROFILES) return PROFILES[key];
	}

	// Same body + era, any drivetrain
	if (bodyType) {
		for (const dt of ALL_DRIVETRAINS) {
			const key = `${bodyType}|${era}|${dt}`;
			if (key in PROFILES) return PROFILES[key];
		}
	}

	// Same body, any era
	if (bodyType) {
		for (const e of ALL_ERAS) {
			for (const dt of ALL_DRIVETRAINS) {
				const key = `${bodyType}|${e}|${dt}`;
				if (key in PROFILES) return PROFILES[key];
			}
		}
	}

	return DEFAULT_PROFILE;
}

// ── Gear ratio prediction ─────────────────────────────────────────────

function predictGearRatios(engine: Record<string, unknown> | undefined, era: string): GearSet | null {
	if (!engine) return GEAR_SETS["80s_90s_na"];

	const displacement = typeof engine.displacement_l === "number" ? engine.displacement_l : null;
	const aspiration = String(engine.aspiration ?? "").toLowerCase();
	let isTurbo = aspiration.includes("turbo") || aspiration.includes("supercharge");

	// Heuristic: >2.5L in 80s/90s likely turbo for performance cars
	if (!isTurbo && displacement !== null && displacement > 2.5 && (era === "80s" || era === "90s")) {
		isTurbo = true;
	}

	if ((era === "80s" || era === "90s") && !isTurbo) return GEAR_SETS["80s_90s_na"];
	if (era === "2000s" && isTurbo) return GEAR_SETS["2000s_turbo"];
	if (era === "2010s" || era === "2020s") return GEAR_SETS["2010s+_na"];
	return GEAR_SETS["80s_90s_na"];
}

// ── Main prediction function ──────────────────────────────────────────

const LENGTH_THRESHOLD_LONG = 4.5;
const LENGTH_THRESHOLD_SHORT = 4.0;
const CD_ADJUSTMENT_FACTOR = 0.002;
const CD_ADJUSTMENT_STEP = 0.1;
const WHEELBASE_LENGTH_RATIO = 0.57;
const FWD_FRONT_WEIGHT_BONUS = 3;
const AWD_FRONT_WEIGHT_BONUS = 1;
const MAX_WEIGHT_FRONT_PCT = 70;

export function predict_specs(car: CarMetadata): PredictedSpecs {
	if (!car) return {};

	const era = classify_era(car.year);
	const profile = getProfile(car.bodyType, era, car.drivetrain);
	const dimensions = car.dimensions ?? {};
	const engine = car.engine ?? {};
	const aero = car.aero ?? {};
	const suspension = car.suspension ?? {};

	const lengthM = typeof dimensions.length_m === "number" && dimensions.length_m > 0 ? dimensions.length_m : null;

	const predicted: PredictedSpecs = {};

	// --- Cd (drag coefficient) ---
	if (aero.drag_coefficient == null || aero.drag_coefficient === 0) {
		let cd = profile.cd;
		if (lengthM !== null) {
			if (lengthM > LENGTH_THRESHOLD_LONG) {
				cd -= CD_ADJUSTMENT_FACTOR * ((lengthM - LENGTH_THRESHOLD_LONG) / CD_ADJUSTMENT_STEP);
			} else if (lengthM < LENGTH_THRESHOLD_SHORT) {
				cd += CD_ADJUSTMENT_FACTOR * ((LENGTH_THRESHOLD_SHORT - lengthM) / CD_ADJUSTMENT_STEP);
			}
		}
		predicted.cd = Math.round(cd * 1000) / 1000;
		predicted.cd_predicted = true;
	}

	// --- Wheelbase ---
	const hasWheelbase = dimensions.wheelbase_m != null && dimensions.wheelbase_m !== 0;
	if (!hasWheelbase && lengthM !== null) {
		predicted.wheelbase_m = Math.round(lengthM * WHEELBASE_LENGTH_RATIO * 1000) / 1000;
		predicted.wheelbase_m_predicted = true;
	} else if (!hasWheelbase) {
		predicted.wheelbase_m = profile.wheelbase_m;
		predicted.wheelbase_m_predicted = true;
	}

	// --- Weight distribution ---
	if (car.weightFrontPct === undefined || car.weightFrontPct === null) {
		let wd = profile.weight_front_pct;
		if (car.drivetrain === "fwd") wd += FWD_FRONT_WEIGHT_BONUS;
		else if (car.drivetrain === "awd") wd += AWD_FRONT_WEIGHT_BONUS;
		predicted.weight_front_pct = Math.min(wd, MAX_WEIGHT_FRONT_PCT);
		predicted.weight_front_pct_predicted = true;
	}

	// --- Gear ratios ---
	if (!engine || !("gear_ratios" in engine && engine.gear_ratios)) {
		const gears = predictGearRatios(engine as unknown as Record<string, unknown>, era);
		if (gears) {
			predicted.gear_ratios = gears;
			predicted.gear_ratios_predicted = true;
		}
	}

	// --- Suspension ---
	if (suspension.front_type === undefined || suspension.front_type === null) {
		predicted.suspension_front = profile.suspension_front;
		predicted.suspension_front_predicted = true;
	}
	if (suspension.rear_type === undefined || suspension.rear_type === null) {
		predicted.suspension_rear = profile.suspension_rear;
		predicted.suspension_rear_predicted = true;
	}

	return predicted;
}
