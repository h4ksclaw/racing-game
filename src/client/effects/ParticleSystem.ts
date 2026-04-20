/**
 * ParticleSystem — GPU particle pool using instanced billboard quads.
 *
 * Why NOT THREE.Points:
 *   gl_PointSize has hardware limits, produces axis-aligned squares,
 *   and looks like PS2 regardless of texture quality. Instanced quads
 *   are the standard approach in modern game engines.
 *
 * Why previous versions looked like circles:
 *   A single flat textured quad is a disc. The eye reads it as flat because
 *   the silhouette is perfectly round. Real smoke has fractal, irregular edges.
 *
 * How this version fixes it:
 *   - Fragment shader distorts UV coords with FBM noise BEFORE sampling the
 *     texture. This warps each particle's shape into organic, non-circular
 *     forms — every particle has a unique silhouette.
 *   - Additional noise-based alpha modulation softens edges further.
 *   - Warm color grading (slight amber tint) instead of pure white.
 *   - Higher-res procedural texture (128x128) with 12 layered blobs.
 *
 * Future improvement (soft depth fade):
 *   Particles currently have hard edges where they intersect geometry.
 *   Adding a depth render target pass would let particles fade when near
 *   surfaces (ground, car body). Requires post-processing pipeline setup.
 *
 * Architecture:
 *   - InstancedMesh with a single PlaneGeometry quad
 *   - Vertex shader: billboard rotation + size/opacity lifecycle
 *   - Fragment shader: FBM noise distortion + color grading
 *   - CPU: emit queue + position/velocity simulation
 *   - Per-instance data via InstancedBufferAttribute
 */

import * as THREE from "three";

// ─── Procedural smoke texture ──────────────────────────────────────────
// 128x128 canvas with 12 layered soft blobs at varied positions.
// This creates a base shape that's already somewhat organic, which the
// shader then further distorts with noise.

function generateSmokeTexture(): THREE.CanvasTexture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;

	const blobs = [
		{ x: 0.5, y: 0.5, r: 0.45, a: 0.55 },
		{ x: 0.42, y: 0.44, r: 0.32, a: 0.4 },
		{ x: 0.58, y: 0.54, r: 0.35, a: 0.35 },
		{ x: 0.46, y: 0.56, r: 0.28, a: 0.3 },
		{ x: 0.55, y: 0.42, r: 0.3, a: 0.28 },
		{ x: 0.5, y: 0.5, r: 0.2, a: 0.35 },
		{ x: 0.38, y: 0.52, r: 0.22, a: 0.2 },
		{ x: 0.62, y: 0.48, r: 0.24, a: 0.22 },
		{ x: 0.48, y: 0.38, r: 0.18, a: 0.18 },
		{ x: 0.52, y: 0.62, r: 0.2, a: 0.15 },
		{ x: 0.43, y: 0.58, r: 0.15, a: 0.2 },
		{ x: 0.57, y: 0.38, r: 0.17, a: 0.18 },
	];

	for (const blob of blobs) {
		const cx = blob.x * size;
		const cy = blob.y * size;
		const cr = blob.r * size;
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
		grad.addColorStop(0, `rgba(255, 255, 255, ${blob.a})`);
		grad.addColorStop(0.3, `rgba(255, 255, 255, ${blob.a * 0.5})`);
		grad.addColorStop(0.6, `rgba(255, 255, 255, ${blob.a * 0.15})`);
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

		// Billboard from camera right + up vectors
		vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
		vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

		float s = instanceSize * sizeScale;
		vec3 worldPos = instancePosition
			+ camRight * position.x * s
			+ camUp * position.y * s;

		gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
	}
`;

/**
 * Fragment shader — the key to making smoke NOT look like circles.
 *
 * Instead of sampling the texture at the raw UV, we warp UVs with FBM noise.
 * This turns each particle's circular silhouette into an organic, irregular
 * cloud shape. Combined with noise-based alpha modulation and warm color
 * grading, the result reads as smoke rather than "game particle".
 */
const FRAG = /* glsl */ `
	uniform sampler2D uSmokeTex;

	varying float vOpacity;
	varying vec3 vColor;
	varying vec2 vUv;

	// Hash for value noise
	float hash(vec2 p) {
		p = fract(p * vec2(123.34, 456.21));
		p += dot(p, p + 45.32);
		return fract(p.x * p.y);
	}

	// Value noise with smoothstep interpolation
	float noise2D(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		f = f * f * (3.0 - 2.0 * f);

		float a = hash(i);
		float b = hash(i + vec2(1.0, 0.0));
		float c = hash(i + vec2(0.0, 1.0));
		float d = hash(i + vec2(1.0, 1.0));

		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}

	// FBM — 3 octaves of value noise
	float fbm(vec2 p) {
		float val = 0.0;
		float amp = 0.5;
		for (int i = 0; i < 3; i++) {
			val += amp * noise2D(p);
			p *= 2.0;
			amp *= 0.5;
		}
		return val;
	}

	void main() {
		vec2 centered = vUv * 2.0 - 1.0; // remap to [-1, 1]

		// ── UV distortion with FBM ──
		// This is THE fix. Instead of sampling texture at the quad's natural
		// UV (which traces a perfect circle), we push UVs around with noise.
		// The result: each particle has a unique, irregular silhouette.
		float distortScale = 2.5;
		vec2 distortedUv = centered + (fbm(centered * distortScale) - 0.5) * 0.6;
		distortedUv = distortedUv * 0.5 + 0.5; // back to [0, 1]

		// Noise can push UVs outside the quad — discard those fragments
		if (distortedUv.x < 0.0 || distortedUv.x > 1.0 ||
			distortedUv.y < 0.0 || distortedUv.y > 1.0) {
			discard;
		}

		vec4 texSample = texture2D(uSmokeTex, distortedUv);
		float alpha = texSample.r * vOpacity;

		// ── Noise-based alpha modulation ──
		// Varies opacity across the particle surface — breaks up the
		// uniform soft-circle look into patchy, cloud-like density.
		float edgeNoise = fbm(centered * 3.0 + 0.5);
		alpha *= 0.7 + edgeNoise * 0.6;

		if (alpha < 0.005) discard;

		// ── Warm color grading ──
		// Real tire smoke is slightly warm/amber, not pure white.
		vec3 graded = vColor;
		graded.r *= 1.05;
		graded.g *= 0.98;
		graded.b *= 0.93;

		gl_FragColor = vec4(graded * alpha, alpha);
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

		const quadGeo = new THREE.PlaneGeometry(1, 1);

		this.positions = new Float32Array(cap * 3);
		this.velocities = new Float32Array(cap * 3);
		this.lives = new Float32Array(cap * 2);
		this.sizes = new Float32Array(cap);
		this.opacities = new Float32Array(cap);
		this.colors = new Float32Array(cap * 3);
		this.lives.fill(0);

		this.smokeTex = generateSmokeTexture();

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

		// Simulate active particles
		const cap = this.capacity;
		for (let i = 0; i < cap; i++) {
			const i3 = i * 3;
			const i2 = i * 2;
			if (this.lives[i2] <= 0) continue;

			this.positions[i3] += this.velocities[i3] * dt;
			this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
			this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

			// Buoyancy + drag (smoke rises and slows)
			this.velocities[i3 + 1] += 0.3 * dt;
			this.velocities[i3] *= 1 - 1.5 * dt;
			this.velocities[i3 + 1] *= 1 - 1.0 * dt;
			this.velocities[i3 + 2] *= 1 - 1.5 * dt;

			// Turbulence — random velocity perturbation for organic drift
			this.velocities[i3] += (Math.random() - 0.5) * 0.4 * dt;
			this.velocities[i3 + 2] += (Math.random() - 0.5) * 0.4 * dt;

			this.lives[i2] -= dt;
		}

		// Upload to GPU
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
