/**
 * SkidMarks — dark tire marks painted on the road surface.
 *
 * Records wheel positions when tires slide and builds a mesh of thin
 * ribbon quads that sit slightly above the surface.
 *
 * Key design:
 * - Separate slides produce independent marks (gap breaks prevent connecting lines)
 * - Each mark fades independently based on its own age (per-point opacity)
 * - Color is dark rubber gray at low opacity — subtle, not overpowering
 * - Polygon offset prevents z-fighting with road surface
 */

import * as THREE from "three";

// ─── Tuning ─────────────────────────────────────────────────────────────

/** Distance between consecutive mark points (meters) */
const MARK_SPACING = 0.08;
/** Mark width (meters) — realistic tire contact patch */
const MARK_WIDTH = 0.25;
/** Maximum points per wheel ribbon before oldest are trimmed */
const MAX_POINTS = 3000;
/** Mark age before fading starts (seconds) */
const MARK_FADE_AGE = 12.0;
/** Seconds to fully fade out */
const MARK_FADE_DURATION = 6.0;
/** Surface offset — must clear the road mesh which sits +0.02m above terrain */
const SURFACE_OFFSET = 0.035;
/** Max distance between consecutive points before treating as a gap (meters).
 *  When sliding stops and resumes, the first new point will be far from the
 *  last old point — this threshold breaks the ribbon there. */
const GAP_THRESHOLD = 1.0;
/**
 * Skid mark color — dark rubber gray.
 * Road asphalt is ~0.35-0.45 gray, so 0.08 gives contrast without being harsh.
 */
const MARK_COLOR = new THREE.Color(0.08, 0.08, 0.08);
/** Base opacity — subtle marks, not harsh black lines */
const MARK_OPACITY = 0.18;

interface MarkPoint {
	x: number;
	y: number;
	z: number;
	nx: number;
	nz: number;
	birthTime: number;
}

interface Ribbon {
	points: MarkPoint[];
	mesh: THREE.Mesh | null;
	geometry: THREE.BufferGeometry | null;
	material: THREE.MeshBasicMaterial | null;
	active: boolean;
	lastEmitPos: [number, number, number] | null;
}

export class SkidMarks {
	private scene: THREE.Scene;
	private terrain: {
		getHeight(x: number, z: number): number;
		getRoadSurfaceY?(x: number, z: number): number;
	} | null = null;
	private baseMaterial: THREE.MeshBasicMaterial;
	private ribbons: Ribbon[];

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.baseMaterial = new THREE.MeshBasicMaterial({
			color: MARK_COLOR,
			transparent: true,
			opacity: MARK_OPACITY,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});

		this.ribbons = Array.from(
			{ length: 4 },
			(): Ribbon => ({
				points: [],
				mesh: null,
				geometry: null,
				material: null,
				active: false,
				lastEmitPos: null,
			}),
		);
	}

	setTerrain(terrain: {
		getHeight(x: number, z: number): number;
		getRoadSurfaceY?(x: number, z: number): number;
	}): void {
		this.terrain = terrain;
	}

	/**
	 * @param now Current time (seconds)
	 * @param wheelWorldPos 4 wheel world positions
	 * @param wheelSlideIntensity 4 intensities (0-1), marks drawn above 0.08
	 * @param wheelOffRoad 4 booleans — no marks off-road
	 */
	update(
		now: number,
		wheelWorldPos: [number, number, number][],
		wheelSlideIntensity: number[],
		wheelOffRoad: boolean[],
	): void {
		for (let i = 0; i < 4; i++) {
			const ribbon = this.ribbons[i];
			const sliding = wheelSlideIntensity[i] > 0.08 && !wheelOffRoad[i];
			const [wx, wy, wz] = wheelWorldPos[i];

			if (sliding) {
				ribbon.active = true;

				// Skip if too close to last emitted point
				if (ribbon.lastEmitPos) {
					const dx = wx - ribbon.lastEmitPos[0];
					const dz = wz - ribbon.lastEmitPos[2];
					if (Math.sqrt(dx * dx + dz * dz) < MARK_SPACING) continue;
				}

				const surfaceY = this.terrain
					? (this.terrain.getRoadSurfaceY?.(wx, wz) ?? this.terrain.getHeight(wx, wz)) + SURFACE_OFFSET
					: wy;

				let nx = 0;
				let nz = 1;
				const pts = ribbon.points;
				if (pts.length > 0) {
					const last = pts[pts.length - 1];
					const dx = wx - last.x;
					const dz = wz - last.z;
					const dist = Math.sqrt(dx * dx + dz * dz);
					// Large gap = separate slide event, don't connect
					if (dist > GAP_THRESHOLD) {
						nx = 0;
						nz = 1;
					} else if (dist > 0.001) {
						nx = -dz / dist;
						nz = dx / dist;
					}
				}

				pts.push({ x: wx, y: surfaceY, z: wz, nx, nz, birthTime: now });

				while (pts.length > MAX_POINTS) {
					pts.shift();
				}
			} else {
				ribbon.active = false;
				ribbon.lastEmitPos = null;
			}

			// Remove expired
			const fadeStart = now - MARK_FADE_AGE - MARK_FADE_DURATION;
			const points = ribbon.points;
			while (points.length > 0 && points[0].birthTime < fadeStart) {
				points.shift();
			}

			if (points.length >= 2) {
				this.rebuildMesh(i, now);
			} else if (ribbon.mesh) {
				ribbon.mesh.visible = false;
			}
		}
	}

	private rebuildMesh(wheelIdx: number, now: number): void {
		const ribbon = this.ribbons[wheelIdx];
		const points = ribbon.points;
		const vertCount = points.length * 2;

		if (!ribbon.geometry) {
			ribbon.geometry = new THREE.BufferGeometry();
			ribbon.mesh = new THREE.Mesh(ribbon.geometry, this.baseMaterial);
			ribbon.mesh.frustumCulled = false;
			this.scene.add(ribbon.mesh);
		}

		const positions = new Float32Array(vertCount * 3);
		const indices: number[] = [];
		const halfW = MARK_WIDTH / 2;

		for (let j = 0; j < points.length; j++) {
			const p = points[j];
			const j2 = j * 2;
			const j6 = j2 * 3;

			positions[j6] = p.x + p.nx * halfW;
			positions[j6 + 1] = p.y;
			positions[j6 + 2] = p.z + p.nz * halfW;

			positions[j6 + 3] = p.x - p.nx * halfW;
			positions[j6 + 4] = p.y;
			positions[j6 + 5] = p.z - p.nz * halfW;

			// Don't connect quads across gaps (separate slide events)
			if (j < points.length - 1) {
				const next = points[j + 1];
				const dx = next.x - p.x;
				const dz = next.z - p.z;
				if (Math.sqrt(dx * dx + dz * dz) > GAP_THRESHOLD) continue;

				const a = j2;
				const b = j2 + 1;
				const c = j2 + 2;
				const d = j2 + 3;
				indices.push(a, c, b, b, c, d);
			}
		}

		ribbon.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		ribbon.geometry.setIndex(indices);
		ribbon.geometry.computeBoundingSphere();

		// Fade based on oldest mark age
		const oldestAge = now - points[0].birthTime;
		let opacity = MARK_OPACITY;
		if (oldestAge > MARK_FADE_AGE) {
			opacity *= Math.max(0, 1 - (oldestAge - MARK_FADE_AGE) / MARK_FADE_DURATION);
		}

		if (ribbon.material) ribbon.material.dispose();
		ribbon.material = this.baseMaterial.clone();
		ribbon.material.opacity = opacity;
		if (ribbon.mesh) {
			ribbon.mesh.material = ribbon.material;
			ribbon.mesh.visible = true;
		}
	}

	dispose(): void {
		for (const ribbon of this.ribbons) {
			ribbon.mesh?.removeFromParent();
			ribbon.geometry?.dispose();
			ribbon.material?.dispose();
		}
		this.baseMaterial.dispose();
	}
}
