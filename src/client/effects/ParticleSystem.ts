/**
 * ParticleSystem — GPU-accelerated particle pool using custom shaders.
 *
 * Uses THREE.Points with per-particle buffer attributes for position,
 * velocity, life, size, color, and opacity. All animation runs on the GPU
 * via vertex/fragment shaders — the CPU only updates emit buffers.
 *
 * Particles are pooled and recycled via a ring buffer. When a particle
 * dies (life <= 0), its slot becomes available for reuse.
 *
 * Usage:
 *   const ps = new ParticleSystem(scene, { capacity: 500 });
 *   ps.emit(x, y, z, vx, vy, vz, r, g, b, size, lifetime);
 *   ps.update(dt);  // update emit queue, GPU handles animation
 */

import * as THREE from "three";

// ─── Per-particle attributes (must match shader layout) ─────────────────

// ─── Shaders ────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
	attribute vec3 aVelocity;
	attribute vec2 aLife;       // x=current, y=max
	attribute float aSize;
	attribute float aOpacity;
	attribute vec3 aColor;

	varying float vOpacity;
	varying vec3 vColor;

	uniform float uTime;

	void main() {
		vOpacity = aOpacity;
		vColor = aColor;

		// Compute progress: 0 at birth, 1 at death
		float progress = 1.0 - (aLife.x / max(aLife.y, 0.001));

		// Billboard: face camera
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_PointSize = aSize * (300.0 / -mvPosition.z);
		// Shrink to nothing at end of life
		gl_PointSize *= max(0.0, 1.0 - progress * progress);

		gl_Position = projectionMatrix * mvPosition;
	}
`;

const FRAG = /* glsl */ `
	varying float vOpacity;
	varying vec3 vColor;

	void main() {
		// Soft circle disc
		vec2 c = gl_PointCoord - 0.5;
		float dist = length(c);
		if (dist > 0.5) discard;

		// Soft edge falloff
		float alpha = vOpacity * smoothstep(0.5, 0.2, dist);
		gl_FragColor = vec4(vColor, alpha);
	}
`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface ParticleSystemOpts {
	/** Maximum number of live particles */
	capacity: number;
	/** Default particle size (world units) */
	defaultSize?: number;
	/** Blending mode */
	blending?: THREE.Blending;
	/** Depth write */
	depthWrite?: boolean;
}

interface EmitEntry {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	r: number;
	g: number;
	b: number;
	size: number;
	lifetime: number;
}

// ─── Implementation ─────────────────────────────────────────────────────

export class ParticleSystem {
	private geometry: THREE.BufferGeometry;
	private material: THREE.ShaderMaterial;
	private points: THREE.Points;
	private positions: Float32Array;
	private velocities: Float32Array;
	private lives: Float32Array; // [current, max, current, max, ...]
	private sizes: Float32Array;
	private opacities: Float32Array;
	private colors: Float32Array;

	/** Ring buffer head — next slot to write */
	private head = 0;

	/** Emit queue — accumulated during frame, flushed on update() */
	private queue: EmitEntry[] = [];

	readonly capacity: number;

	constructor(scene: THREE.Scene, opts: ParticleSystemOpts) {
		this.capacity = opts.capacity;
		const cap = opts.capacity;

		this.positions = new Float32Array(cap * 3);
		this.velocities = new Float32Array(cap * 3);
		this.lives = new Float32Array(cap * 2); // current, max pairs
		this.sizes = new Float32Array(cap);
		this.opacities = new Float32Array(cap);
		this.colors = new Float32Array(cap * 3);

		// Initialize all particles as dead (life=0)
		this.lives.fill(0);

		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.geometry.setAttribute(
			"aVelocity",
			new THREE.BufferAttribute(this.velocities, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.geometry.setAttribute("aLife", new THREE.BufferAttribute(this.lives, 2).setUsage(THREE.DynamicDrawUsage));
		this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
		this.geometry.setAttribute(
			"aOpacity",
			new THREE.BufferAttribute(this.opacities, 1).setUsage(THREE.DynamicDrawUsage),
		);
		this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));

		this.material = new THREE.ShaderMaterial({
			vertexShader: VERT,
			fragmentShader: FRAG,
			uniforms: { uTime: { value: 0 } },
			transparent: true,
			blending: opts.blending ?? THREE.NormalBlending,
			depthWrite: opts.depthWrite ?? false,
		});

		this.points = new THREE.Points(this.geometry, this.material);
		this.points.frustumCulled = false;
		scene.add(this.points);
	}

	/**
	 * Queue a particle for emission. Thread-safe (call from anywhere).
	 * Particle spawns on next update().
	 */
	emit(
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		r: number,
		g: number,
		b: number,
		size: number,
		lifetime: number,
	): void {
		this.queue.push({ x, y, z, vx, vy, vz, r, g, b, size, lifetime });
	}

	/**
	 * Emit a burst of particles from a single point with random spread.
	 */
	emitBurst(
		x: number,
		y: number,
		z: number,
		count: number,
		spread: number, // random velocity spread magnitude
		r: number,
		g: number,
		b: number,
		size: number,
		lifetime: number,
		vyBias = 0,
	): void {
		for (let i = 0; i < count; i++) {
			const vx = (Math.random() - 0.5) * spread;
			const vy = Math.random() * spread * 0.5 + vyBias;
			const vz = (Math.random() - 0.5) * spread;
			this.emit(
				x,
				y,
				z,
				vx,
				vy,
				vz,
				r,
				g,
				b,
				size * (0.7 + Math.random() * 0.6),
				lifetime * (0.5 + Math.random() * 0.5),
			);
		}
	}

	/**
	 * Process emit queue and advance simulation.
	 * Call once per frame.
	 */
	update(dt: number): void {
		// Flush emit queue into ring buffer
		for (const p of this.queue) {
			const i = this.head;
			const i3 = i * 3;
			const i2 = i * 2;

			this.positions[i3] = p.x;
			this.positions[i3 + 1] = p.y;
			this.positions[i3 + 2] = p.z;

			this.velocities[i3] = p.vx;
			this.velocities[i3 + 1] = p.vy;
			this.velocities[i3 + 2] = p.vz;

			this.lives[i2] = p.lifetime; // current life
			this.lives[i2 + 1] = p.lifetime; // max life

			this.sizes[i] = p.size;
			this.opacities[i] = 1.0;

			this.colors[i3] = p.r;
			this.colors[i3 + 1] = p.g;
			this.colors[i3 + 2] = p.b;

			this.head = (this.head + 1) % this.capacity;
		}
		this.queue.length = 0;

		// Simulate: advance position by velocity*dt, decrement life
		const cap = this.capacity;
		for (let i = 0; i < cap; i++) {
			const i3 = i * 3;
			const i2 = i * 2;
			const life = this.lives[i2];

			if (life <= 0) continue;

			this.positions[i3] += this.velocities[i3] * dt;
			this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
			this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

			// Gravity + drag
			this.velocities[i3 + 1] -= 2.0 * dt; // gentle gravity
			this.velocities[i3] *= 1 - 0.5 * dt; // air drag
			this.velocities[i3 + 1] *= 1 - 0.5 * dt;
			this.velocities[i3 + 2] *= 1 - 0.5 * dt;

			this.lives[i2] -= dt;

			// Fade opacity in last 40% of life
			const maxLife = this.lives[i2 + 1];
			const progress = 1 - this.lives[i2] / maxLife;
			this.opacities[i] = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1.0;
		}

		// Upload to GPU
		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.aVelocity.needsUpdate = true;
		this.geometry.attributes.aLife.needsUpdate = true;
		this.geometry.attributes.aSize.needsUpdate = true;
		this.geometry.attributes.aOpacity.needsUpdate = true;
		this.geometry.attributes.aColor.needsUpdate = true;
	}

	dispose(): void {
		this.geometry.dispose();
		this.material.dispose();
		this.points.removeFromParent();
	}
}
