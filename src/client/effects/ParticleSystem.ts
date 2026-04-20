/**
 * ParticleSystem — GPU particle pool using instanced billboard quads.
 *
 * Why NOT THREE.Points:
 *   gl_PointSize has hardware limits, produces axis-aligned squares,
 *   and looks like PS2 regardless of texture quality. Instanced quads
 *   are the standard approach in modern game engines.
 *
 * How it works:
 *   - InstancedMesh with a single PlaneGeometry quad
 *   - Each instance is a billboard: vertex shader rotates quad to face camera
 *   - Per-instance data via InstancedBufferAttribute
 *   - Procedural smoke texture on a 64x64 canvas (no external assets)
 *   - Additive blending for smoke (NormalBlending available for opaque particles)
 *
 * Particles grow → hold → shrink, with configurable per-particle opacity.
 * CPU updates emit queue + position/velocity simulation, GPU handles
 * billboard orientation and size/opacity animation.
 */

import * as THREE from "three";

// ─── Procedural smoke texture ──────────────────────────────────────────
// Soft, organic puff shape — layered offset radial gradients avoid
// the "perfect circle" look that screams "game engine particle".

function generateSmokeTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, size, size);

	// Layer soft blobs at slightly offset centers
	const blobs = [
		{ x: 0.5, y: 0.5, r: 0.42, a: 0.7 },
		{ x: 0.44, y: 0.47, r: 0.3, a: 0.45 },
		{ x: 0.56, y: 0.53, r: 0.35, a: 0.4 },
		{ x: 0.48, y: 0.43, r: 0.25, a: 0.35 },
		{ x: 0.53, y: 0.56, r: 0.28, a: 0.3 },
		{ x: 0.51, y: 0.49, r: 0.18, a: 0.4 },
	];

	for (const blob of blobs) {
		const cx = blob.x * size;
		const cy = blob.y * size;
		const cr = blob.r * size;
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
		grad.addColorStop(0, `rgba(255, 255, 255, ${blob.a})`);
		grad.addColorStop(0.35, `rgba(255, 255, 255, ${blob.a * 0.5})`);
		grad.addColorStop(0.65, `rgba(255, 255, 255, ${blob.a * 0.12})`);
		grad.addColorStop(1, "rgba(255, 255, 255, 0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, size, size);
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

// ─── Shaders ────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
	// Per-instance attributes
	attribute vec3 instancePosition;
	attribute vec3 instanceVelocity;
	attribute vec2 instanceLife;    // x=current, y=max
	attribute float instanceSize;
	attribute float instanceOpacity;
	attribute vec3 instanceColor;

	varying float vOpacity;
	varying vec3 vColor;
	varying vec2 vUv;

	void main() {
		vUv = uv;
		vColor = instanceColor;

		float maxLife = max(instanceLife.y, 0.001);
		float progress = 1.0 - (instanceLife.x / maxLife);

		// Size lifecycle: grow 0→35%, hold 35→65%, shrink 65→100%
		float sizeScale = 1.0;
		if (progress < 0.35) {
			sizeScale = progress / 0.35;
		} else if (progress > 0.65) {
			sizeScale = 1.0 - (progress - 0.65) / 0.35;
		}
		sizeScale = clamp(sizeScale, 0.0, 1.0);

		// Opacity: full 0→40%, linear fade 40→100%
		float alphaFade = progress > 0.4 ? 1.0 - (progress - 0.4) / 0.6 : 1.0;
		vOpacity = instanceOpacity * alphaFade;

		// Billboard: build rotation matrix from camera right + up
		vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
		vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

		float s = instanceSize * sizeScale;
		vec3 worldPos = instancePosition
			+ camRight * position.x * s
			+ camUp * position.y * s;

		gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
	}
`;

const FRAG = /* glsl */ `
	uniform sampler2D uSmokeTex;

	varying float vOpacity;
	varying vec3 vColor;
	varying vec2 vUv;

	void main() {
		vec4 texSample = texture2D(uSmokeTex, vUv);
		float alpha = texSample.r * vOpacity;

		if (alpha < 0.005) discard;

		// For additive: output premultiplied color
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
	private instancedMesh: THREE.InstancedMesh;
	private material: THREE.ShaderMaterial;

	// CPU-side buffers (mirrors GPU instanced attributes)
	private positions: Float32Array;
	private velocities: Float32Array;
	private lives: Float32Array;
	private sizes: Float32Array;
	private opacities: Float32Array;
	private colors: Float32Array;

	private head = 0;
	private queue: EmitEntry[] = [];
	private smokeTex: THREE.CanvasTexture;

	readonly capacity: number;

	constructor(scene: THREE.Scene, opts: ParticleSystemOpts) {
		this.capacity = opts.capacity;
		const cap = opts.capacity;

		// Single quad geometry — the billboard base
		const quadGeo = new THREE.PlaneGeometry(1, 1);

		this.positions = new Float32Array(cap * 3);
		this.velocities = new Float32Array(cap * 3);
		this.lives = new Float32Array(cap * 2);
		this.sizes = new Float32Array(cap);
		this.opacities = new Float32Array(cap);
		this.colors = new Float32Array(cap * 3);
		this.lives.fill(0);

		this.smokeTex = generateSmokeTexture();

		// Attach instanced attributes
		quadGeo.setAttribute(
			"instancePosition",
			new THREE.InstancedBufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
		);
		quadGeo.setAttribute(
			"instanceVelocity",
			new THREE.InstancedBufferAttribute(this.velocities, 3).setUsage(THREE.DynamicDrawUsage),
		);
		quadGeo.setAttribute(
			"instanceLife",
			new THREE.InstancedBufferAttribute(this.lives, 2).setUsage(THREE.DynamicDrawUsage),
		);
		quadGeo.setAttribute(
			"instanceSize",
			new THREE.InstancedBufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
		);
		quadGeo.setAttribute(
			"instanceOpacity",
			new THREE.InstancedBufferAttribute(this.opacities, 1).setUsage(THREE.DynamicDrawUsage),
		);
		quadGeo.setAttribute(
			"instanceColor",
			new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage),
		);

		this.material = new THREE.ShaderMaterial({
			vertexShader: VERT,
			fragmentShader: FRAG,
			uniforms: {
				uSmokeTex: { value: this.smokeTex },
			},
			transparent: true,
			blending: opts.blending ?? THREE.AdditiveBlending,
			depthWrite: opts.depthWrite ?? false,
			side: THREE.DoubleSide,
		});

		this.instancedMesh = new THREE.InstancedMesh(quadGeo, this.material, cap);
		this.instancedMesh.frustumCulled = false;
		// Hide all instances initially (count=0 means nothing drawn,
		// but we need instancedMesh for attribute upload)
		this.instancedMesh.count = cap;
		scene.add(this.instancedMesh);
	}

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

			// Smoke: buoyancy + drag
			this.velocities[i3 + 1] += 0.3 * dt;
			this.velocities[i3] *= 1 - 1.5 * dt;
			this.velocities[i3 + 1] *= 1 - 1.0 * dt;
			this.velocities[i3 + 2] *= 1 - 1.5 * dt;

			// Turbulence
			this.velocities[i3] += (Math.random() - 0.5) * 0.4 * dt;
			this.velocities[i3 + 2] += (Math.random() - 0.5) * 0.4 * dt;

			this.lives[i2] -= dt;
		}

		// Upload instanced attributes
		const geo = this.instancedMesh.geometry;
		for (const attr of Object.values(geo.attributes)) {
			attr.needsUpdate = true;
		}
	}

	dispose(): void {
		this.instancedMesh.geometry.dispose();
		this.material.dispose();
		this.smokeTex.dispose();
		this.instancedMesh.removeFromParent();
	}
}
