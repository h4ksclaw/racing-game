/**
 * DirtThrow — brown/green dirt particles from off-road wheels.
 *
 * Dirt is opaque material, not translucent smoke — uses NormalBlending.
 * Particles are small, dense, and arc downward (gravity-heavy).
 * Color varies between brown soil, sandy, and grass green.
 */

import * as THREE from "three";
import { ParticleSystem } from "./ParticleSystem.ts";

// ─── Tuning ─────────────────────────────────────────────────────────────

const EMIT_RATE = 40;
const SPREAD = 1.2;
const SIZE_MIN = 0.08;
const SIZE_MAX = 0.2;
const LIFE_MIN = 0.4;
const LIFE_MAX = 0.8;
const OPACITY = 0.7;
const POOL_SIZE = 600;

// Color palette: soil, sand, grass
const DIRT_COLORS = [
	[0.45, 0.3, 0.15], // light brown
	[0.35, 0.22, 0.1], // dark brown
	[0.5, 0.38, 0.2], // sandy
	[0.25, 0.32, 0.12], // grass green
	[0.3, 0.25, 0.15], // soil mix
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

	update(dt: number, wheelWorldPos: [number, number, number][], wheelOffRoad: boolean[], speed: number): void {
		const speedFactor = Math.min(1, speed / 15);

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

				// Small color jitter
				const rv = Math.max(0, Math.min(1, r + (Math.random() - 0.5) * 0.06));
				const gv = Math.max(0, Math.min(1, g + (Math.random() - 0.5) * 0.04));
				const bv = Math.max(0, Math.min(1, b + (Math.random() - 0.5) * 0.03));

				this.ps.emitBurst(
					wx + (Math.random() - 0.5) * 0.08,
					wy + 0.02,
					wz + (Math.random() - 0.5) * 0.08,
					1,
					SPREAD * intensity,
					rv,
					gv,
					bv,
					SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN),
					LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),
					1.5, // strong upward bias — dirt flies up then falls
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
