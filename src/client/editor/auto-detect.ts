/**
 * Smart auto-detect for car editor — wheels, brake discs, headlights, taillights, exhausts.
 *
 * Strategy:
 * 1. Collect all meshes with scores from name matching + shape analysis
 * 2. Classify into types (wheel, brake_disc, headlight, taillight, exhaust)
 * 3. Position-based assignment: left/right by X, front/rear by Z
 * 4. Validate left/right consistency (e.g. FL on left side of car)
 * 5. If validation fails, try rotating the model 180° and re-check
 * 6. Place markers at detected positions + assign object highlights
 */
import * as THREE from "three";

// ─── Types ───────────────────────────────────────────────────────────────

export interface DetectedItem {
	type: string; // e.g. "wheel_FL", "headlight_L"
	mesh: THREE.Mesh;
	name: string;
	position: THREE.Vector3;
	confidence: number; // 0-1
	source: "name" | "shape" | "material";
}

export interface ExhaustMarker {
	type: string; // e.g. "exhaust_R", "exhaust_RL"
	position: THREE.Vector3;
}

export interface AutoDetectResult {
	wheels: DetectedItem[];
	brakeDiscs: DetectedItem[];
	headlights: DetectedItem[];
	taillights: DetectedItem[];
	exhaustMarkers: ExhaustMarker[];
	physicsMarker: THREE.Vector3 | null; // auto-computed center of mass position
	flipped: boolean; // true if model was auto-rotated 180°
	warnings: string[]; // validation messages
}

// ─── Pure functions (exported for testing) ───────────────────────────────

/** Simple fuzzy substring match — returns 0-1 score.
 *  Exact substring match always works (even for short patterns).
 *  Character proximity (sequential char match) requires pattern ≥4 chars to avoid false positives.
 *  Proximity scoring: ≥80% match = 0.8, ≥60% = 0.5.
 */
export function fuzzyMatch(name: string, patterns: string[]): number {
	const n = name.toLowerCase();
	if (n.length < 3) return 0;
	// Split name into segments for word-boundary matching
	const segments = n.split(/[_\-\s]+/);
	let best = 0;
	for (const pat of patterns) {
		const p = pat.toLowerCase().replace(/[_\-\s]+/g, "");
		if (p.length < 4) continue; // skip short patterns (too many false positives)
		// Check each name segment and segment concatenations for exact/prefix match
		// (word-boundary match), not in the middle of another word
		for (let si = 0; si < segments.length; si++) {
			if (segments[si].startsWith(p) || segments[si] === p) {
				best = Math.max(best, 1.0);
				break;
			}
			// Check concatenation with next segments for compound patterns
			for (let concat = 1; concat <= 2 && si + concat < segments.length; concat++) {
				const joined = segments.slice(si, si + concat + 1).join("");
				if (joined.startsWith(p) || joined === p) {
					best = Math.max(best, 1.0);
					break;
				}
			}
			if (best >= 1.0) break;
		}
		if (best >= 1.0) continue;
		// Subsequence match: check consecutive segment pairs (for compound patterns like "brake_disc")
		// and individual segments. Require density > 40% to avoid "tire" in "tailightframe".
		for (let si = 0; si < segments.length; si++) {
			// Try individual segment
			let pi = 0;
			for (let c = 0; c < segments[si].length && pi < p.length; c++) {
				if (segments[si][c] === p[pi]) pi++;
			}
			const ratio = pi / p.length;
			const density = p.length / segments[si].length;
			if (ratio >= 0.9 && density >= 0.4) best = Math.max(best, 0.8);
			else if (ratio >= 0.8 && density >= 0.45) best = Math.max(best, 0.5);
			if (best >= 0.8) break;

			// Try concatenation with next segment (for "brake_disc" matching "brake" + "disc")
			if (si + 1 < segments.length) {
				const combined = segments[si] + segments[si + 1];
				pi = 0;
				for (let c = 0; c < combined.length && pi < p.length; c++) {
					if (combined[c] === p[pi]) pi++;
				}
				const r2 = pi / p.length;
				const d2 = p.length / combined.length;
				if (r2 >= 0.9 && d2 >= 0.4) best = Math.max(best, 0.8);
				else if (r2 >= 0.8 && d2 >= 0.45) best = Math.max(best, 0.5);
				if (best >= 0.8) break;
			}
		}
	}
	return best;
}

/** Check if name suggests a position (front/back/left/right).
 *  Handles: FL_FR_RL_RR suffixes, left/right/front/rear words, driver/passenger.
 *  Also handles compound prefixes like "FL_Wheel_Brake_Disc_0".
 */
export function matchPosition(name: string): {
	side: "L" | "R" | null;
	axle: "F" | "R" | null;
	score: number;
} {
	const n = name.toLowerCase();
	const words = n.split(/[_\-\s]+/);
	const hasWord = (w: string) => words.includes(w);
	let side: "L" | "R" | null = null;
	let axle: "F" | "R" | null = null;
	let score = 0;

	// Check for FL/FR/RL/RR prefix as a separate word (e.g. "FL_Wheel_TireMaterial_0")
	// Use first word only to avoid false matches like "front_left" → "fl" at start of stripped
	const firstWord = words[0];
	const lastWord = words[words.length - 1];
	const isPositionToken = (w: string) => /^(fl|fr|rl|rr|l|r|f|b)$/i.test(w) && w.length <= 2;

	if (isPositionToken(firstWord)) {
		const t = firstWord.toLowerCase();
		if (t === "fl" || t === "rl") {
			side = "L";
			score += 0.5;
		} else if (t === "fr" || t === "rr") {
			side = "R";
			score += 0.5;
		} else if (t === "l") {
			side = "L";
			score += 0.5;
		} else if (t === "r") {
			side = "R";
			score += 0.5;
		}
		if (t === "fl" || t === "fr") {
			axle = "F";
			score += 0.5;
		} else if (t === "rl" || t === "rr") {
			axle = "R";
			score += 0.5;
		} else if (t === "f") {
			axle = "F";
			score += 0.5;
		} else if (t === "b") {
			axle = "R";
			score += 0.5;
		}
	}

	// Check for FL/FR/RL/RR suffix token (only if prefix didn't match)
	if (!side && !axle && isPositionToken(lastWord)) {
		const t = lastWord.toLowerCase();
		if (t === "fl" || t === "rl") {
			side = "L";
			score += 0.5;
		} else if (t === "fr" || t === "rr") {
			side = "R";
			score += 0.5;
		} else if (t === "l") {
			side = "L";
			score += 0.5;
		} else if (t === "r") {
			side = "R";
			score += 0.5;
		}
		if (t === "fl" || t === "fr") {
			axle = "F";
			score += 0.5;
		} else if (t === "rl" || t === "rr") {
			axle = "R";
			score += 0.5;
		} else if (t === "f") {
			axle = "F";
			score += 0.5;
		} else if (t === "b") {
			axle = "R";
			score += 0.5;
		}
	}

	// Word-based checks (only if prefix/suffix tokens didn't match)
	if (!side && !axle) {
		if (hasWord("left") || hasWord("driver")) {
			side = "L";
			score += 0.5;
		}
		if (hasWord("right") || hasWord("passenger") || hasWord("co-driver")) {
			side = "R";
			score += 0.5;
		}
		if (hasWord("front")) {
			axle = "F";
			score += 0.5;
		}
		if (hasWord("rear") || hasWord("back")) {
			axle = "R";
			score += 0.5;
		}
	}

	return { side, axle, score };
}

/** Classify a 3D position into FL/FR/RL/RR or L/R using position + name hints.
 *  NAME DOMINATES: if name gives a confident side/axle (score >= 0.5), it wins over spatial.
 *  If the object is centered (|x - center.x| < threshold), side is omitted → just "F" or "R".
 *  Threshold is relative to model width (1% of model extent). */
export function classifyPosition(
	pos: { x: number; y: number; z: number },
	center: { x: number; y: number; z: number },
	nameHint: { side: "L" | "R" | null; axle: "F" | "R" | null; score: number },
	modelWidth = 1.0,
): string {
	const useNameSide = nameHint.side && nameHint.score >= 0.5;
	const useNameAxle = nameHint.axle && nameHint.score >= 0.5;

	const posFront = pos.z > center.z ? "F" : "R";

	// Determine side: name hint ALWAYS wins when confident (>= 0.5)
	let side: "L" | "R" | null;
	if (useNameSide) {
		side = nameHint.side!;
	} else {
		// Only use spatial position for side if name gave NO hint at all
		const xDelta = pos.x - center.x;
		const centered = Math.abs(xDelta) < modelWidth * 0.05;
		side = centered ? null : xDelta < 0 ? "L" : "R";
	}

	// Determine axle: name hint ALWAYS wins when confident (>= 0.5)
	const axle = useNameAxle ? nameHint.axle! : posFront;

	return side ? `${axle}${side}` : axle;
}

/** Validate that named positions agree with spatial positions. */
export function validatePositions(
	items: {
		type: string;
		name: string;
		position: { x: number; y: number; z: number };
	}[],
	modelCenter: { x: number; y: number; z: number },
): { ok: boolean; warnings: string[]; shouldFlip: boolean } {
	const warnings: string[] = [];
	let flipVotes = 0;
	let totalPositioned = 0;

	for (const item of items) {
		const match = item.type.match(/^(wheel|brake_disc)_(F|R)(L|R)$/);
		if (!match) continue;

		const [, , nameAxle, nameSide] = match;
		const posLeft = item.position.x < modelCenter.x;
		const posFront = item.position.z > modelCenter.z;

		if (nameSide === "L" && !posLeft) {
			warnings.push(`${item.name}: named left but positioned on right`);
			flipVotes++;
		} else if (nameSide === "R" && posLeft) {
			warnings.push(`${item.name}: named right but positioned on left`);
			flipVotes++;
		}

		if (nameAxle === "F" && !posFront) {
			warnings.push(`${item.name}: named front but positioned at rear`);
			flipVotes++;
		} else if (nameAxle === "R" && posFront) {
			warnings.push(`${item.name}: named rear but positioned at front`);
			flipVotes++;
		}

		totalPositioned++;
	}

	// shouldFlip: if most positioned items have name↔position mismatches, model is mirrored.
	// Each item can mismatch on side (L/R) and/or axle (F/R), so max 2 votes per item.
	// Threshold: >40% of possible mismatches (was >60%, missed cases where only side was swapped)
	const shouldFlip = totalPositioned > 0 && flipVotes / (totalPositioned * 2) > 0.4;
	return { ok: flipVotes === 0, warnings, shouldFlip };
}

// ─── Name Pattern Libraries ─────────────────────────────────────────────

export const WHEEL_PATTERNS = [
	"wheel",
	"tire",
	"rim",
	"wheelrig",
	"whl",
	"w_fl",
	"w_fr",
	"w_rl",
	"w_rr",
	"w_lf",
	"w_rf",
	"w_lr",
	"w_rr",
	"whl_fl",
	"whl_fr",
	"whl_rl",
	"whl_rr",
	"wheel_fl",
	"wheel_fr",
	"wheel_rl",
	"wheel_rr",
	"wheel_lf",
	"wheel_rf",
	"wheel_lr",
	"wheel_rr",
	"tire_fl",
	"tire_fr",
	"tire_rl",
	"tire_rr",
	"front_left_wheel",
	"front_right_wheel",
	"rear_left_wheel",
	"rear_right_wheel",
];

/** Patterns that should NEVER match as wheels — sub-components of wheels */
export const WHEEL_EXCLUSIONS = [
	"brake",
	"caliper",
	"disc",
	"rotor",
	"brakedisc",
	"headlight",
	"taillight",
	"lamp",
	"interior",
	"seat",
	"steering",
	"mirror",
	"license",
	"plate",
	"trim",
	"body",
	"chassis",
	"window",
	"glass",
];

export const BRAKE_PATTERNS = [
	"brake_disc",
	"brakedisc",
	"brake_disc_fl",
	"brake_disc_fr",
	"brake_disc_rl",
	"brake_disc_rr",
	"brake_fl",
	"brake_fr",
	"brake_rl",
	"brake_rr",
	"disc_fl",
	"disc_fr",
	"disc_rl",
	"disc_rr",
	"brakedisc_fl",
	"brakedisc_fr",
	"brakedisc_rl",
	"brakedisc_rr",
	"front_brake",
	"rear_brake",
	"brake_caliper",
	"brakecaliper",
	"caliper",
	"rotor",
	"brake_rotor",
];

/** Patterns that should NEVER match as brake discs */
export const BRAKE_EXCLUSIONS = [
	"wheel",
	"tire",
	"rim",
	"headlight",
	"taillight",
	"lamp",
	"exhaust",
	"muffler",
	"interior",
	"seat",
	"body",
	"chassis",
];

export const HEADLIGHT_PATTERNS = [
	"headlight",
	"head_light",
	"headlamp",
	"head_lamp",
	"front_light",
	"frontlight",
	"frontlamp",
];

/** Patterns that should NEVER match as headlights — trim/covers/frames are not headlights themselves */
export const HEADLIGHT_EXCLUSIONS = [
	"taillight",
	"tail_light",
	"tail_lamp",
	"brake_light",
	"brakelight",
	"stoplight",
	"turn_signal",
	"turnsignal",
	"indicator",
	"reverse_light",
	"reverselight",
	"wheel",
	"tire",
	"rim",
	"brake_disc",
	"brakedisc",
	"caliper",
	"exhaust",
	"muffler",
	"tailpipe",
];

export const TAILLIGHT_PATTERNS = [
	"taillight",
	"tail_light",
	"taillamp",
	"tail_lamp",
	"rear_light",
	"rearlight",
	"rearlamp",
	"brake_light",
	"brakelight",
	"stoplight",
	"stop_light",
	"turn_signal",
	"turnsignal",
	"indicator",
	"reverse_light",
	"reverselight",
	"tailight",
	"tailightframe", // common typo / variant
];

export const TAILLIGHT_EXCLUSIONS = [
	"headlight",
	"head_light",
	"headlamp",
	"wheel",
	"tire",
	"rim",
	"brake_disc",
	"brakedisc",
	"caliper",
	"exhaust",
	"muffler",
	"tailpipe",
];

export const EXHAUST_PATTERNS = ["exhaust", "muffler", "tailpipe", "exhaust_pipe"];

export const EXHAUST_EXCLUSIONS = [
	"wheel",
	"tire",
	"rim",
	"brake",
	"disc",
	"rotor",
	"caliper",
	"headlight",
	"taillight",
	"lamp",
	"light",
	"interior",
	"seat",
	"body",
	"chassis",
	"mirror",
];

/** Check if a name matches any exclusion pattern (contains as substring). */
function matchesExclusion(name: string, exclusions: string[]): boolean {
	const n = name.toLowerCase().replace(/[_\-\s]+/g, "");
	for (const ex of exclusions) {
		if (n.includes(ex.toLowerCase().replace(/[_\-\s]+/g, ""))) return true;
	}
	return false;
}

// ─── Shape Analysis ──────────────────────────────────────────────────────

export interface ShapeInfo {
	size: THREE.Vector3;
	sorted: number[];
	volume: number;
	isDisc: boolean;
	isCylinder: boolean;
	isSmall: boolean;
}

function getWorldCenter(mesh: THREE.Mesh): THREE.Vector3 {
	mesh.geometry.computeBoundingBox();
	if (mesh.geometry.boundingBox) {
		const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
		mesh.localToWorld(center);
		return center;
	}
	const pos = new THREE.Vector3();
	mesh.getWorldPosition(pos);
	return pos;
}

// ─── Detection Functions ─────────────────────────────────────────────────

export interface Candidate {
	mesh: THREE.Mesh;
	name: string;
	nameScore: number;
	shapeScore: number;
	totalScore: number;
	position: THREE.Vector3;
	shape: ShapeInfo;
	namePosition: {
		side: "L" | "R" | null;
		axle: "F" | "R" | null;
		score: number;
	};
	material: THREE.Material | THREE.Material[];
}

function collectCandidates(model: THREE.Group): Candidate[] {
	const candidates: Candidate[] = [];

	model.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		const geo = mesh.geometry;
		if (!geo.attributes.position || geo.attributes.position.count < 3) return;

		const name = mesh.name || mesh.type;
		const position = getWorldCenter(mesh);

		// Score against each component type independently
		const wheelScore = matchesExclusion(name, WHEEL_EXCLUSIONS) ? 0 : fuzzyMatch(name, WHEEL_PATTERNS);
		const brakeScore = matchesExclusion(name, BRAKE_EXCLUSIONS) ? 0 : fuzzyMatch(name, BRAKE_PATTERNS);
		const headScore = matchesExclusion(name, HEADLIGHT_EXCLUSIONS) ? 0 : fuzzyMatch(name, HEADLIGHT_PATTERNS);
		const tailScore = matchesExclusion(name, TAILLIGHT_EXCLUSIONS) ? 0 : fuzzyMatch(name, TAILLIGHT_PATTERNS);
		const bestScore = Math.max(wheelScore, brakeScore, headScore, tailScore);

		if (bestScore < 0.3) return; // must have at least a moderate name match

		candidates.push({
			mesh,
			name,
			nameScore: bestScore,
			shapeScore: 0,
			totalScore: bestScore,
			position,
			shape: null as any,
			namePosition: matchPosition(name),
			material: mesh.material,
		});
	});

	console.log(`[auto-detect] ${candidates.length} candidates`);
	for (const c of candidates) {
		console.log(
			`  ${c.name}: name=${c.nameScore.toFixed(2)} pos=(${c.position.x.toFixed(2)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(2)})`,
		);
	}

	return candidates;
}

// ─── Classification ──────────────────────────────────────────────────────
// Each classifier only matches meshes whose names hit ITS patterns.
// No shape analysis, no emissive, no position-based scoring for type.

export function classifyWheels(
	candidates: Candidate[],
	modelCenter: THREE.Vector3,
	modelWidth: number,
): DetectedItem[] {
	const wheels: DetectedItem[] = [];

	for (const c of candidates) {
		const nameScore = fuzzyMatch(c.name, WHEEL_PATTERNS);
		if (nameScore < 0.3) continue; // only wheels here
		if (matchesExclusion(c.name, WHEEL_EXCLUSIONS) && nameScore < 0.5) continue;

		const pos = classifyPosition(c.position, modelCenter, c.namePosition, modelWidth);
		wheels.push({
			type: `wheel_${pos}`,
			mesh: c.mesh,
			name: c.name,
			position: c.position.clone(),
			confidence: nameScore,
			source: "name",
		});
	}

	console.log(`[auto-detect] Wheels: ${wheels.map((w) => `${w.type}(${w.confidence.toFixed(2)})`).join(", ")}`);
	return wheels;
}

export function classifyBrakeDiscs(
	candidates: Candidate[],
	modelCenter: THREE.Vector3,
	modelWidth: number,
): DetectedItem[] {
	const discs: DetectedItem[] = [];

	for (const c of candidates) {
		const nameScore = fuzzyMatch(c.name, BRAKE_PATTERNS);
		if (nameScore < 0.3) continue; // only brake discs here
		if (matchesExclusion(c.name, BRAKE_EXCLUSIONS) && nameScore < 0.5) continue;

		const pos = classifyPosition(c.position, modelCenter, c.namePosition, modelWidth);
		discs.push({
			type: `brake_disc_${pos}`,
			mesh: c.mesh,
			name: c.name,
			position: c.position.clone(),
			confidence: nameScore,
			source: "name",
		});
	}

	console.log(`[auto-detect] Brake discs: ${discs.map((d) => `${d.type}(${d.confidence.toFixed(2)})`).join(", ")}`);
	return discs;
}

export function classifyLights(
	candidates: Candidate[],
	modelCenter: THREE.Vector3,
	modelWidth: number,
	patterns: string[],
	baseType: "headlight" | "taillight",
	exclusions: string[],
): DetectedItem[] {
	const lights: DetectedItem[] = [];

	for (const c of candidates) {
		const nameScore = fuzzyMatch(c.name, patterns);
		if (nameScore < 0.3) continue; // only this light type here
		if (matchesExclusion(c.name, exclusions) && nameScore < 0.5) continue;

		const pos = classifyPosition(c.position, modelCenter, c.namePosition, modelWidth);
		lights.push({
			type: `${baseType}_${pos}`,
			mesh: c.mesh,
			name: c.name,
			position: c.position.clone(),
			confidence: nameScore,
			source: "name",
		});
	}

	console.log(`[auto-detect] ${baseType}s: ${lights.map((l) => `${l.type}(${l.confidence.toFixed(2)})`).join(", ")}`);
	return lights;
}

/** Estimate exhaust marker positions — no mesh detection needed.
 *  Exhaust is a marker-only concept: place at rear of car, low, near center.
 *  If a mesh named "exhaust"/"muffler"/"tailpipe" exists, use its position.
 *  Otherwise, estimate from model bounding box (rear-bottom-center). */
function estimateExhaustPositions(
	model: THREE.Group,
	modelCenter: THREE.Vector3,
	modelBox: THREE.Box3,
): ExhaustMarker[] {
	// Try to find an actual exhaust mesh for positioning
	let exhaustMeshPos: THREE.Vector3 | null = null;
	let exhaustFound = false;
	model.traverse((child) => {
		if (exhaustFound || !(child as THREE.Mesh).isMesh) return;
		const name = (child.name || "").toLowerCase().replace(/[_\-\s]+/g, "");
		if (name.includes("exhaust") || name.includes("muffler") || name.includes("tailpipe")) {
			exhaustMeshPos = new THREE.Vector3();
			child.getWorldPosition(exhaustMeshPos);
			exhaustFound = true;
		}
	});

	if (exhaustMeshPos) {
		const pos: THREE.Vector3 = exhaustMeshPos!;
		// Use the mesh position — classify as R (rear) or RL/RR
		const z = pos.z;
		const x = pos.x;
		const xDelta = x - modelCenter.x;
		const modelWidth = modelBox.max.x - modelBox.min.x;
		const centered = Math.abs(xDelta) < modelWidth * 0.15;
		if (centered) {
			return [{ type: "exhaust_R", position: pos }];
		} else {
			// Dual exhaust — estimate two positions symmetrically
			const offset = Math.abs(xDelta);
			const left = new THREE.Vector3(modelCenter.x - offset, pos.y, z);
			const right = new THREE.Vector3(modelCenter.x + offset, pos.y, z);
			return [
				{ type: "exhaust_RL", position: left },
				{ type: "exhaust_RR", position: right },
			];
		}
	}

	// Fallback: estimate from model bounds — rear-bottom-center
	const rearZ = modelBox.min.z;
	const bottomY = modelBox.min.y + (modelBox.max.y - modelBox.min.y) * 0.15;
	const pos = new THREE.Vector3(modelCenter.x, bottomY, rearZ);
	return [{ type: "exhaust_R", position: pos }];
}

// ─── Main Entry Point ────────────────────────────────────────────────────

export function autoDetect(model: THREE.Group): AutoDetectResult {
	const modelBox = new THREE.Box3().setFromObject(model);
	const modelCenter = modelBox.getCenter(new THREE.Vector3());
	const modelSize = modelBox.getSize(new THREE.Vector3());
	const modelWidth = modelSize.x;

	console.log(
		`[auto-detect] Model bounds: min=(${modelBox.min.x.toFixed(2)}, ${modelBox.min.y.toFixed(2)}, ${modelBox.min.z.toFixed(2)}) max=(${modelBox.max.x.toFixed(2)}, ${modelBox.max.y.toFixed(2)}, ${modelBox.max.z.toFixed(2)}) center=(${modelCenter.x.toFixed(2)}, ${modelCenter.y.toFixed(2)}, ${modelCenter.z.toFixed(2)})`,
	);

	const candidates = collectCandidates(model);

	let wheels = classifyWheels(candidates, modelCenter, modelWidth);
	let brakeDiscs = classifyBrakeDiscs(candidates, modelCenter, modelWidth);
	let headlights = classifyLights(
		candidates,
		modelCenter,
		modelWidth,
		HEADLIGHT_PATTERNS,
		"headlight",
		HEADLIGHT_EXCLUSIONS,
	);
	let taillights = classifyLights(
		candidates,
		modelCenter,
		modelWidth,
		TAILLIGHT_PATTERNS,
		"taillight",
		TAILLIGHT_EXCLUSIONS,
	);
	let exhaustMarkers = estimateExhaustPositions(model, modelCenter, modelBox);

	// Validate positions
	const allPositioned = [...wheels, ...brakeDiscs];
	const validation = validatePositions(allPositioned, modelCenter);

	// If validation says flip, rotate model 180° around Y and re-detect
	let flipped = false;
	if (validation.shouldFlip && allPositioned.length >= 2) {
		// Save original results in case flip doesn't help
		const origWheels = wheels;
		const origBrakeDiscs = brakeDiscs;
		const origHeadlights = headlights;
		const origTaillights = taillights;
		const origExhaustMarkers = exhaustMarkers;

		console.log(`[auto-detect] Car appears flipped (name↔position mismatch), rotating 180°...`);
		model.rotation.y += Math.PI;
		model.updateMatrixWorld(true);

		const newBox = new THREE.Box3().setFromObject(model);
		const newCenter = newBox.getCenter(new THREE.Vector3());
		console.log(
			`[auto-detect] New center: (${newCenter.x.toFixed(2)}, ${newCenter.y.toFixed(2)}, ${newCenter.z.toFixed(2)})`,
		);

		const newCandidates = collectCandidates(model);
		wheels = classifyWheels(newCandidates, newCenter, modelWidth);
		brakeDiscs = classifyBrakeDiscs(newCandidates, newCenter, modelWidth);
		headlights = classifyLights(
			newCandidates,
			newCenter,
			modelWidth,
			HEADLIGHT_PATTERNS,
			"headlight",
			HEADLIGHT_EXCLUSIONS,
		);
		taillights = classifyLights(
			newCandidates,
			newCenter,
			modelWidth,
			TAILLIGHT_PATTERNS,
			"taillight",
			TAILLIGHT_EXCLUSIONS,
		);
		exhaustMarkers = estimateExhaustPositions(model, newCenter, newBox);

		const revalidation = validatePositions([...wheels, ...brakeDiscs], newCenter);
		if (revalidation.ok) {
			console.log(`[auto-detect] Flip resolved all position mismatches`);
			flipped = true;
		} else {
			console.log(`[auto-detect] Flip didn't help, reverting`);
			model.rotation.y -= Math.PI;
			model.updateMatrixWorld(true);
			// Restore original detection results
			wheels = origWheels;
			brakeDiscs = origBrakeDiscs;
			headlights = origHeadlights;
			taillights = origTaillights;
			exhaustMarkers = origExhaustMarkers;
		}
	}

	const warnings = validation.warnings.length > 0 && !flipped ? validation.warnings : [];

	// Compute PhysicsMarker position: center of wheelbase, at ground level
	let physicsMarker: THREE.Vector3 | null = null;
	if (wheels.length >= 2) {
		const positions = wheels.map((w) => w.position);
		const x = positions.reduce((s, p) => s + p.x, 0) / positions.length;
		const z = (Math.max(...positions.map((p) => p.z)) + Math.min(...positions.map((p) => p.z))) / 2;
		const y = Math.min(...positions.map((p) => p.y)); // ground level = lowest wheel
		physicsMarker = new THREE.Vector3(x, y, z);
	}

	const total = wheels.length + brakeDiscs.length + headlights.length + taillights.length + exhaustMarkers.length;
	console.log(
		`[auto-detect] Done: ${wheels.length} wheels, ${brakeDiscs.length} brake discs, ${headlights.length} headlights, ${taillights.length} taillights, ${exhaustMarkers.length} exhaust markers = ${total} total${flipped ? " (auto-flipped 180°)" : ""}`,
	);

	return {
		wheels,
		brakeDiscs,
		headlights,
		taillights,
		exhaustMarkers,
		physicsMarker,
		flipped,
		warnings,
	};
}
