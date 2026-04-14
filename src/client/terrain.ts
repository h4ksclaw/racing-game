import type { TrackSample } from "@shared/track.ts";
import { mulberry32 } from "@shared/track.ts";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import type { BiomeConfig } from "./biomes.ts";
import { state } from "./scene.ts";
import type { TrackResponse } from "./utils.ts";
import { smoothstep } from "./utils.ts";

// ── Texture loading helpers ─────────────────────────────────────────────

function loadTex(path: string): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		new THREE.TextureLoader().load(
			path,
			(tex) => {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
				tex.colorSpace = THREE.SRGBColorSpace;
				resolve(tex);
			},
			undefined,
			reject,
		);
	});
}

function loadNormalTex(path: string): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		new THREE.TextureLoader().load(
			path,
			(tex) => {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
				// Normal maps stay in linear space
				resolve(tex);
			},
			undefined,
			reject,
		);
	});
}

// ── TerrainSampler ──────────────────────────────────────────────────────

export class TerrainSampler {
	private noise2D: (x: number, z: number) => number;
	private grid: Map<string, TrackSample[]>;
	private samples: TrackSample[];
	avgRoadY: number;
	private readonly cellSize = 10;
	private readonly noiseScale = 0.003;
	private noiseAmp: number;
	private mountainAmp: number;
	private worldRadius: number;
	private heightCache = new Map<string, number>();
	private readonly roadInfluence = 50;
	private readonly blendStart = 20;

	constructor(
		seed: number,
		samples: TrackSample[],
		opts: { noiseAmp?: number; mountainAmp?: number; worldRadius?: number } = {},
	) {
		const rng = mulberry32(seed + 99999);
		this.noise2D = createNoise2D(rng);
		this.samples = samples;
		this.noiseAmp = opts.noiseAmp ?? 60;
		this.mountainAmp = opts.mountainAmp ?? 3;
		this.worldRadius = opts.worldRadius ?? 800;

		let sumY = 0;
		for (const s of samples) sumY += s.point.y;
		this.avgRoadY = sumY / samples.length;
		this.grid = new Map();
		for (const s of samples) {
			const cx = Math.floor(s.point.x / this.cellSize);
			const cz = Math.floor(s.point.z / this.cellSize);
			const key = `${cx},${cz}`;
			let arr = this.grid.get(key);
			if (!arr) {
				arr = [];
				this.grid.set(key, arr);
			}
			arr.push(s);
		}
	}

	private fbm(x: number, z: number): number {
		let value = 0;
		let amplitude = 1;
		let frequency = 1;
		let maxVal = 0;
		for (let i = 0; i < 6; i++) {
			value += amplitude * this.noise2D(x * frequency, z * frequency);
			maxVal += amplitude;
			amplitude *= 0.5;
			frequency *= 2.03;
		}
		return value / maxVal;
	}

	nearestRoad(x: number, z: number): { dist: number; sample: TrackSample } {
		const cx = Math.floor(x / this.cellSize);
		const cz = Math.floor(z / this.cellSize);
		let best = { dist: Infinity, sample: this.samples[0] };
		for (let dx = -2; dx <= 2; dx++) {
			for (let dz = -2; dz <= 2; dz++) {
				const arr = this.grid.get(`${cx + dx},${cz + dz}`);
				if (!arr) continue;
				for (const s of arr) {
					const ddx = x - s.point.x;
					const ddz = z - s.point.z;
					const d = Math.sqrt(ddx * ddx + ddz * ddz);
					if (d < best.dist) best = { dist: d, sample: s };
				}
			}
		}
		return best;
	}

	getHeight(x: number, z: number): number {
		// Quantize to 1m grid for caching
		const qx = Math.round(x);
		const qz = Math.round(z);
		const cacheKey = `${qx},${qz}`;
		const cached = this.heightCache.get(cacheKey);
		if (cached !== undefined) return cached;

		const { dist, sample } = this.nearestRoad(x, z);
		const centerDist = Math.sqrt(x * x + z * z);
		const mountainFactor =
			1 + smoothstep(this.worldRadius * 0.75, this.worldRadius, centerDist) * this.mountainAmp;
		const noiseH =
			this.fbm(x * this.noiseScale, z * this.noiseScale) * this.noiseAmp * mountainFactor;
		const blend = smoothstep(this.blendStart, this.roadInfluence, dist);
		const blendedY = sample.point.y * (1 - blend) + (this.avgRoadY + noiseH) * blend;
		// Clamp height difference to prevent cliffs: max 0.4m rise per 1m from road
		const maxSlope = dist * 0.4;
		const result =
			Math.max(sample.point.y - maxSlope, Math.min(sample.point.y + maxSlope, blendedY)) - 0.3;
		this.heightCache.set(cacheKey, result);
		return result;
	}
}

// ── Terrain textures ────────────────────────────────────────────────────

const TERRAIN_TEX_REPEAT = 400; // 4m per texture tile (1600/400)
let terrainTextures: Record<string, THREE.Texture> | null = null;
let loadedBiome: string | null = null;

async function loadTerrainTextures(biome: {
	textures: { grass: string; dirt: string; rock: string; snow: string; moss: string };
	name: string;
}): Promise<Record<string, THREE.Texture>> {
	// Reload if biome changed
	if (terrainTextures && loadedBiome === biome.name) return terrainTextures;
	const tex = biome.textures;
	const [grassC, dirtC, rockC, rockN, snowC, snowN, mossC] = await Promise.all([
		loadTex(`${tex.grass}_Color.jpg`),
		loadTex(`${tex.dirt}_Color.jpg`),
		loadTex(`${tex.rock}_Color.jpg`),
		loadNormalTex(`${tex.rock}_NormalGL.jpg`),
		loadTex(`${tex.snow}_Color.jpg`),
		loadNormalTex(`${tex.snow}_NormalGL.jpg`),
		loadTex(`${tex.moss}_Color.jpg`),
	]);
	terrainTextures = { grassC, dirtC, rockC, rockN, snowC, snowN, mossC };
	loadedBiome = biome.name;
	return terrainTextures;
}

// ── Shaders ─────────────────────────────────────────────────────────────

const terrainVertexShader = /* glsl */ `
attribute vec3 aBlend0;
attribute vec3 aBlend1;
uniform float uTexRepeat;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBlend0;
varying vec3 vBlend1;

void main() {
	vUv = uv * uTexRepeat;
	vBlend0 = aBlend0;
	vBlend1 = aBlend1;
	vNormal = normalize(normalMatrix * normal);
	vec4 worldPos = modelMatrix * vec4(position, 1.0);
	vWorldPos = worldPos.xyz;
	gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const terrainFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tGrassC;
uniform sampler2D tDirtC;
uniform sampler2D tRockC;
uniform sampler2D tRockN;
uniform sampler2D tSnowC;
uniform sampler2D tSnowN;
uniform sampler2D tMossC;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uFogColor;
uniform float uTexRepeat;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uGrassTint;
uniform vec3 uDirtTint;
uniform vec3 uRockTint;
uniform float uSnowThreshold;
uniform float uRockThreshold;
uniform vec3 uSnowTint; // brightness boost for snow
uniform int uStreetLightCount;
uniform vec3 uStreetLightPos[4];
uniform vec3 uStreetLightColor[4];
uniform float uStreetLightIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBlend0;
varying vec3 vBlend1;

// Stochastic tiling: rotates each texture tile by a random angle
// based on tile position. Completely breaks the grid pattern.
vec2 stochasticUV(vec2 uv, float scale) {
	vec2 tileId = floor(uv * scale);
	vec2 tileUv = fract(uv * scale);
	float h = fract(sin(dot(tileId, vec2(127.1, 311.7))) * 43758.5453);
	float angle = h * 6.28318;
	vec2 centered = tileUv - 0.5;
	float c = cos(angle); float s = sin(angle);
	vec2 rotated = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y) + 0.5;
	return rotated;
}

void main() {
	float aboveRoad = vBlend0.x;
	float slope = vBlend0.y;
	float dist = vBlend0.z;
	float noise1 = vBlend1.x;
	float noise2 = vBlend1.y;
	float nearRoad = vBlend1.z;

	float wRock = smoothstep(uRockThreshold, uRockThreshold + 0.15, slope);
	float wSnowRaw = smoothstep(uSnowThreshold, uSnowThreshold + 15.0, aboveRoad);
	// Break up snow with noise — rock pokes through in patches
	float snowBreakup = smoothstep(0.3, 0.7, noise2);
	// At moderate height, breakup is strong. At very high, snow wins.
	float heightFactor = smoothstep(uSnowThreshold, uSnowThreshold + 60.0, aboveRoad);
	float wSnow = wSnowRaw * mix(snowBreakup, 1.0, heightFactor);
	float wNearMoss = smoothstep(0.0, 1.0, nearRoad) * (0.5 + 0.5 * noise1);
	float wBelowDirt = smoothstep(0.0, -10.0, aboveRoad);
	// Steep slopes punch through snow — rock faces show on cliffs
	float slopeBreak = smoothstep(0.35, 0.55, slope) * (1.0 - heightFactor * 0.5);
	wSnow *= (1.0 - slopeBreak * 0.7);
	wRock = max(wRock, slopeBreak * 0.5);

	float wFarDirt = smoothstep(40.0, 80.0, dist) * (0.3 + 0.7 * noise2);

	float wGrass = 1.0;
	wGrass -= wRock;
	wGrass -= wSnow;
	wGrass -= wNearMoss;
	wGrass -= wBelowDirt;
	wGrass -= wFarDirt;
	wGrass = max(wGrass, 0.0);

	float total = wGrass + wRock + wSnow + wNearMoss + wBelowDirt + wFarDirt;
	wGrass /= total;
	wRock /= total;
	wSnow /= total;
	wNearMoss /= total;
	wBelowDirt /= total;
	wFarDirt /= total;

	// Stochastic UVs to break tiling — each tile rotated randomly
	vec2 suvG = stochasticUV(vUv, uTexRepeat);
	vec2 suvD = stochasticUV(vUv, uTexRepeat * 1.1);
	vec2 suvR = stochasticUV(vUv, uTexRepeat);
	vec2 suvS = stochasticUV(vUv, uTexRepeat);
	vec2 suvM = stochasticUV(vUv, uTexRepeat * 0.9);

	vec3 grass = texture2D(tGrassC, suvG).rgb;
	vec3 dirt = texture2D(tDirtC, suvD).rgb;
	vec3 rock = texture2D(tRockC, suvR).rgb;
	vec3 snow = texture2D(tSnowC, suvS).rgb * uSnowTint;
	vec3 moss = texture2D(tMossC, suvM).rgb;

	// Normal maps with same stochastic UVs
	vec3 snowNormal = texture2D(tSnowN, suvS).rgb * 2.0 - 1.0;
	snowNormal = normalize(snowNormal);
	vec3 rockNormal = texture2D(tRockN, suvR).rgb * 2.0 - 1.0;
	rockNormal = normalize(rockNormal);

	// Compute TBN from screen-space derivatives
	vec3 Q1 = dFdx(vWorldPos);
	vec3 Q2 = dFdy(vWorldPos);
	vec2 st1 = dFdx(vUv);
	vec2 st2 = dFdy(vUv);
	vec3 T = normalize(Q1 * st2.t - Q2 * st1.t);
	vec3 B = normalize(-Q1 * st2.s + Q2 * st1.s);
	vec3 N0 = normalize(vNormal);
	mat3 tbn = mat3(T, B, N0);

	// Blend normals same as colors
	vec3 normalMap = normalize(
		N0 * (wGrass + wBelowDirt + wFarDirt + wNearMoss) +
		(tbn * rockNormal) * wRock +
		(tbn * snowNormal) * wSnow
	);

	vec3 baseColor = grass * uGrassTint * wGrass + dirt * uDirtTint * (wBelowDirt + wFarDirt) + rock * uRockTint * wRock + snow + moss * uGrassTint * wNearMoss;

	vec3 N = normalize(normalMap);
	vec3 sunDir = normalize(uSunDir);
	float NdotL = max(dot(N, sunDir), 0.0);

	// Snow specular sparkle (Blinn-Phong, tight highlight)
	vec3 viewDir = normalize(cameraPosition - vWorldPos);
	vec3 halfDir = normalize(sunDir + viewDir);
	float snowSpec = pow(max(dot(N, halfDir), 0.0), 128.0) * wSnow * uSunIntensity;
	// Fresnel rim on snow for icy look
	float snowFresnel = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0) * wSnow * 0.15;

	// Rock specular (softer)
	float rockSpec = pow(max(dot(N, halfDir), 0.0), 32.0) * wRock * uSunIntensity * 0.15;

	// Street light point light contribution
	vec3 pointLighting = vec3(0.0);
	for (int i = 0; i < 4; i++) {
		if (i >= uStreetLightCount) break;
		vec3 toLight = uStreetLightPos[i] - vWorldPos;
		float d = length(toLight);
		float atten = 1.0 / (1.0 + d * 0.015 + d * d * 0.003);
		float NdL2 = max(dot(N, normalize(toLight)), 0.0);
		pointLighting += uStreetLightColor[i] * NdL2 * atten;
	}
	pointLighting *= uStreetLightIntensity;

	vec3 diffuse = baseColor * (uAmbientColor * uAmbientIntensity + uSunColor * NdotL * uSunIntensity + pointLighting);
	diffuse += vec3(snowSpec * 0.6 + snowFresnel); // snow sparkle
	diffuse += vec3(rockSpec * 0.3); // subtle rock sheen

	float fogDist = length(vWorldPos - cameraPosition);
	float fogFactor = smoothstep(uFogNear, uFogFar, fogDist);
	vec3 color = mix(diffuse, uFogColor, fogFactor);

	gl_FragColor = vec4(color, 1.0);
}
`;

// ── Build terrain ───────────────────────────────────────────────────────

export async function buildTerrain(
	_data: TrackResponse,
	terrain: TerrainSampler,
	biome: BiomeConfig,
	worldSize: number,
): Promise<THREE.Group> {
	const group = new THREE.Group();
	const tex = await loadTerrainTextures(biome);

	// World size passed in, always big enough for track + padding
	// Scale segments to maintain ~6.25m per quad
	const segments = Math.min(512, Math.max(256, Math.round(worldSize / 6.25)));

	const geometry = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
	geometry.rotateX(-Math.PI / 2);
	const pos = geometry.attributes.position;
	const blend0Data = new Float32Array(pos.count * 3);
	const blend1Data = new Float32Array(pos.count * 3);

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);

		const terrainY = terrain.getHeight(x, z);
		pos.setY(i, terrainY);

		const { dist } = terrain.nearestRoad(x, z);
		const aboveRoad = terrainY - terrain.avgRoadY;
		const blend = smoothstep(15, 40, dist);
		const slope = blend > 0.5 ? Math.abs(terrainY - terrain.avgRoadY) / 80 : 0;
		const noise1 = Math.sin(x * 0.05 + z * 0.07) * 0.5 + 0.5;
		// Better noise for snow/rock breakup — multi-scale pseudo-random
		const nx = x * 0.02,
			nz = z * 0.02;
		const noise2 =
			(Math.sin(nx * 1.7 + nz * 2.3) * 0.5 + 0.5) * 0.5 +
			(Math.sin(nx * 5.1 + nz * 3.7 + 1.3) * 0.5 + 0.5) * 0.3 +
			(Math.sin(nx * 11.3 + nz * 9.1 + 4.7) * 0.5 + 0.5) * 0.2;
		const nearRoad = smoothstep(25.0, 0.0, dist);

		blend0Data[i * 3] = aboveRoad;
		blend0Data[i * 3 + 1] = slope;
		blend0Data[i * 3 + 2] = dist;
		blend1Data[i * 3] = noise1;
		blend1Data[i * 3 + 1] = noise2;
		blend1Data[i * 3 + 2] = nearRoad;
	}

	const uvs = geometry.attributes.uv;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		uvs.setXY(i, x / worldSize, z / worldSize);
	}

	geometry.setAttribute("aBlend0", new THREE.BufferAttribute(blend0Data, 3));
	geometry.setAttribute("aBlend1", new THREE.BufferAttribute(blend1Data, 3));
	geometry.computeVertexNormals();

	// Compute tangent space for normal mapping

	const material = new THREE.ShaderMaterial({
		vertexShader: terrainVertexShader,
		fragmentShader: terrainFragmentShader,
		uniforms: {
			tGrassC: { value: tex.grassC },
			tDirtC: { value: tex.dirtC },
			tRockC: { value: tex.rockC },
			tRockN: { value: tex.rockN },
			tSnowC: { value: tex.snowC },
			tSnowN: { value: tex.snowN },
			tMossC: { value: tex.mossC },
			uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
			uSunIntensity: { value: 1.0 },
			uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
			uAmbientColor: { value: new THREE.Color(0.4, 0.45, 0.5) },
			uAmbientIntensity: { value: 0.6 },
			uTexRepeat: { value: biome.texRepeat ?? TERRAIN_TEX_REPEAT },
			uFogColor: { value: new THREE.Color(...biome.fogColor) },
			uFogNear: { value: biome.fogNear },
			uFogFar: { value: biome.fogFar },
			uGrassTint: { value: new THREE.Color(...biome.grassTint) },
			uDirtTint: { value: new THREE.Color(...biome.dirtTint) },
			uRockTint: { value: new THREE.Color(...biome.rockTint) },
			uSnowThreshold: { value: biome.snowThreshold },
			uSnowTint: { value: new THREE.Color(...(biome.snowTint ?? [1.3, 1.3, 1.35])) },
			uRockThreshold: { value: biome.rockThreshold },
			uStreetLightCount: { value: 0 },
			uStreetLightPos: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
			uStreetLightColor: {
				value: Array.from({ length: 4 }, () => new THREE.Vector3(1, 0.95, 0.8)),
			},
			uStreetLightIntensity: { value: 0.0 },
		},
	});

	// Store reference for sky.ts to update uniforms
	state.terrainMaterial = material;

	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	group.add(mesh);

	return group;
}
