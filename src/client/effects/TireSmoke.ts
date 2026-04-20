/**
 * TireSmoke — white/gray smoke from tire sliding.
 *
 * Modern approach: many small, low-opacity particles with additive blending.
 * Visual density comes from overlapping puffs, not individual particle size.
 * Particles start tiny, grow, then fade — like real smoke dispersal.
 */

import * as THREE from "three";
import { ParticleSystem } from "./ParticleSystem.ts";

// ─── Tuning ─────────────────────────────────────────────────────────────
// Many small particles at low opacity. Density from overlap.

/** Particles emitted per second per wheel at full intensity */
const EMIT_RATE = 60;
/** Random velocity spread (m/s) — tight cloud near tire */
const SPREAD = 0.6;
/** Particle size (world units) — small puffs */
const SIZE_MIN = 0.15;
const SIZE_MAX = 0.35;
/** Particle lifetime (seconds) */
const LIFE_MIN = 1.0;
const LIFE_MAX = 2.5;
/** Per-particle opacity — LOW, density from overlap */
const OPACITY = 0.06;
/** Max pool for all wheels */
const POOL_SIZE = 1200;

export class TireSmoke {
	private ps: ParticleSystem;
	private accum = [0, 0, 0, 0];

	constructor(scene: THREE.Scene) {
		this.ps = new ParticleSystem(scene, {
			capacity: POOL_SIZE,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
	}

	/**
	 * @param dt Frame delta (seconds)
	 * @param wheelWorldPos 4 wheel world positions [x,y,z]
	 * @param wheelSlideIntensity 4 intensities (0-1, how much each wheel is sliding)
	 */
	update(dt: number, wheelWorldPos: [number, number, number][], wheelSlideIntensity: number[]): void {
		for (let i = 0; i < 4; i++) {
			const intensity = wheelSlideIntensity[i];
			if (intensity < 0.05) {
				this.accum[i] = 0;
				continue;
			}

			this.accum[i] += dt;
			const interval = 1 / (EMIT_RATE * intensity);

			while (this.accum[i] >= interval) {
				this.accum[i] -= interval;
				const [wx, wy, wz] = wheelWorldPos[i];

				// Slight warm tint at high intensity (friction heat)
				const gray = 0.9 + Math.random() * 0.1;
				const warmth = intensity * 0.08;

				this.ps.emitBurst(
					wx + (Math.random() - 0.5) * 0.1, // slight positional jitter
					wy + 0.05,
					wz + (Math.random() - 0.5) * 0.1,
					1,
					SPREAD,
					Math.min(1, gray + warmth),
					Math.min(1, gray + warmth * 0.5),
					Math.min(1, gray),
					SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN),
					LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),
					0.3, // gentle upward bias
					OPACITY,
				);
			}
		}

		this.ps.update(dt);
	}

	dispose(): void {
		this.ps.dispose();
	}
}
