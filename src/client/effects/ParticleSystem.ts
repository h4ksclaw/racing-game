/**
 * ParticleSystem — GPU particle pool with procedural smoke texture.
 *
 * Key design decisions for modern look:
 * - Procedural smoke puff texture generated at startup (no external assets)
 * - Additive blending: overlapping puffs create natural density buildup
 * - Particles start small, GROW to full size, then shrink only at very end
 * - Very low per-particle opacity (0.05-0.15), visual density from overlap
 * - No hard circle edges: gaussian-like falloff from center
 * - Size in world units, perspective-correct (not gl_PointSize scaling)
 */

import * as THREE from "three";

// ─── Procedural smoke texture ──────────────────────────────────────────
// Generates a soft, turbulent smoke puff on a 64x64 canvas.
// Uses layered noise blobs to avoid the "perfect circle" look.

function generateSmokeTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;

	// Dark background (transparent)
	ctx.clearRect(0, 0, size, size);

	// Layer multiple soft radial gradients at slightly offset positions
	// to create an organic, non-circular shape
	const blobs = [
		{ x: 0.5, y: 0.5, r: 0.4, a: 0.6 },
		{ x: 0.45, y: 0.48, r: 0.3, a: 0.4 },
		{ x: 0.55, y: 0.52, r: 0.35, a: 0.35 },
		{ x: 0.5, y: 0.45, r: 0.25, a: 0.3 },
		{ x: 0.48, y: 0.55, r: 0.28, a: 0.25 },
		{ x: 0.52, y: 0.5, r: 0.2, a: 0.3 },
	];

	for (const blob of blobs) {
		const cx = blob.x * size;
		const cy = blob.y * size;
		const cr = blob.r * size;
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
		grad.addColorStop(0, `rgba(255, 255, 255, ${blob.a})`);
		grad.addColorStop(0.4, `rgba(255, 255, 255, ${blob.a * 0.5})`);
		grad.addColorStop(0.7, `rgba(255, 255, 255, ${blob.a * 0.15})`);
		grad.addColorStop(1, "rgba(255, 255, 255, 0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, size, size);
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

// ─── Shaders ────────────────────────────────────────────────────────────
// Vertex: billboards particles to face camera, scales size in world space.
// Fragment: samples smoke texture with per-particle opacity, soft edges.

const VERT = /* glsl */ `
	attribute vec3 aVelocity;
	attribute vec2 aLife;       // x=current, y=max
	attribute float aSize;
	attribute float aOpacity;
	attribute vec3 aColor;

	varying float vOpacity;
	varying vec3 vColor;

	void main() {
		float maxLife = max(aLife.y, 0.001);
		float progress = 1.0 - (aLife.x / maxLife);

		// Grow from 0% to 40% of life, full size 40-70%, shrink 70-100%
		float sizeScale = 1.0;
		if (progress < 0.4) {
			sizeScale = progress / 0.4;           // grow phase
		} else if (progress > 0.7) {
			sizeScale = 1.0 - (progress - 0.7) / 0.3;  // shrink phase
		}
		sizeScale = clamp(sizeScale, 0.0, 1.0);

		// Fade: full 0-50%, fade out 50-100%
		float alphaFade = progress > 0.5 ? 1.0 - (progress - 0.5) / 0.5 : 1.0;
		vOpacity = aOpacity * alphaFade;
		vColor = aColor;

		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

		// World-space size in screen pixels
		// 1 world unit at distance d = screen_height / (2 * tan(fov/2)) * (1/d)
		// Simplified: perspective-correct billboard sizing
		gl_PointSize = aSize * sizeScale * (600.0 / -mvPosition.z);
		gl_PointSize = clamp(gl_PointSize, 1.0, 128.0);

		gl_Position = projectionMatrix * mvPosition;
	}
`;

const FRAG = /* glsl */ `
	varying float vOpacity;
	varying vec3 vColor;

	uniform sampler2D uSmokeTex;

	void main() {
		// Sample procedural smoke texture
		vec4 texSample = texture2D(uSmokeTex, gl_PointCoord);
		float alpha = texSample.r * vOpacity;

		// Discard nearly invisible fragments
		if (alpha < 0.01) discard;

		gl_FragColor = vec4(vColor * alpha, alpha);
	}
`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface ParticleSystemOpts {
	capacity: number;
	blending?: THREE.Blending;
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
	opacity: number;
}

// ─── Implementation ─────────────────────────────────────────────────────

export class ParticleSystem {
	private geometry: THREE.BufferGeometry;
	private material: THREE.ShaderMaterial;
	private points: THREE.Points;
	private positions: Float32Array;
	private velocities: Float32Array;
	private lives: Float32Array;
	private sizes: Float32Array;
	private opacities: Float32Array;
	private colors: Float32Array;

	private head = 0;
	private queue: EmitEntry[] = [];

	readonly capacity: number;

	constructor(scene: THREE.Scene, opts: ParticleSystemOpts) {
		this.capacity = opts.capacity;
		const cap = opts.capacity;

		this.positions = new Float32Array(cap * 3);
		this.velocities = new Float32Array(cap * 3);
		this.lives = new Float32Array(cap * 2);
		this.sizes = new Float32Array(cap);
		this.opacities = new Float32Array(cap);
		this.colors = new Float32Array(cap * 3);
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

		const smokeTex = generateSmokeTexture();

		this.material = new THREE.ShaderMaterial({
			vertexShader: VERT,
			fragmentShader: FRAG,
			uniforms: {
				uTime: { value: 0 },
				uSmokeTex: { value: smokeTex },
			},
			transparent: true,
			blending: opts.blending ?? THREE.AdditiveBlending,
			depthWrite: opts.depthWrite ?? false,
		});

		this.points = new THREE.Points(this.geometry, this.material);
		this.points.frustumCulled = false;
		scene.add(this.points);
	}

	/**
	 * Queue a particle for emission.
	 * @param opacity Per-particle opacity (0.05-0.15 for smoke, builds up with overlap)
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
		opacity = 0.1,
	): void {
		this.queue.push({ x, y, z, vx, vy, vz, r, g, b, size, lifetime, opacity });
	}

	/**
	 * Emit a burst with random velocity spread.
	 */
	emitBurst(
		x: number,
		y: number,
		z: number,
		count: number,
		spread: number,
		r: number,
		g: number,
		b: number,
		size: number,
		lifetime: number,
		vyBias = 0,
		opacity = 0.1,
	): void {
		for (let i = 0; i < count; i++) {
			const vx = (Math.random() - 0.5) * spread;
			const vy = Math.random() * spread * 0.3 + vyBias;
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
				size * (0.6 + Math.random() * 0.8),
				lifetime * (0.6 + Math.random() * 0.8),
				opacity * (0.7 + Math.random() * 0.6),
			);
		}
	}

	update(dt: number): void {
		// Flush emit queue
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

			this.lives[i2] = p.lifetime;
			this.lives[i2 + 1] = p.lifetime;

			this.sizes[i] = p.size;
			this.opacities[i] = p.opacity;

			this.colors[i3] = p.r;
			this.colors[i3 + 1] = p.g;
			this.colors[i3 + 2] = p.b;

			this.head = (this.head + 1) % this.capacity;
		}
		this.queue.length = 0;

		// Simulate
		const cap = this.capacity;
		for (let i = 0; i < cap; i++) {
			const i3 = i * 3;
			const i2 = i * 2;
			if (this.lives[i2] <= 0) continue;

			this.positions[i3] += this.velocities[i3] * dt;
			this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
			this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

			// Buoyancy + air drag (smoke rises slowly)
			this.velocities[i3 + 1] += 0.3 * dt;
			this.velocities[i3] *= 1 - 1.5 * dt;
			this.velocities[i3 + 1] *= 1 - 1.0 * dt;
			this.velocities[i3 + 2] *= 1 - 1.5 * dt;

			// Turbulence: small random velocity perturbation
			this.velocities[i3] += (Math.random() - 0.5) * 0.4 * dt;
			this.velocities[i3 + 2] += (Math.random() - 0.5) * 0.4 * dt;

			this.lives[i2] -= dt;
		}

		// Upload
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
