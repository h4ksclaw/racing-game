/**
 * DirtThrow — brown/green dirt particles thrown from wheels on off-road surfaces.
 *
 * Emits from wheels that are outside the road boundary. Colors mix
 * brown (dirt) and dark green (grass) randomly. Particles are slightly
 * heavier than tire smoke — they arc and fall faster, creating a
 * "kicking up dirt" effect.
 */

import * as THREE from "three";
import { ParticleSystem } from "./ParticleSystem.ts";

// ─── Tuning ─────────────────────────────────────────────────────────────

const EMIT_RATE = 20;
const SPREAD = 2.0;
const SIZE_MIN = 0.15;
const SIZE_MAX = 0.35;
const LIFE_MIN = 0.5;
const LIFE_MAX = 1.0;
const POOL_SIZE = 400;

// Color palette: dirt brown, dark soil, grass green
const DIRT_COLORS = [
	[0.45, 0.3, 0.15], // light brown
	[0.35, 0.22, 0.1], // dark brown
	[0.5, 0.35, 0.18], // sandy
	[0.2, 0.3, 0.12], // grass green
	[0.3, 0.25, 0.15], // soil
];

export class DirtThrow {
	private ps: ParticleSystem;
	private accum = [0, 0, 0, 0];

	constructor(scene: THREE.Scene) {
		this.ps = new ParticleSystem(scene, {
			capacity: POOL_SIZE,
			blending: THREE.NormalBlending,
			depthWrite: false,
		});
	}

	/**
	 * Update dirt particles. Call once per frame.
	 *
	 * @param dt Frame delta
	 * @param wheelWorldPos 4 wheel world positions
	 * @param wheelOffRoad 4 booleans — true if that wheel is off-road
	 * @param speed Factor: 0-1 based on car speed (faster = more dirt)
	 */
	update(dt: number, wheelWorldPos: [number, number, number][], wheelOffRoad: boolean[], speed: number): void {
		const speedFactor = Math.min(1, speed / 15); // normalize around 15 m/s

		for (let i = 0; i < 4; i++) {
			if (!wheelOffRoad[i] || speedFactor < 0.1) {
				this.accum[i] = 0;
				continue;
			}

			const intensity = speedFactor;
			this.accum[i] += dt;
			const interval = 1 / (EMIT_RATE * intensity);

			while (this.accum[i] >= interval) {
				this.accum[i] -= interval;
				const [wx, wy, wz] = wheelWorldPos[i];
				const [r, g, b] = DIRT_COLORS[Math.floor(Math.random() * DIRT_COLORS.length)];
				// Add slight color variation
				const rv = r + (Math.random() - 0.5) * 0.08;
				const gv = g + (Math.random() - 0.5) * 0.06;
				const bv = b + (Math.random() - 0.5) * 0.04;
				const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
				const life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
				this.ps.emitBurst(
					wx,
					wy + 0.02,
					wz,
					1,
					SPREAD * intensity,
					Math.max(0, Math.min(1, rv)),
					Math.max(0, Math.min(1, gv)),
					Math.max(0, Math.min(1, bv)),
					size,
					life,
					1.0, // stronger upward bias — dirt flies up
				);
			}
		}

		this.ps.update(dt);
	}

	dispose(): void {
		this.ps.dispose();
	}
}
