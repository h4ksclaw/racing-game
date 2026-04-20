/**
 * TireSmoke — white/gray smoke particles from tire skidding.
 *
 * Triggered when tires slide sideways (handbrake, hard cornering).
 * Emits from each wheel that's actively sliding. The smoke is white
 * with slight gray variation, small particles that rise slowly and fade.
 *
 * For future burnout support: expose emit intensity per wheel so
 * burnout (stationary wheels with throttle) can trigger thicker smoke.
 */

import * as THREE from "three";
import { ParticleSystem } from "./ParticleSystem.ts";

// ─── Tuning ─────────────────────────────────────────────────────────────

/** Particles emitted per second per wheel at full drift intensity */
const EMIT_RATE = 30;
/** Random velocity spread (m/s) */
const SPREAD = 1.5;
/** Particle size range (world units) */
const SIZE_MIN = 0.3;
const SIZE_MAX = 0.6;
/** Particle lifetime range (seconds) */
const LIFE_MIN = 0.8;
const LIFE_MAX = 1.5;
/** Max pool size for all wheels combined */
const POOL_SIZE = 600;

export class TireSmoke {
	private ps: ParticleSystem;
	/** Accumulated emit time per wheel (4 wheels) */
	private accum = [0, 0, 0, 0];

	constructor(scene: THREE.Scene) {
		this.ps = new ParticleSystem(scene, {
			capacity: POOL_SIZE,
			blending: THREE.NormalBlending,
			depthWrite: false,
		});
	}

	/**
	 * Update tire smoke. Call once per frame.
	 *
	 * @param dt Frame delta (seconds)
	 * @param wheelWorldPos Array of 4 wheel world positions [x,y,z]
	 * @param wheelSlideIntensity Array of 4 intensities (0-1, how much each wheel is sliding)
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
				// Slight gray variation for realism
				const gray = 0.85 + Math.random() * 0.15;
				const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
				const life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
				this.ps.emitBurst(
					wx,
					wy + 0.05,
					wz, // slightly above ground
					1, // 1 particle per emission
					SPREAD * intensity, // more spread at higher intensity
					gray,
					gray,
					gray,
					size,
					life,
					0.5, // slight upward bias
				);
			}
		}

		this.ps.update(dt);
	}

	dispose(): void {
		this.ps.dispose();
	}
}
