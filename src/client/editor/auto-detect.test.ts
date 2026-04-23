import { describe, expect, it } from "vitest";
import {
	BRAKE_PATTERNS,
	classifyPosition,
	EXHAUST_PATTERNS,
	fuzzyMatch,
	HEADLIGHT_PATTERNS,
	matchPosition,
	TAILLIGHT_PATTERNS,
	validatePositions,
	WHEEL_PATTERNS,
} from "./auto-detect.ts";

// ─── Fuzzy Matching ──────────────────────────────────────────────────────

describe("fuzzyMatch", () => {
	it("exact substring match returns 1.0", () => {
		expect(fuzzyMatch("wheel_FL", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("wheel_fl", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("WHEEL_RL", WHEEL_PATTERNS)).toBe(1.0);
	});

	it("matches abbreviated forms", () => {
		expect(fuzzyMatch("whl_fl", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("whl_fr", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("w_fl", WHEEL_PATTERNS)).toBe(0); // "w_fl" pattern is 3 chars, below 4-char minimum
	});

	it("matches spaced forms", () => {
		expect(fuzzyMatch("front_left_wheel", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("front right wheel", WHEEL_PATTERNS)).toBe(1.0);
	});

	it("matches partial patterns (tire, rim)", () => {
		expect(fuzzyMatch("tire_fl", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("rim_FR", WHEEL_PATTERNS)).toBe(0); // "rim" pattern is 3 chars, below 4-char minimum
	});

	it("brake disc patterns", () => {
		expect(fuzzyMatch("brake_disc_FL", BRAKE_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("brakedisc_fr", BRAKE_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("rotor", BRAKE_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("disc_rl", BRAKE_PATTERNS)).toBe(1.0);
	});

	it("headlight patterns", () => {
		expect(fuzzyMatch("headlight_L", HEADLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("head_lamp_R", HEADLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("front_light", HEADLIGHT_PATTERNS)).toBe(1.0);
	});

	it("taillight patterns", () => {
		expect(fuzzyMatch("taillight_L", TAILLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("tail_light_R", TAILLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("brake_light", TAILLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("turn_signal", TAILLIGHT_PATTERNS)).toBe(1.0);
	});

	it("exhaust patterns", () => {
		expect(fuzzyMatch("exhaust_pipe", EXHAUST_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("muffler", EXHAUST_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("tailpipe", EXHAUST_PATTERNS)).toBe(1.0);
	});

	it("no match returns 0", () => {
		expect(fuzzyMatch("body_panel", WHEEL_PATTERNS)).toBe(0);
		expect(fuzzyMatch("chassis", BRAKE_PATTERNS)).toBe(0);
		expect(fuzzyMatch("windshield", HEADLIGHT_PATTERNS)).toBe(0);
	});

	it("returns highest score across all patterns", () => {
		// "brake_disc_FL" matches both wheel patterns (contains "disc") and brake patterns
		const brakeScore = fuzzyMatch("brake_disc_FL", BRAKE_PATTERNS);
		expect(brakeScore).toBe(1.0);
	});

	it("short patterns (<4 chars) are skipped", () => {
		// Even if a short pattern existed, it would be ignored
		expect(fuzzyMatch("something", ["abc", "xy"])).toBe(0);
	});

	it("rejects low proximity matches (was 0.5 threshold, now 0.6)", () => {
		// "interior" should not match "headlight" patterns
		expect(fuzzyMatch("Interior_Seatbelt_0", HEADLIGHT_PATTERNS)).toBe(0);
		expect(fuzzyMatch("CarBody_Trueno_0", EXHAUST_PATTERNS)).toBe(0);
	});

	it("realistic car model names: wheels", () => {
		expect(fuzzyMatch("FL_Wheel_TireMaterial_0", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("FR_Wheel_RimMaterial_0", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("RL_Wheel_TireMaterial_0", WHEEL_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("RR_Wheel_RimMaterial_0", WHEEL_PATTERNS)).toBe(1.0);
	});

	it("realistic car model names: brake discs", () => {
		expect(fuzzyMatch("FL_Wheel_Brake_Disc_0", BRAKE_PATTERNS)).toBe(1.0); // compound pattern via segment concatenation
		expect(fuzzyMatch("FR_Caliper_BrakeCaliper_0", BRAKE_PATTERNS)).toBe(1.0);
	});

	it("realistic car model names: NOT wheels for brake/caliper", () => {
		// Brake disc and caliper should NOT match wheel patterns (excluded)
		// Note: fuzzyMatch doesn't check exclusions — that's done in collectCandidates
		// But the pattern "brake_disc" shouldn't be in WHEEL_PATTERNS anyway
		expect(fuzzyMatch("FL_Wheel_Brake_Disc_0", WHEEL_PATTERNS)).toBe(1.0); // still matches "wheel"
	});

	it("realistic car model names: headlights", () => {
		expect(fuzzyMatch("Headlights_Primary_0", HEADLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("Headlights_LampCovers_0", HEADLIGHT_PATTERNS)).toBe(1.0);
		expect(fuzzyMatch("Headlights_Reflector_0", HEADLIGHT_PATTERNS)).toBe(1.0);
	});

	it("realistic car model names: taillights", () => {
		expect(fuzzyMatch("CarBody_TailightFrame_0", TAILLIGHT_PATTERNS)).toBe(1.0);
	});

	it("realistic car model names: NOT exhaust for body parts", () => {
		// Trueno, body, interior should NOT match exhaust patterns
		expect(fuzzyMatch("CarBody_Trueno_0", EXHAUST_PATTERNS)).toBe(0);
		expect(fuzzyMatch("Interior_Seatbelt_0", EXHAUST_PATTERNS)).toBe(0);
		expect(fuzzyMatch("CarBody_Primary_0", EXHAUST_PATTERNS)).toBe(0);
	});
});

// ─── Position Matching ───────────────────────────────────────────────────

describe("matchPosition", () => {
	it("detects FL from common naming", () => {
		const result = matchPosition("wheel_FL");
		expect(result.side).toBe("L");
		expect(result.axle).toBe("F");
		expect(result.score).toBeGreaterThanOrEqual(1.0);
	});

	it("detects FR", () => {
		const result = matchPosition("wheel_FR");
		expect(result.side).toBe("R");
		expect(result.axle).toBe("F");
	});

	it("detects RL and RR", () => {
		expect(matchPosition("brake_disc_RL").axle).toBe("R");
		expect(matchPosition("brake_disc_RL").side).toBe("L");
		expect(matchPosition("brake_disc_RR").side).toBe("R");
	});

	it("detects spelled-out positions", () => {
		expect(matchPosition("front_left_wheel").side).toBe("L");
		expect(matchPosition("front_left_wheel").axle).toBe("F");
		expect(matchPosition("rear_right_wheel").side).toBe("R");
		expect(matchPosition("rear_right_wheel").axle).toBe("R");
	});

	it("detects left/right from spatial hints", () => {
		expect(matchPosition("headlight_left").side).toBe("L");
		expect(matchPosition("headlight_right").side).toBe("R");
	});

	it("returns null for names without position info", () => {
		const result = matchPosition("body_panel");
		expect(result.side).toBeNull();
		expect(result.axle).toBeNull();
		expect(result.score).toBe(0);
	});

	it("detects position from FL_ prefix (e.g. FL_Wheel_TireMaterial_0)", () => {
		const result = matchPosition("FL_Wheel_TireMaterial_0");
		expect(result.side).toBe("L");
		expect(result.axle).toBe("F");
		expect(result.score).toBeGreaterThanOrEqual(1.0);
	});

	it("detects position from FR_Caliper prefix", () => {
		const result = matchPosition("FR_Caliper_BrakeCaliper_0");
		expect(result.side).toBe("R");
		expect(result.axle).toBe("F");
	});

	it("detects position from RL_Wheel prefix", () => {
		const result = matchPosition("RL_Wheel_Brake_Disc_0");
		expect(result.side).toBe("L");
		expect(result.axle).toBe("R");
	});

	it("prefix takes priority over suffix", () => {
		// FL prefix + RR suffix = prefix wins
		const result = matchPosition("FL_something_RR");
		expect(result.side).toBe("L");
		expect(result.axle).toBe("F");
	});
});

// ─── Position Classification ─────────────────────────────────────────────

describe("classifyPosition", () => {
	const center = { x: 0, y: 0.25, z: 0 };
	const modelWidth = 2.0; // car is 2m wide

	it("uses name hint over position when confident", () => {
		const hint = { side: "L" as const, axle: "F" as const, score: 1.0 };
		const pos = { x: 0.7, y: 0, z: 1.2 };
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("FL");
	});

	it("falls back to spatial position when no name hint", () => {
		const hint = { side: null, axle: null, score: 0 };
		const pos = { x: -0.7, y: 0, z: 1.2 };
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("FL");
	});

	it("classifies right rear by position", () => {
		const hint = { side: null, axle: null, score: 0 };
		const pos = { x: 0.7, y: 0, z: -1.2 };
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("RR");
	});

	it("mixed: name says left, position determines axle", () => {
		const hint = { side: "L" as const, axle: null, score: 1.0 };
		const pos = { x: 0.7, y: 0, z: -1.2 };
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("RL");
	});

	it("centered object (x≈0) gets no side — just F or R", () => {
		const hint = { side: null, axle: null, score: 0 };
		const pos = { x: 0.0, y: 0, z: 1.2 }; // centered, front
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("F");

		const pos2 = { x: 0.0, y: 0, z: -1.2 }; // centered, rear
		expect(classifyPosition(pos2, center, hint, modelWidth)).toBe("R");
	});

	it("name hint overrides centered position", () => {
		const hint = { side: "L" as const, axle: "F" as const, score: 1.0 };
		const pos = { x: 0.0, y: 0, z: 1.2 }; // centered, but name says FL
		expect(classifyPosition(pos, center, hint, modelWidth)).toBe("FL");
	});
});

// ─── Validation ──────────────────────────────────────────────────────────

describe("validatePositions", () => {
	const center = { x: 0, y: 0.25, z: 0 };

	it("ok when all named positions match spatial positions", () => {
		const items = [
			{
				type: "wheel_FL",
				name: "wheel_FL",
				position: { x: -0.7, y: 0, z: 1.2 },
			},
			{
				type: "wheel_FR",
				name: "wheel_FR",
				position: { x: 0.7, y: 0, z: 1.2 },
			},
			{
				type: "wheel_RL",
				name: "wheel_RL",
				position: { x: -0.7, y: 0, z: -1.2 },
			},
			{
				type: "wheel_RR",
				name: "wheel_RR",
				position: { x: 0.7, y: 0, z: -1.2 },
			},
		];
		const result = validatePositions(items, center);
		expect(result.ok).toBe(true);
		expect(result.warnings).toEqual([]);
		expect(result.shouldFlip).toBe(false);
	});

	it("detects flipped car: all positions disagree with names", () => {
		const items = [
			{
				type: "wheel_FL",
				name: "wheel_FL",
				position: { x: 0.7, y: 0, z: -1.2 },
			}, // named FL but pos is RR
			{
				type: "wheel_FR",
				name: "wheel_FR",
				position: { x: -0.7, y: 0, z: -1.2 },
			}, // named FR but pos is RL
			{
				type: "wheel_RL",
				name: "wheel_RL",
				position: { x: 0.7, y: 0, z: 1.2 },
			}, // named RL but pos is FR
			{
				type: "wheel_RR",
				name: "wheel_RR",
				position: { x: -0.7, y: 0, z: 1.2 },
			}, // named RR but pos is FL
		];
		const result = validatePositions(items, center);
		expect(result.ok).toBe(false);
		expect(result.shouldFlip).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("partial mismatches don't trigger flip", () => {
		const items = [
			{
				type: "wheel_FL",
				name: "wheel_FL",
				position: { x: -0.7, y: 0, z: 1.2 },
			}, // correct
			{
				type: "wheel_FR",
				name: "wheel_FR",
				position: { x: 0.7, y: 0, z: 1.2 },
			}, // correct
			{
				type: "wheel_RL",
				name: "wheel_RL",
				position: { x: 0.7, y: 0, z: -1.2 },
			}, // side wrong
			{
				type: "wheel_RR",
				name: "wheel_RR",
				position: { x: -0.7, y: 0, z: -1.2 },
			}, // side wrong
		];
		const result = validatePositions(items, center);
		expect(result.ok).toBe(false);
		expect(result.shouldFlip).toBe(false); // only 2/8 disagree, not >60%
	});

	it("ignores non-positioned items (lights, exhausts)", () => {
		const items = [
			{
				type: "headlight_L",
				name: "headlight_L",
				position: { x: 0.7, y: 0, z: 1.2 },
			},
			{
				type: "exhaust_L",
				name: "exhaust_L",
				position: { x: 0.7, y: 0, z: -1.2 },
			},
		];
		const result = validatePositions(items, center);
		expect(result.ok).toBe(true);
		expect(result.warnings).toEqual([]);
		expect(result.shouldFlip).toBe(false);
	});
});

// ─── Classifier Integration Tests ───────────────────────────────────────
// Tests for false positive / false negative scenarios with classifiers

import { Vector3 } from "three";
import type { Candidate, ShapeInfo } from "./auto-detect.ts";
import {
	BRAKE_EXCLUSIONS,
	classifyBrakeDiscs,
	classifyLights,
	classifyWheels,
	HEADLIGHT_EXCLUSIONS,
	TAILLIGHT_EXCLUSIONS,
	WHEEL_EXCLUSIONS,
} from "./auto-detect.ts";

// Re-export to suppress unused-import lint — these exclusion lists are
// kept imported to ensure they stay in sync with the classifier logic
void WHEEL_EXCLUSIONS;
void BRAKE_EXCLUSIONS;
void HEADLIGHT_EXCLUSIONS;
void TAILLIGHT_EXCLUSIONS;

const center = new Vector3(0, 0.5, 0);
const modelWidth = 2.0;
const defaultShape: ShapeInfo = {
	size: new Vector3(0.4, 0.2, 0.4),
	sorted: [0.4, 0.4, 0.2],
	volume: 0.032,
	isDisc: true,
	isCylinder: false,
	isSmall: true,
};

function makeCandidate(overrides: Partial<Candidate> & { name: string }): Candidate {
	return {
		mesh: { isMesh: true } as any,
		nameScore: 0,
		shapeScore: 0,
		totalScore: 0,
		position: new Vector3(0, 0, 0),
		shape: { ...defaultShape },
		namePosition: { side: null, axle: null, score: 0 },
		material: null as any,
		...overrides,
	};
}

describe("classifyWheels", () => {
	it("detects wheels with 'wheel' in name", () => {
		const c = makeCandidate({
			name: "FL_Wheel_TireMaterial_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			nameScore: 0.7,
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const result = classifyWheels([c], center, modelWidth);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("wheel_FL");
	});

	it("detects multiple meshes per wheel position (tire + rim)", () => {
		const candidates = [
			makeCandidate({
				name: "FL_Wheel_TireMaterial_0",
				position: new Vector3(-0.7, 0.3, 1.2),
				nameScore: 0.7,
				namePosition: { side: "L", axle: "F", score: 1.0 },
			}),
			makeCandidate({
				name: "FL_Wheel_RimMaterial_0",
				position: new Vector3(-0.72, 0.35, 1.2),
				nameScore: 0.7,
				namePosition: { side: "L", axle: "F", score: 1.0 },
			}),
			makeCandidate({
				name: "FR_Wheel_TireMaterial_0",
				position: new Vector3(0.7, 0.3, 1.2),
				nameScore: 0.7,
				namePosition: { side: "R", axle: "F", score: 1.0 },
			}),
			makeCandidate({
				name: "FR_Wheel_RimMaterial_0",
				position: new Vector3(0.72, 0.35, 1.2),
				nameScore: 0.7,
				namePosition: { side: "R", axle: "F", score: 1.0 },
			}),
		];
		const result = classifyWheels(candidates, center, modelWidth);
		expect(result).toHaveLength(4);
		expect(result.filter((w) => w.type === "wheel_FL")).toHaveLength(2);
		expect(result.filter((w) => w.type === "wheel_FR")).toHaveLength(2);
	});

	it("does NOT classify brake disc meshes as wheels (exclusion)", () => {
		const c = makeCandidate({
			name: "FL_Wheel_Brake_Disc_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			nameScore: 0.7,
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const result = classifyWheels([c], center, modelWidth);
		// FL_Wheel_Brake_Disc matches both wheel and brake patterns
		// It should be a wheel too since it has 'wheel' in the name
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("wheel_FL");
	});

	it("excludes pure body meshes (no wheel/brake in name)", () => {
		const c = makeCandidate({
			name: "CarBody_Trueno_0",
			position: new Vector3(0, 0.5, 0),
			nameScore: 0,
		});
		const result = classifyWheels([c], center, modelWidth);
		expect(result).toHaveLength(0);
	});
});

describe("classifyBrakeDiscs", () => {
	it("detects FL_Wheel_Brake_Disc_0 as brake disc despite 'wheel' exclusion", () => {
		const c = makeCandidate({
			name: "FL_Wheel_Brake_Disc_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const result = classifyBrakeDiscs([c], center, modelWidth);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("brake_disc_FL");
	});

	it("detects caliper meshes as brake discs", () => {
		const c = makeCandidate({
			name: "FL_Caliper_BrakeCaliper_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const result = classifyBrakeDiscs([c], center, modelWidth);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("brake_disc_FL");
	});

	it("detects multiple brake discs per position", () => {
		const candidates = [
			makeCandidate({
				name: "FL_Wheel_Brake_Disc_0",
				position: new Vector3(-0.7, 0.3, 1.2),
				namePosition: { side: "L", axle: "F", score: 1.0 },
			}),
			makeCandidate({
				name: "FL_Caliper_BrakeCaliper_0",
				position: new Vector3(-0.72, 0.35, 1.2),
				namePosition: { side: "L", axle: "F", score: 1.0 },
			}),
		];
		const result = classifyBrakeDiscs(candidates, center, modelWidth);
		expect(result).toHaveLength(2);
		expect(result.every((d) => d.type === "brake_disc_FL")).toBe(true);
	});

	it("excludes pure tire meshes (no brake pattern match)", () => {
		const c = makeCandidate({
			name: "FL_Wheel_TireMaterial_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const result = classifyBrakeDiscs([c], center, modelWidth);
		expect(result).toHaveLength(0);
	});
});

describe("classifyLights", () => {
	it("detects headlights by name", () => {
		const c = makeCandidate({
			name: "Headlights_Primary_0",
			position: new Vector3(0, 0.6, 1.5),
			nameScore: 0.8,
		});
		const result = classifyLights([c], center, modelWidth, ["headlight", "headlamp"], "headlight", []);
		expect(result).toHaveLength(1);
		expect(result[0].type).toContain("headlight");
	});

	it("does NOT classify wheel tires as headlights even with emissive material", () => {
		const c = makeCandidate({
			name: "FR_Wheel_TireMaterial_0",
			position: new Vector3(0.7, 0.3, 1.2),
			nameScore: 0,
		});
		const result = classifyLights([c], center, modelWidth, ["headlight", "headlamp"], "headlight", []);
		expect(result).toHaveLength(0);
	});

	it("does NOT classify wheel rims as taillights even with emissive material", () => {
		const c = makeCandidate({
			name: "RL_Wheel_RimMaterial_0",
			position: new Vector3(-0.7, 0.3, -1.2),
			nameScore: 0,
		});
		const result = classifyLights([c], center, modelWidth, ["taillight", "taillamp"], "taillight", []);
		expect(result).toHaveLength(0);
	});

	it("detects taillights by name even without emissive", () => {
		const c = makeCandidate({
			name: "CarBody_TailightFrame_0",
			position: new Vector3(0, 0.6, -1.5),
			nameScore: 0.8,
		});
		const result = classifyLights([c], center, modelWidth, ["taillight", "tailight"], "taillight", []);
		expect(result).toHaveLength(1);
		expect(result[0].type).toContain("taillight");
	});

	it("excludes headlight-named meshes from taillight classification", () => {
		const c = makeCandidate({
			name: "Headlights_Primary_0",
			position: new Vector3(0, 0.6, 1.5),
			nameScore: 0.8,
		});
		const result = classifyLights([c], center, modelWidth, ["taillight"], "taillight", ["headlight"]);
		expect(result).toHaveLength(0);
	});

	it("detects multiple headlights at same position", () => {
		const candidates = [
			makeCandidate({
				name: "Headlights_Primary_0",
				position: new Vector3(0, 0.6, 1.5),
				nameScore: 0.8,
			}),
			makeCandidate({
				name: "Headlights_TurnSignal_0",
				position: new Vector3(0.1, 0.6, 1.5),
				nameScore: 0.5,
			}),
		];
		const result = classifyLights(candidates, center, modelWidth, ["headlight", "headlamp"], "headlight", []);
		expect(result).toHaveLength(2);
	});
});

describe("auto-detect false positive regression", () => {
	it("tire with emissive material is NOT a headlight (key regression)", () => {
		const tire = makeCandidate({
			name: "FR_Wheel_TireMaterial_0",
			position: new Vector3(0.7, 0.3, 1.2),
			nameScore: 0,
		});
		const headlightResult = classifyLights([tire], center, modelWidth, ["headlight", "headlamp"], "headlight", []);
		const taillightResult = classifyLights([tire], center, modelWidth, ["taillight"], "taillight", []);
		expect(headlightResult).toHaveLength(0);
		expect(taillightResult).toHaveLength(0);
	});

	it("brake disc with wheel in name IS a brake disc", () => {
		const disc = makeCandidate({
			name: "FL_Wheel_Brake_Disc_0",
			position: new Vector3(-0.7, 0.3, 1.2),
			namePosition: { side: "L", axle: "F", score: 1.0 },
		});
		const brakeResult = classifyBrakeDiscs([disc], center, modelWidth);
		expect(brakeResult).toHaveLength(1);
		expect(brakeResult[0].type).toBe("brake_disc_FL");
	});

	it("body mesh with emissive is NOT a headlight", () => {
		const body = makeCandidate({
			name: "CarBody_Trueno_0",
			position: new Vector3(0, 0.5, 0),
			nameScore: 0,
		});
		const result = classifyLights([body], center, modelWidth, ["headlight"], "headlight", []);
		expect(result).toHaveLength(0);
	});

	it("exhaust mesh is NOT a headlight", () => {
		const exhaust = makeCandidate({
			name: "Exhaust_Pipe_0",
			position: new Vector3(0, 0.15, -1.5),
			nameScore: 0,
		});
		const result = classifyLights([exhaust], center, modelWidth, ["headlight"], "headlight", []);
		expect(result).toHaveLength(0);
	});
});
