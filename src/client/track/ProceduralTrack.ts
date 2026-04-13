/**
 * Procedural track generation — seeded PRNG, spline curves, full mesh output.
 *
 * Produces Float32Array vertex/UV/color buffers + Uint32Array index buffers
 * for road, kerbs, grass, center-line dashes, and checker start/finish.
 * Also returns scenery placement data (trees, barriers, lights, fences).
 */

import { CatmullRomCurve3, Vector3 } from "three";

// ── Seeded PRNG ──────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
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

// ── Public types ─────────────────────────────────────────────────────────
export interface TrackSample {
	point: Vector3;
	left: Vector3;
	right: Vector3;
	kerbLeft: Vector3;
	kerbRight: Vector3;
	grassLeft: Vector3;
	grassRight: Vector3;
	binormal: Vector3;
	tangent: Vector3;
}

export interface SceneryItem {
	type: "tree" | "barrier" | "light" | "fence";
	position: Vector3;
	side: "left" | "right";
}

export interface TrackData {
	curve: CatmullRomCurve3;
	samples: TrackSample[];
	controlPoints3D: Vector3[];
	roadVerts: Float32Array;
	roadUVs: Float32Array;
	roadIndices: Uint32Array;
	kerbVerts: Float32Array;
	kerbColors: Float32Array;
	kerbIndices: Uint32Array;
	grassVerts: Float32Array;
	grassColors: Float32Array;
	grassIndices: Uint32Array;
	centerVerts: Float32Array;
	centerIndices: Uint32Array;
	checkerVerts: Float32Array;
	checkerIndices: Uint32Array;
	scenery: SceneryItem[];
	length: number;
	numControlPoints: number;
	numSamples: number;
	elevationRange: { min: number; max: number };
}

export interface TrackOptions {
	/** Number of control points around the loop (default 14) */
	numPoints?: number;
	/** Road width in world units (default 12) */
	width?: number;
	/** Elevation amplitude (default 40) */
	elevation?: number;
	/** Curve tightness 1-10 (default 5) */
	tightness?: number;
	/** Downhill bias 0-100 (default 60) */
	downhillBias?: number;
	/** Shoulder width (default 2) */
	shoulderWidth?: number;
	/** Kerb width (default 0.8) */
	kerbWidth?: number;
	/** Minimum samples per track (default 500) */
	minSamples?: number;
	/** Scenery density factor 0-2 (default 1) */
	sceneryDensity?: number;
}

// ── Track Generator ──────────────────────────────────────────────────────
export class ProceduralTrack {
	private seed: number;
	private opts: Required<TrackOptions>;

	constructor(seed: number, opts: TrackOptions = {}) {
		this.seed = seed;
		this.opts = {
			numPoints: opts.numPoints ?? 14,
			width: opts.width ?? 12,
			elevation: opts.elevation ?? 40,
			tightness: opts.tightness ?? 5,
			downhillBias: opts.downhillBias ?? 60,
			shoulderWidth: opts.shoulderWidth ?? 2,
			kerbWidth: opts.kerbWidth ?? 0.8,
			minSamples: opts.minSamples ?? 500,
			sceneryDensity: opts.sceneryDensity ?? 1,
		};
	}

	generate(): TrackData {
		const rng = mulberry32(this.seed);
		const noise = createNoise(rng);
		const { numPoints, tightness, elevation: elevationAmp, downhillBias } = this.opts;

		// ── 2-D control points on XZ plane ────────────────────────────────
		const baseRadius = 350 + (10 - tightness) * 50;
		const cp2d: { x: number; z: number }[] = [];
		for (let i = 0; i < numPoints; i++) {
			const baseAngle = (i / numPoints) * Math.PI * 2;
			const radiusJitter = (rng() * 2 - 1) * baseRadius * 0.35;
			const angleJitter = (rng() * 2 - 1) * ((Math.PI * 2) / numPoints) * 0.4;
			const r = baseRadius + radiusJitter;
			const a = baseAngle + angleJitter;
			cp2d.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
		}

		// Chaikin smoothing ×2
		for (let pass = 0; pass < 2; pass++) {
			const smoothed: { x: number; z: number }[] = [];
			for (let i = 0; i < numPoints; i++) {
				const prev = cp2d[(i - 1 + numPoints) % numPoints];
				const cur = cp2d[i];
				const next = cp2d[(i + 1) % numPoints];
				smoothed.push({
					x: cur.x * 0.6 + (prev.x + next.x) * 0.2,
					z: cur.z * 0.6 + (prev.z + next.z) * 0.2,
				});
			}
			for (let i = 0; i < numPoints; i++) cp2d[i] = smoothed[i];
		}

		// ── Add Y elevation ────────────────────────────────────────────────
		const cp3d = cp2d.map((p, i) => {
			const t = i / numPoints;
			let elevBias: number;
			if (t < 0.7) {
				elevBias = -t * (downhillBias / 100);
			} else {
				const climbT = (t - 0.7) / 0.3;
				elevBias = -0.7 * (downhillBias / 100) + climbT * 0.7 * (downhillBias / 100);
			}
			const n = noise(t * 3 + this.seed * 0.01) * 2 - 1;
			const y = elevBias * elevationAmp + n * elevationAmp * 0.3;
			return new Vector3(p.x, y, p.z);
		});

		// ── Spline ────────────────────────────────────────────────────────
		const curve = new CatmullRomCurve3(cp3d, true, "catmullrom", 0.5);
		const numSamples = Math.max(this.opts.minSamples, Math.round(curve.getLength() * 0.5));
		const sampledPoints = curve.getPoints(numSamples);
		const tangents: Vector3[] = [];
		for (let i = 0; i <= numSamples; i++) {
			tangents.push(curve.getTangent(i / numSamples));
		}

		// ── Cross-section offsets ─────────────────────────────────────────
		const { width, shoulderWidth, kerbWidth } = this.opts;
		const up = new Vector3(0, 1, 0);
		const samples: TrackSample[] = sampledPoints.map((point, i) => {
			const tangent = tangents[i];
			const binormal = new Vector3().crossVectors(tangent, up);
			if (binormal.lengthSq() < 0.001) binormal.set(1, 0, 0);
			binormal.normalize();
			const halfW = width / 2;
			return {
				point,
				left: point.clone().add(binormal.clone().multiplyScalar(-halfW)),
				right: point.clone().add(binormal.clone().multiplyScalar(halfW)),
				kerbLeft: point.clone().add(binormal.clone().multiplyScalar(-(halfW + kerbWidth))),
				kerbRight: point.clone().add(binormal.clone().multiplyScalar(halfW + kerbWidth)),
				grassLeft: point
					.clone()
					.add(binormal.clone().multiplyScalar(-(halfW + kerbWidth + shoulderWidth))),
				grassRight: point
					.clone()
					.add(binormal.clone().multiplyScalar(halfW + kerbWidth + shoulderWidth)),
				binormal,
				tangent,
			};
		});

		// ── Geometry buffers ──────────────────────────────────────────────
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
			if (i > 0) roadDist += s.point.distanceTo(samples[i - 1].point);

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

			// Closed loop: skip last row's quads (wraps to row 0)
			if (i >= samples.length - 1) break;

			const rb = i * 2;
			roadIndices.push(rb, rb + 1, rb + 2, rb + 1, rb + 3, rb + 2);

			const kb = i * 4;
			kerbIndices.push(kb, kb + 1, kb + 4, kb + 1, kb + 5, kb + 4);
			kerbIndices.push(kb + 2, kb + 6, kb + 3, kb + 3, kb + 6, kb + 7);

			const gb = i * 4;
			grassIndices.push(gb, gb + 1, gb + 4, gb + 1, gb + 5, gb + 4);
			grassIndices.push(gb + 2, gb + 6, gb + 3, gb + 3, gb + 6, gb + 7);
		}

		// ── Center-line dashes ────────────────────────────────────────────
		const centerVerts: number[] = [];
		const centerIndices: number[] = [];
		const dashLen = 3;
		const dashGap = 3;
		const totalDash = dashLen + dashGap;
		const dashHalfW = 0.15;
		let dashPhase = 0;
		let dashVertCount = 0;
		let dashOn = false;

		for (let i = 0; i < samples.length; i++) {
			const s = samples[i];
			const segLen = i > 0 ? s.point.distanceTo(samples[i - 1].point) : 0;
			dashPhase += segLen;
			dashOn = dashPhase % totalDash < dashLen;

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

		// ── Checker start/finish ──────────────────────────────────────────
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

		// ── Scenery ───────────────────────────────────────────────────────
		const scenery: SceneryItem[] = [];
		const density = this.opts.sceneryDensity;
		const spacing = Math.max(5, Math.round(30 / density));

		for (let i = 0; i < samples.length; i += spacing) {
			const s = samples[i];
			const _distFromCenter = Math.abs(s.point.y);
			const curvature =
				i > 0 && i < samples.length - 1 ? s.binormal.angleTo(samples[i + 1].binormal) : 0;

			// Trees — place on outer side of curves and randomly
			if (rng() < 0.6 * density) {
				const side =
					curvature > 0.05 ? "right" : curvature < -0.05 ? "left" : rng() < 0.5 ? "left" : "right";
				const offset = side === "left" ? s.grassLeft : s.grassRight;
				const treePos = offset
					.clone()
					.add(
						s.binormal.clone().multiplyScalar(side === "left" ? -8 - rng() * 15 : 8 + rng() * 15),
					);
				scenery.push({ type: "tree", position: treePos, side });
			}

			// Barriers on tight curves
			if (curvature > 0.1) {
				const inner = s.grassLeft.clone();
				scenery.push({ type: "barrier", position: inner, side: "left" });
			} else if (curvature < -0.1) {
				const inner = s.grassRight.clone();
				scenery.push({ type: "barrier", position: inner, side: "right" });
			}

			// Lights every ~100m
			if (i % (spacing * 3) === 0) {
				const lightSide = rng() < 0.5 ? s.grassLeft : s.grassRight;
				scenery.push({
					type: "light",
					position: lightSide.clone(),
					side: rng() < 0.5 ? "left" : "right",
				});
			}
		}

		// Elevation range
		const ys = samples.map((s) => s.point.y);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);

		return {
			curve,
			samples,
			controlPoints3D: cp3d,
			roadVerts: new Float32Array(roadVerts),
			roadUVs: new Float32Array(roadUVs),
			roadIndices: new Uint32Array(roadIndices),
			kerbVerts: new Float32Array(kerbVerts),
			kerbColors: new Float32Array(kerbColors),
			kerbIndices: new Uint32Array(kerbIndices),
			grassVerts: new Float32Array(grassVerts),
			grassColors: new Float32Array(grassColors),
			grassIndices: new Uint32Array(grassIndices),
			centerVerts: new Float32Array(centerVerts),
			centerIndices: new Uint32Array(centerIndices),
			checkerVerts: new Float32Array(checkerVerts),
			checkerIndices: new Uint32Array(checkerIndices),
			scenery,
			length: curve.getLength(),
			numControlPoints: cp3d.length,
			numSamples: samples.length,
			elevationRange: { min: minY, max: maxY },
		};
	}
}
