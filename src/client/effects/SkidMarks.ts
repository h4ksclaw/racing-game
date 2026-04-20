/**
 * SkidMarks — procedural tire marks painted on the road surface.
 *
 * Records wheel positions over time when tires are sliding and builds
 * a mesh of thin quads (ribbon strips) that sit slightly above the surface.
 * Each strip has a lifetime — marks fade by scaling opacity toward zero,
 * then the strip is recycled.
 *
 * The marks are purely visual — no physics interaction.
 * They "paint" on the surface by snapping Y to terrain height.
 */

import * as THREE from "three";

// ─── Tuning ─────────────────────────────────────────────────────────────

/** Distance between consecutive mark points (meters) */
const MARK_SPACING = 0.15;
/** Mark width (meters) — matches tire contact patch */
const MARK_WIDTH = 0.18;
/** Maximum points per wheel ribbon before oldest are trimmed */
const MAX_POINTS = 2000;
/** Maximum mark age (seconds) before fading starts */
const MARK_FADE_AGE = 8.0;
/** Seconds to fully fade out */
const MARK_FADE_DURATION = 4.0;
/** How far above surface to offset (prevents z-fighting) */
const SURFACE_OFFSET = 0.005;
/** Dark asphalt color with low opacity */
const MARK_COLOR = new THREE.Color(0.05, 0.05, 0.05);

interface MarkPoint {
	x: number;
	y: number;
	z: number;
	/** Direction perpendicular to movement (for ribbon width) */
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
	private terrain: { getHeight(x: number, z: number): number } | null = null;
	private baseMaterial: THREE.MeshBasicMaterial;

	private ribbons: Ribbon[];

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.baseMaterial = new THREE.MeshBasicMaterial({
			color: MARK_COLOR,
			transparent: true,
			opacity: 0.7,
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

	setTerrain(terrain: { getHeight(x: number, z: number): number }): void {
		this.terrain = terrain;
	}

	/**
	 * Update skid marks. Call once per frame.
	 *
	 * @param now Current time (seconds)
	 * @param wheelWorldPos 4 wheel world positions
	 * @param wheelSlideIntensity 4 intensities (0-1)
	 * @param wheelOffRoad 4 booleans — don't draw marks off-road
	 */
	update(
		now: number,
		wheelWorldPos: [number, number, number][],
		wheelSlideIntensity: number[],
		wheelOffRoad: boolean[],
	): void {
		for (let i = 0; i < 4; i++) {
			const ribbon = this.ribbons[i];
			const sliding = wheelSlideIntensity[i] > 0.1 && !wheelOffRoad[i];
			const [wx, wy, wz] = wheelWorldPos[i];

			if (sliding) {
				ribbon.active = true;

				// Check if we've moved enough to add a new point
				if (ribbon.lastEmitPos) {
					const dx = wx - ribbon.lastEmitPos[0];
					const dz = wz - ribbon.lastEmitPos[2];
					const dist = Math.sqrt(dx * dx + dz * dz);
					if (dist < MARK_SPACING) continue;
				}

				// Snap to terrain surface
				const surfaceY = this.terrain ? this.terrain.getHeight(wx, wz) + SURFACE_OFFSET : wy;

				// Compute perpendicular direction from last point
				let nx = 0;
				let nz = 1;
				const pts = ribbon.points;
				if (pts.length > 0) {
					const last = pts[pts.length - 1];
					const dx = wx - last.x;
					const dz = wz - last.z;
					const len = Math.sqrt(dx * dx + dz * dz);
					if (len > 0.001) {
						nx = -dz / len;
						nz = dx / len;
					}
				}

				pts.push({ x: wx, y: surfaceY, z: wz, nx, nz, birthTime: now });
				ribbon.lastEmitPos = [wx, wy, wz];

				// Trim old points
				while (pts.length > MAX_POINTS) {
					pts.shift();
				}
			} else {
				ribbon.active = false;
				ribbon.lastEmitPos = null;
			}

			// Remove expired points
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

			if (j < points.length - 1) {
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

		// Compute overall opacity based on oldest visible mark
		const oldestAge = now - points[0].birthTime;
		let opacity = 0.7;
		if (oldestAge > MARK_FADE_AGE) {
			opacity *= Math.max(0, 1 - (oldestAge - MARK_FADE_AGE) / MARK_FADE_DURATION);
		}

		// Dispose old per-ribbon material
		if (ribbon.material) {
			ribbon.material.dispose();
			ribbon.material = null;
		}
		ribbon.material = this.baseMaterial.clone();
		ribbon.material.opacity = opacity;
		if (ribbon.mesh) {
			ribbon.mesh.material = ribbon.material;
			ribbon.mesh.visible = true;
		}
	}

	dispose(): void {
		for (const ribbon of this.ribbons) {
			if (ribbon.mesh) {
				ribbon.mesh.removeFromParent();
			}
			ribbon.geometry?.dispose();
			ribbon.material?.dispose();
		}
		this.baseMaterial.dispose();
	}
}
