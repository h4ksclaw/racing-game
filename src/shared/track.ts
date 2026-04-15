/**
 * Pure-math procedural track generation — no Three.js dependency.
 *
 * Works in both Node.js (server) and browsers (client).
 * Returns plain arrays/objects that the client can convert to Three.js buffers.
 */

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────
export function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (s >>> 14)) >>> 0) / 4294967296;
	};
}

// ── 1-D value noise ──────────────────────────────────────────────────────
function createNoise(rng: () => number): (x: number) => number {
	const perm = new Uint8Array(512);
	for (let i = 0; i < 256; i++) perm[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = (rng() * (i + 1)) | 0;
		[perm[i], perm[j]] = [perm[j], perm[i]];
	}
	for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a: number, b: number, t: number) => a + t * (b - a);
	const grad = (h: number, x: number) => ((h & 1) === 0 ? x : -x);
	return (x: number) => {
		const xi = Math.floor(x) & 255;
		const xf = x - Math.floor(x);
		const u = fade(xf);
		return lerp(grad(perm[xi], xf), grad(perm[xi + 1], xf - 1), u);
	};
}

// ── Minimal vec3 ops (avoid Three.js dependency) ─────────────────────────
interface V3 {
	x: number;
	y: number;
	z: number;
}

function v3(x: number, y: number, z: number): V3 {
	return { x, y, z };
}
function v3Add(a: V3, b: V3): V3 {
	return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}
function v3Scale(a: V3, s: number): V3 {
	return v3(a.x * s, a.y * s, a.z * s);
}
function v3Lerp(a: V3, b: V3, t: number): V3 {
	return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}
function v3Cross(a: V3, b: V3): V3 {
	return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function v3Len(a: V3): number {
	return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
function v3Normalize(a: V3): V3 {
	const len = v3Len(a);
	return len > 0.0001 ? v3Scale(a, 1 / len) : v3(1, 0, 0);
}
function v3Dist(a: V3, b: V3): number {
	return v3Len(v3Add(a, v3Scale(b, -1)));
}

// ── CatmullRom spline (pure math) ────────────────────────────────────────
function catmullRomPoint(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
	const t2 = t * t;
	const t3 = t2 * t;
	return {
		x:
			0.5 *
			(2 * p1.x +
				(-p0.x + p2.x) * t +
				(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
				(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
		y:
			0.5 *
			(2 * p1.y +
				(-p0.y + p2.y) * t +
				(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
				(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
		z:
			0.5 *
			(2 * p1.z +
				(-p0.z + p2.z) * t +
				(2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
				(-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
	};
}

function sampleSpline(controlPoints: V3[], closed: boolean, numSamples: number): V3[] {
	const n = controlPoints.length;
	const pts: V3[] = [];
	for (let i = 0; i < numSamples; i++) {
		const rawT = i / numSamples;
		const scaledT = rawT * (closed ? n : n - 1);
		const segIdx = Math.floor(scaledT);
		const localT = scaledT - segIdx;
		const p0 = controlPoints[(segIdx - 1 + n) % n];
		const p1 = controlPoints[segIdx % n];
		const p2 = controlPoints[(segIdx + 1) % n];
		const p3 = controlPoints[(segIdx + 2) % n];
		pts.push(catmullRomPoint(p0, p1, p2, p3, localT));
	}
	return pts;
}

// ── Public types ─────────────────────────────────────────────────────────

export interface TrackSample {
	point: V3;
	left: V3;
	right: V3;
	kerbLeft: V3;
	kerbRight: V3;
	grassLeft: V3;
	grassRight: V3;
	binormal: V3;
	tangent: V3;
}

export type SceneryType =
	| "tree_pineTallA"
	| "tree_pineTallB"
	| "tree_pineTallC"
	| "tree_pineTallD"
	| "tree_pineSmallA"
	| "tree_pineSmallB"
	| "tree_pineSmallC"
	| "tree_pineSmallD"
	| "tree_pineDefaultB"
	| "tree_broadA"
	| "tree_broadB"
	| "tree_broadC"
	| "tree_broadD"
	| "tree_deadA"
	| "tree_deadB"
	| "tree_twistedA"
	| "tree_twistedB"
	| "bush_common"
	| "bush_flowers"
	| "rock_tallA"
	| "rock_tallB"
	| "rock_tallC"
	| "rock_tallD"
	| "rock_tallE"
	| "rock_tallF"
	| "rock_tallG"
	| "rock_tallH"
	| "rock_tallI"
	| "rock_tallJ"
	| "stone_tallC"
	| "stone_tallD"
	| "stone_tallE"
	| "stone_tallF"
	| "stone_tallG"
	| "stone_tallH"
	| "stone_tallI"
	| "stone_tallJ"
	| "grass"
	| "grass_large"
	| "grass_wispy"
	| "stump_old"
	| "stump_round"
	| "stump_square"
	| "mushroom_red"
	| "crop_pumpkin"
	| "log_large"
	| "ground_grass"
	| "ground_riverBend"
	| "ground_riverBendBank"
	| "ground_riverRocks"
	| "ground_riverSplit"
	| "ground_riverStraight"
	| "lily_large"
	| "barrier"
	| "light"
	| "gate"
	| "gate-finish";

export interface SceneryItem {
	type: SceneryType;
	position: V3;
	rotation: number; // Y-axis rotation in radians
	scale: number;
}

export interface TrackOptions {
	width?: number;
	elevation?: number;
	tightness?: number;
	downhillBias?: number;
	shoulderWidth?: number;
	kerbWidth?: number;
	minSamples?: number;
	sceneryDensity?: number;
}

export interface TrackData {
	controlPoints3D: V3[];
	samples: TrackSample[];
	splinePoints: V3[];
	roadVerts: number[];
	roadUVs: number[];
	roadIndices: number[];
	kerbVerts: number[];
	kerbColors: number[];
	kerbIndices: number[];
	grassVerts: number[];
	grassColors: number[];
	grassIndices: number[];
	centerVerts: number[];
	centerIndices: number[];
	checkerVerts: number[];
	checkerIndices: number[];
	length: number;
	numControlPoints: number;
	numSamples: number;
	elevationRange: { min: number; max: number };
	maxExtent: number;
}

// ── Track Generator ──────────────────────────────────────────────────────

export function generateTrack(seed: number, opts: TrackOptions = {}): TrackData {
	const rng = mulberry32(seed);
	const noise = createNoise(rng);

	const _tightness = opts.tightness ?? 5;
	const elevationAmp = opts.elevation ?? 80;
	const downhillBias = (opts.downhillBias ?? 70) / 100;
	const width = opts.width ?? 12;
	const shoulderWidth = opts.shoulderWidth ?? 2;
	const kerbWidth = opts.kerbWidth ?? 0.8;
	const minSamples = opts.minSamples ?? 500;

	// ── Deformed polygon — safe, varied, no self-intersection ─────────
	const numBase = 15 + Math.floor(rng() * 10); // 15-24 vertices
	const baseRadius = 200 + rng() * 200; // 200-400m

	const cp2d: V3[] = [];
	for (let i = 0; i < numBase; i++) {
		const baseAngle = (i / numBase) * Math.PI * 2;
		const rFactor = 0.4 + rng() * 2.4; // 40%-280% — reduced tight bends
		const angleJitter = (rng() - 0.5) * ((Math.PI * 2) / numBase) * 0.8;
		const r = baseRadius * rFactor;
		const a = baseAngle + angleJitter;
		cp2d.push(v3(Math.cos(a) * r, 0, Math.sin(a) * r));
	}

	// Light smoothing (1 pass only — preserves shape character)
	{
		const n = cp2d.length;
		const smoothed: V3[] = [];
		for (let i = 0; i < n; i++) {
			const prev = cp2d[(i - 1 + n) % n];
			const cur = cp2d[i];
			const next = cp2d[(i + 1) % n];
			smoothed.push(
				v3(cur.x * 0.58 + (prev.x + next.x) * 0.21, 0, cur.z * 0.58 + (prev.z + next.z) * 0.21),
			);
		}
		for (let i = 0; i < n; i++) cp2d[i] = smoothed[i];
	}

	// ── Add Y elevation ────────────────────────────────────────────────────
	const cp3d = cp2d.map((p, i) => {
		const t = i / cp2d.length;
		let eb: number;
		if (t < 0.7) {
			eb = -t * downhillBias;
		} else {
			const ct = (t - 0.7) / 0.3;
			eb = -0.7 * downhillBias + ct * 0.7 * downhillBias;
		}
		const n = noise(t * 3 + seed * 0.01) * 2 - 1;
		const y = eb * elevationAmp + n * elevationAmp * 0.3;
		return v3(p.x, y, p.z);
	});

	// ── Spline sampling ───────────────────────────────────────────────────
	// Estimate length for sample count
	const coarse = sampleSpline(cp3d, true, 200);
	let coarseLen = 0;
	for (let i = 1; i < coarse.length; i++) coarseLen += v3Dist(coarse[i], coarse[i - 1]);
	const numSamples = Math.max(minSamples, Math.round(coarseLen * 0.5));

	const splinePoints = sampleSpline(cp3d, true, numSamples);

	// ── Cross-section offsets ─────────────────────────────────────────────
	// Remove last sample (near-duplicate of first for closed loop)
	const splineClean = splinePoints.slice(0, -1);
	const up = v3(0, 1, 0);
	const sn = splineClean.length;

	// Compute tangents from neighboring spline points (smooth, no seam discontinuity)
	const tangents: V3[] = splineClean.map((_, i) => {
		const prev = splineClean[(i - 1 + sn) % sn];
		const next = splineClean[(i + 1) % sn];
		return v3Normalize(v3Add(next, v3Scale(prev, -1)));
	});

	// Compute binormals with flip-prevention + smoothing (closed loop)
	const binormals: V3[] = [];
	{
		const raw: V3[] = tangents.map((t) => {
			const bn = v3Cross(t, up);
			return v3Len(bn) < 0.001 ? v3(1, 0, 0) : v3Normalize(bn);
		});
		// Forward pass: prevent sudden 180° flips
		for (let i = 0; i < sn; i++) {
			const prev = i === 0 ? raw[sn - 1] : binormals[i - 1];
			const dot = prev.x * raw[i].x + prev.y * raw[i].y + prev.z * raw[i].z;
			binormals.push(dot < 0 ? v3Scale(raw[i], -1) : raw[i]);
		}
		// Smooth passes (average with neighbors on closed loop)
		for (let pass = 0; pass < 3; pass++) {
			const smoothed: V3[] = [];
			for (let i = 0; i < sn; i++) {
				const prev = binormals[(i - 1 + sn) % sn];
				const cur = binormals[i];
				const next = binormals[(i + 1) % sn];
				smoothed.push(v3Normalize(v3Add(v3Add(prev, cur), next)));
			}
			for (let i = 0; i < sn; i++) binormals[i] = smoothed[i];
		}
	}

	const samples: TrackSample[] = splineClean.map((point, i) => {
		const binormal = binormals[i];
		const tangent = tangents[i];
		const halfW = width / 2;
		return {
			point,
			left: v3Add(point, v3Scale(binormal, -halfW)),
			right: v3Add(point, v3Scale(binormal, halfW)),
			kerbLeft: v3Add(point, v3Scale(binormal, -(halfW + kerbWidth))),
			kerbRight: v3Add(point, v3Scale(binormal, halfW + kerbWidth)),
			grassLeft: v3Add(point, v3Scale(binormal, -(halfW + kerbWidth + shoulderWidth))),
			grassRight: v3Add(point, v3Scale(binormal, halfW + kerbWidth + shoulderWidth)),
			binormal,
			tangent,
		};
	});

	// ── Geometry buffers ──────────────────────────────────────────────────
	const roadVerts: number[] = [];
	const roadUVs: number[] = [];
	const roadIndices: number[] = [];
	const kerbVerts: number[] = [];
	const kerbColors: number[] = [];
	const kerbIndices: number[] = [];
	const grassVerts: number[] = [];
	const grassColors: number[] = [];
	const grassIndices: number[] = [];
	let roadDist = 0;

	const KERB_RED = [0.8, 0.2, 0.2];
	const KERB_WHITE = [0.9, 0.9, 0.9];
	const kerbStripeLen = 2.0;

	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		if (i > 0) roadDist += v3Dist(s.point, samples[i - 1].point);

		// Road
		roadVerts.push(s.left.x, s.left.y + 0.02, s.left.z, s.right.x, s.right.y + 0.02, s.right.z);
		roadUVs.push(0, roadDist / 4, 1, roadDist / 4);

		// Kerbs
		kerbVerts.push(
			s.left.x,
			s.left.y + 0.03,
			s.left.z,
			s.kerbLeft.x,
			s.kerbLeft.y + 0.03,
			s.kerbLeft.z,
			s.right.x,
			s.right.y + 0.03,
			s.right.z,
			s.kerbRight.x,
			s.kerbRight.y + 0.03,
			s.kerbRight.z,
		);
		const stripe = Math.floor(roadDist / kerbStripeLen) % 2 === 0 ? KERB_RED : KERB_WHITE;
		kerbColors.push(...stripe, ...stripe, ...stripe, ...stripe);

		// Grass shoulders
		grassVerts.push(
			s.kerbLeft.x,
			s.kerbLeft.y + 0.01,
			s.kerbLeft.z,
			s.grassLeft.x,
			s.grassLeft.y + 0.01,
			s.grassLeft.z,
			s.kerbRight.x,
			s.kerbRight.y + 0.01,
			s.kerbRight.z,
			s.grassRight.x,
			s.grassRight.y + 0.01,
			s.grassRight.z,
		);
		const gv = 0.3 + Math.sin(roadDist * 0.3) * 0.04 + (rng() - 0.5) * 0.03;
		grassColors.push(0.28, gv + 0.04, 0.2, 0.28, gv, 0.2, 0.28, gv + 0.04, 0.2, 0.28, gv, 0.2);

		// Closed loop: build quads connecting to next row (or row 0 for last)
		const next = (i + 1) % samples.length;
		const rb = i * 2;
		const nb = next * 2;
		roadIndices.push(rb, rb + 1, nb, rb + 1, nb + 1, nb);

		const kb = i * 4;
		const nkb = next * 4;
		kerbIndices.push(kb, kb + 1, nkb, kb + 1, nkb + 1, nkb);
		kerbIndices.push(kb + 2, nkb + 2, kb + 3, kb + 3, nkb + 2, nkb + 3);

		const gb = i * 4;
		const ngb = next * 4;
		grassIndices.push(gb, gb + 1, ngb, gb + 1, ngb + 1, ngb);
		grassIndices.push(gb + 2, ngb + 2, gb + 3, gb + 3, ngb + 2, ngb + 3);
	}

	// ── Center-line dashes ────────────────────────────────────────────────
	const centerVerts: number[] = [];
	const centerIndices: number[] = [];
	const dashLen = 3;
	const dashGap = 3;
	const totalDash = dashLen + dashGap;
	const dashHalfW = 0.15;
	let dashPhase = 0;
	let dashVertCount = 0;

	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		const segLen = i > 0 ? v3Dist(s.point, samples[i - 1].point) : 0;
		dashPhase += segLen;
		const dashOn = dashPhase % totalDash < dashLen;

		if (dashOn) {
			const bn = s.binormal;
			centerVerts.push(
				s.point.x + bn.x * dashHalfW,
				s.point.y + 0.05,
				s.point.z + bn.z * dashHalfW,
				s.point.x - bn.x * dashHalfW,
				s.point.y + 0.05,
				s.point.z - bn.z * dashHalfW,
			);
			dashVertCount++;
			if (dashVertCount >= 2) {
				const base = (dashVertCount - 2) * 2;
				centerIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
			}
		} else {
			dashVertCount = 0;
		}
	}

	// ── Checker start/finish ──────────────────────────────────────────────
	const checkerVerts: number[] = [];
	const checkerIndices: number[] = [];
	const checkerSize = width / 2;
	const cellSize = 1;
	const startSample = samples[0];
	for (let row = 0; row < 2; row++) {
		for (let col = 0; col < Math.floor(checkerSize / cellSize); col++) {
			const isBlack = (row + col) % 2 === 0;
			const c1 = col * cellSize - checkerSize / 2 + checkerSize;
			const c2 = (col + 1) * cellSize - checkerSize / 2 + checkerSize;
			const r1 = row * cellSize - 1;
			const r2 = (row + 1) * cellSize - 1;
			const base = checkerVerts.length / 3;
			const bn = startSample.binormal;
			const tn = startSample.tangent;
			for (const [cx, cz] of [
				[c1, r1],
				[c2, r1],
				[c1, r2],
				[c2, r2],
			]) {
				checkerVerts.push(
					startSample.point.x + bn.x * cx + tn.x * cz,
					startSample.point.y + 0.04,
					startSample.point.z + bn.z * cx + tn.z * cz,
				);
			}
			if (isBlack) {
				checkerIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
			}
		}
	}

	// ── Elevation range ───────────────────────────────────────────────────
	const ys = samples.map((s) => s.point.y);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	// ── Track length ──────────────────────────────────────────────────────
	let length = 0;
	for (let i = 1; i < splinePoints.length; i++)
		length += v3Dist(splinePoints[i], splinePoints[i - 1]);

	return {
		controlPoints3D: cp3d,
		samples,
		splinePoints,
		roadVerts,
		roadUVs,
		roadIndices,
		kerbVerts,
		kerbColors,
		kerbIndices,
		grassVerts,
		grassColors,
		grassIndices,
		centerVerts,
		centerIndices,
		checkerVerts,
		checkerIndices,
		length,
		numControlPoints: cp3d.length,
		numSamples: samples.length,
		elevationRange: { min: minY, max: maxY },
		maxExtent: Math.max(
			...samples.map((s) => Math.sqrt(s.point.x * s.point.x + s.point.z * s.point.z)),
		),
	};
}

// ── Scenery generation (client-side, deterministic from seed) ─────────────

export function generateScenery(
	seed: number,
	samples: TrackSample[],
	opts: {
		sceneryDensity?: number;
		treeTypes?: SceneryType[];
		grassTypes?: SceneryType[];
		bushTypes?: SceneryType[];
		treeDensity?: number;
		grassDensity?: number;
		rockDensity?: number;
		avoidZones?: Array<{ x: number; z: number; radius: number }>;
	} = {},
): SceneryItem[] {
	const rng = mulberry32(seed);
	const sceneryDensity = opts.sceneryDensity ?? 1;
	const treeDens = sceneryDensity * (opts.treeDensity ?? 1);
	const grassDens = sceneryDensity * (opts.grassDensity ?? 1);
	const rockDens = sceneryDensity * (opts.rockDensity ?? 1);
	const scenery: SceneryItem[] = [];
	const spacing = Math.max(3, Math.round(15 / sceneryDensity));

	const TREE_TYPES: SceneryType[] = opts.treeTypes ?? [
		"tree_pineTallA",
		"tree_pineTallB",
		"tree_pineTallC",
		"tree_pineTallD",
		"tree_pineSmallA",
		"tree_pineSmallB",
		"tree_pineSmallC",
		"tree_pineSmallD",
		"tree_pineDefaultB",
	];
	const ROCK_TYPES: SceneryType[] = [
		"rock_tallA",
		"rock_tallB",
		"rock_tallC",
		"rock_tallD",
		"rock_tallE",
		"rock_tallF",
		"rock_tallG",
		"rock_tallH",
		"rock_tallI",
		"rock_tallJ",
	];
	const STONE_TYPES: SceneryType[] = [
		"stone_tallC",
		"stone_tallD",
		"stone_tallE",
		"stone_tallF",
		"stone_tallG",
		"stone_tallH",
		"stone_tallI",
		"stone_tallJ",
	];
	const GRASS_TYPES: SceneryType[] = opts.grassTypes ?? ["grass", "grass_large"];
	const BUSH_TYPES: SceneryType[] = opts.bushTypes ?? ["bush_common"];
	const FOREST_DETAIL: SceneryType[] = [
		"stump_old",
		"stump_round",
		"stump_square",
		"mushroom_red",
		"log_large",
	];

	let i = Math.floor(rng() * spacing); // random start offset
	while (i < samples.length) {
		// Interpolate between samples for natural jitter along track
		const jf = i + (rng() - 0.5) * spacing * 0.6;
		const j = Math.max(0, Math.min(Math.floor(jf), samples.length - 1));
		const jNext = Math.min(j + 1, samples.length - 1);
		const t = jf - Math.floor(jf);
		const s = {
			point: v3Lerp(samples[j].point, samples[jNext].point, t),
			tangent: samples[j].tangent,
			binormal: samples[j].binormal,
			grassLeft: v3Lerp(samples[j].grassLeft, samples[jNext].grassLeft, t),
			grassRight: v3Lerp(samples[j].grassRight, samples[jNext].grassRight, t),
		};
		const curvature =
			j > 0 && j < samples.length - 1
				? v3Len(v3Add(samples[j].binormal, v3Scale(samples[j + 1].binormal, -1)))
				: 0;

		const leftCurve = curvature > 0.05;
		const rightCurve = curvature < -0.05;

		// Trees (avoid tight curve inner side)
		if (rng() < 0.85 * treeDens) {
			const side = leftCurve ? 1 : rightCurve ? -1 : rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const dist = 6 + rng() * 150;
			const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
			scenery.push({
				type: TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.8 + rng() * 0.5,
			});
		}
		// Second tree (extra density)
		if (rng() < 0.85 * treeDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const dist = 8 + rng() * 150;
			const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
			scenery.push({
				type: TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.6 + rng() * 0.6,
			});
		}
		// Third tree (extra density)
		if (rng() < 0.75 * treeDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const dist = 10 + rng() * 150;
			const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
			scenery.push({
				type: TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.5 + rng() * 0.7,
			});
		}
		// Fourth tree (wider spread)
		if (rng() < 0.65 * treeDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const dist = 15 + rng() * 200;
			const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
			scenery.push({
				type: TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.4 + rng() * 0.8,
			});
		}

		// Fifth tree (very wide spread, smaller trees)
		if (rng() < 0.5 * treeDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const dist = 20 + rng() * 250;
			const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
			scenery.push({
				type: TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.3 + rng() * 0.9,
			});
		}

		// Rocky outcrops — dense clusters of rocks and stones
		if (rng() < 0.12 * rockDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const basePos = v3Add(offset, v3Scale(s.binormal, side * (5 + rng() * 20)));
			const clusterSize = 3 + Math.floor(rng() * 5);
			for (let c = 0; c < clusterSize; c++) {
				scenery.push({
					type: ROCK_TYPES[Math.floor(rng() * ROCK_TYPES.length)],
					position: v3Add(basePos, { x: (rng() - 0.5) * 6, y: 0, z: (rng() - 0.5) * 6 }),
					rotation: rng() * Math.PI * 2,
					scale: 0.4 + rng() * 1.0,
				});
			}
			for (let c = 0; c < 4; c++) {
				scenery.push({
					type: STONE_TYPES[Math.floor(rng() * STONE_TYPES.length)],
					position: v3Add(basePos, { x: (rng() - 0.5) * 8, y: 0, z: (rng() - 0.5) * 8 }),
					rotation: rng() * Math.PI * 2,
					scale: 0.3 + rng() * 0.5,
				});
			}
		}

		// Grass tufts — varied sizes/rotations for fuzzy look (near track)
		for (let g = 0; g < 25; g++) {
			if (rng() < 0.7 * sceneryDensity) {
				const side = rng() < 0.5 ? -1 : 1;
				const offset = side === -1 ? s.grassLeft : s.grassRight;
				const dist = 1 + rng() * 15;
				const jitter = (rng() - 0.5) * 5;
				const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
				pos.x += jitter;
				pos.z += jitter;
				scenery.push({
					type: GRASS_TYPES[Math.floor(rng() * GRASS_TYPES.length)],
					position: pos,
					rotation: rng() * Math.PI * 2,
					scale: 0.2 + rng() * 1.2,
				});
			}
		}

		// Bushes — low shrubbery near track (1-12 units)
		for (let b = 0; b < 8; b++) {
			if (rng() < 0.45 * sceneryDensity) {
				const side = rng() < 0.5 ? -1 : 1;
				const offset = side === -1 ? s.grassLeft : s.grassRight;
				const dist = 1.5 + rng() * 10;
				const jitter = (rng() - 0.5) * 4;
				const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
				pos.x += jitter;
				pos.z += jitter;
				scenery.push({
					type: BUSH_TYPES[Math.floor(rng() * BUSH_TYPES.length)],
					position: pos,
					rotation: rng() * Math.PI * 2,
					scale: 0.3 + rng() * 0.8,
				});
			}
		}

		// Bushes — wider spread (5-30 units)
		for (let b = 0; b < 5; b++) {
			if (rng() < 0.3 * sceneryDensity) {
				const side = rng() < 0.5 ? -1 : 1;
				const offset = side === -1 ? s.grassLeft : s.grassRight;
				const dist = 5 + rng() * 25;
				const jitter = (rng() - 0.5) * 6;
				const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
				pos.x += jitter;
				pos.z += jitter;
				scenery.push({
					type: BUSH_TYPES[Math.floor(rng() * BUSH_TYPES.length)],
					position: pos,
					rotation: rng() * Math.PI * 2,
					scale: 0.3 + rng() * 1.0,
				});
			}
		}

		// Grass tufts — wider spread (medium distance)
		for (let g = 0; g < 15; g++) {
			if (rng() < 0.5 * sceneryDensity) {
				const side = rng() < 0.5 ? -1 : 1;
				const offset = side === -1 ? s.grassLeft : s.grassRight;
				const dist = 8 + rng() * 40;
				const jitter = (rng() - 0.5) * 8;
				const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
				pos.x += jitter;
				pos.z += jitter;
				scenery.push({
					type: GRASS_TYPES[Math.floor(rng() * GRASS_TYPES.length)],
					position: pos,
					rotation: rng() * Math.PI * 2,
					scale: 0.2 + rng() * 1.4,
				});
			}
		}

		// Grass tufts — far spread (sparse)
		for (let g = 0; g < 8; g++) {
			if (rng() < 0.3 * sceneryDensity) {
				const side = rng() < 0.5 ? -1 : 1;
				const offset = side === -1 ? s.grassLeft : s.grassRight;
				const dist = 30 + rng() * 100;
				const jitter = (rng() - 0.5) * 12;
				const pos = v3Add(offset, v3Scale(s.binormal, side * dist));
				pos.x += jitter;
				pos.z += jitter;
				scenery.push({
					type: GRASS_TYPES[Math.floor(rng() * GRASS_TYPES.length)],
					position: pos,
					rotation: rng() * Math.PI * 2,
					scale: 0.2 + rng() * 1.6,
				});
			}
		}

		// Extra forest floor plants (mushrooms, stumps, logs) — second pass
		if (rng() < 0.3 * sceneryDensity) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const pos = v3Add(offset, v3Scale(s.binormal, side * (3 + rng() * 30)));
			scenery.push({
				type: FOREST_DETAIL[Math.floor(rng() * FOREST_DETAIL.length)],
				position: pos,
				rotation: rng() * Math.PI * 2,
				scale: 0.4 + rng() * 1.0,
			});
		}

		// Mushroom groves — clustered stumps, mushrooms, logs
		if (rng() < 0.15 * grassDens) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const basePos = v3Add(offset, v3Scale(s.binormal, side * (8 + rng() * 40)));
			const groveSize = 3 + Math.floor(rng() * 6);
			for (let c = 0; c < groveSize; c++) {
				scenery.push({
					type: FOREST_DETAIL[Math.floor(rng() * FOREST_DETAIL.length)],
					position: v3Add(basePos, { x: (rng() - 0.5) * 8, y: 0, z: (rng() - 0.5) * 8 }),
					rotation: rng() * Math.PI * 2,
					scale: 0.5 + rng() * 0.9,
				});
			}
		}

		// Pumpkin clusters (3D objects only)
		if (rng() < 0.06 * sceneryDensity) {
			const side = rng() < 0.5 ? -1 : 1;
			const offset = side === -1 ? s.grassLeft : s.grassRight;
			const basePos = v3Add(offset, v3Scale(s.binormal, side * (4 + rng() * 15)));
			const clusterSize = 3 + Math.floor(rng() * 5);
			for (let c = 0; c < clusterSize; c++) {
				scenery.push({
					type: "crop_pumpkin",
					position: v3Add(basePos, { x: (rng() - 0.5) * 5, y: 0, z: (rng() - 0.5) * 5 }),
					rotation: rng() * Math.PI * 2,
					scale: 0.5 + rng() * 1.0,
				});
			}
		}

		// Random stride — prevents grid-like spacing
		i += Math.max(1, Math.floor(spacing * (0.5 + rng())));
	}

	// Lights every ~80m, both sides
	for (let li = 0; li < samples.length; li += spacing * 4) {
		const ls = samples[li];
		for (const side of [-1, 1]) {
			// Place lights well past the kerb (further from road, outside fences)
			const edgePt = side === -1 ? ls.left : ls.right;
			const kerbPt = side === -1 ? ls.kerbLeft : ls.kerbRight;
			// Offset = kerb + 1.5x the edge→kerb distance + 1m further out
			const outX = side * ls.binormal.x;
			const outZ = side * ls.binormal.z;
			const offset = {
				x: kerbPt.x + (kerbPt.x - edgePt.x) * 1.5 + outX,
				y: kerbPt.y + (kerbPt.y - edgePt.y) * 1.5,
				z: kerbPt.z + (kerbPt.z - edgePt.z) * 1.5 + outZ,
			};
			// Orient light arm toward road center.
			// Model arm extends in -Z; rotating by θ around Y makes arm point (-sinθ, 0, -cosθ).
			// Left side: arm toward +binormal → θ = atan2(tx, tz) + π/2
			// Right side: arm toward -binormal → θ = atan2(tx, tz) - π/2
			const tAngle = Math.atan2(ls.tangent.x, ls.tangent.z);
			const armAngle = side === -1 ? tAngle + Math.PI / 2 : tAngle - Math.PI / 2;
			scenery.push({
				type: "light",
				position: { ...offset },
				rotation: armAngle,
				scale: 1,
			});
		}
	}

	// Gates at wide sections (~200m)
	for (let gi = 0; gi < samples.length; gi += spacing * 10) {
		const gs = samples[gi];
		const gc =
			gi > 0 && gi < samples.length - 1
				? v3Len(v3Add(gs.binormal, v3Scale(samples[gi + 1].binormal, -1)))
				: 0;
		if (gc < 0.05) {
			scenery.push({
				type: "gate",
				position: { ...gs.point },
				rotation: Math.atan2(gs.binormal.x, gs.binormal.z),
				scale: 1,
			});
		}
	}

	// Filter out any objects that ended up inside the road/guardrail zone
	// Clearance: road half-width (6) + kerb (0.8) + shoulder (2) + 1m buffer = ~10m
	let filtered = filterSceneryFromRoad(scenery, samples, 10);

	// Filter out items inside avoid zones (e.g., house footprints)
	const avoidZones = opts.avoidZones;
	if (avoidZones && avoidZones.length > 0) {
		filtered = filtered.filter((item) => {
			for (const zone of avoidZones) {
				const dx = item.position.x - zone.x;
				const dz = item.position.z - zone.z;
				if (dx * dx + dz * dz < zone.radius * zone.radius) return false;
			}
			return true;
		});
	}

	return filtered;
}

// ── House generation (client-side, deterministic from seed) ─────────────

export interface HouseItem {
	position: V3;
	rotation: number; // Y-axis rotation in radians (faces road)
	width: number;
	depth: number;
	wallHeight: number;
	roofPitch: number;
	side: number; // -1 = left, 1 = right
}

export interface HouseConfig {
	enabled: boolean;
	wallColor: [number, number, number];
	roofColor: [number, number, number];
	minSize: [number, number];
	maxSize: [number, number];
	heightRange: [number, number];
	roofPitch: number;
	spacing: number;
	distanceRange: [number, number];
	flattenRadius: number;
	chimney: boolean;
}

/**
 * Generate house placement positions along the track.
 * Similar pattern to generateScenery but much sparser.
 */
export function generateHouses(
	seed: number,
	samples: TrackSample[],
	config: HouseConfig,
): HouseItem[] {
	if (!config.enabled) return [];

	const rng = mulberry32(seed + 77777); // different stream from scenery
	const houses: HouseItem[] = [];
	let lastHouseIdx = -config.spacing;

	let i = Math.floor(rng() * config.spacing * 0.5);
	while (i < samples.length) {
		// Spacing check
		if (i - lastHouseIdx < config.spacing) {
			i += Math.max(1, Math.floor(config.spacing * (0.5 + rng())));
			continue;
		}

		const s = samples[i];
		const side = rng() < 0.5 ? -1 : 1;
		const edge = side === -1 ? s.grassLeft : s.grassRight;
		const dist =
			config.distanceRange[0] + rng() * (config.distanceRange[1] - config.distanceRange[0]);
		const pos = v3Add(edge, v3Scale(s.binormal, side * dist));

		// Width/depth with some randomization
		const width = config.minSize[0] + rng() * (config.maxSize[0] - config.minSize[0]);
		const depth = config.minSize[1] + rng() * (config.maxSize[1] - config.minSize[1]);
		const wallHeight =
			config.heightRange[0] + rng() * (config.heightRange[1] - config.heightRange[0]);

		// Rotation: face the road. Tangent angle gives track direction;
		// rotate 90° so the house front faces the road.
		const tangentAngle = Math.atan2(s.tangent.x, s.tangent.z);
		const rotation = tangentAngle + (side === -1 ? -Math.PI / 2 : Math.PI / 2);

		houses.push({
			position: pos,
			rotation,
			width,
			depth,
			wallHeight,
			roofPitch: config.roofPitch,
			side,
		});
		lastHouseIdx = i;

		i += Math.max(1, Math.floor(config.spacing * (0.7 + rng() * 0.6)));
	}

	// Filter houses from road zone (same as scenery)
	return filterHousesFromRoad(houses, samples, 10);
}

function filterHousesFromRoad(
	houses: HouseItem[],
	samples: TrackSample[],
	clearance: number,
): HouseItem[] {
	const step = Math.max(1, Math.floor(samples.length / 500));
	return houses.filter((house) => {
		for (let si = 0; si < samples.length; si += step) {
			const a = samples[si].point;
			const b = samples[Math.min(si + step, samples.length - 1)].point;
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const lenSq = dx * dx + dz * dz;
			let t = 0;
			if (lenSq > 0) {
				t = Math.max(
					0,
					Math.min(1, ((house.position.x - a.x) * dx + (house.position.z - a.z) * dz) / lenSq),
				);
			}
			const nearX = a.x + t * dx;
			const nearZ = a.z + t * dz;
			const distSq = (house.position.x - nearX) ** 2 + (house.position.z - nearZ) ** 2;
			if (distSq < clearance * clearance) return false;
		}
		return true;
	});
}

/**
 * Remove any scenery items that are too close to the track centerline.
 * Uses point-to-segment distance for accurate curve handling.
 * The clearance zone extends past the grass edge (where guardrails sit).
 */
function filterSceneryFromRoad(
	scenery: SceneryItem[],
	samples: TrackSample[],
	clearance: number,
): SceneryItem[] {
	const step = Math.max(1, Math.floor(samples.length / 500)); // check every Nth sample for perf
	return scenery.filter((item) => {
		for (let si = 0; si < samples.length; si += step) {
			const a = samples[si].point;
			const b = samples[Math.min(si + step, samples.length - 1)].point;
			// Point-to-segment distance (XZ only)
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const lenSq = dx * dx + dz * dz;
			let t = 0;
			if (lenSq > 0) {
				t = Math.max(
					0,
					Math.min(1, ((item.position.x - a.x) * dx + (item.position.z - a.z) * dz) / lenSq),
				);
			}
			const nearX = a.x + t * dx;
			const nearZ = a.z + t * dz;
			const distSq = (item.position.x - nearX) ** 2 + (item.position.z - nearZ) ** 2;
			if (distSq < clearance * clearance) return false;
		}
		return true;
	});
}
