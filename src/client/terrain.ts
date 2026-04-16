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
				// Normal/roughness/AO maps stay in linear space
				resolve(tex);
			},
			undefined,
			reject,
		);
	});
}

// ── TerrainSampler ──────────────────────────────────────────────────────

export interface FlattenZone {
	x: number;
	z: number;
	radius: number;
	y: number;
}

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
	flattenZones: FlattenZone[] = [];

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
		// Quantize to 0.25m grid for caching (smooth enough for driving)
		const qx = Math.round(x * 4) / 4;
		const qz = Math.round(z * 4) / 4;
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

		// Apply flatten zones
		let finalY = result;
		for (const zone of this.flattenZones) {
			const dx = x - zone.x;
			const dz = z - zone.z;
			const dist = Math.sqrt(dx * dx + dz * dz);
			if (dist < zone.radius) {
				const blend = smoothstep(zone.radius, 0, dist);
				finalY = finalY * (1 - blend) + zone.y * blend;
			}
		}

		this.heightCache.set(cacheKey, finalY);
		return finalY;
	}

	getNormal(x: number, z: number): { x: number; y: number; z: number } {
		const eps = 0.25;
		const hL = this.getHeight(x - eps, z);
		const hR = this.getHeight(x + eps, z);
		const hD = this.getHeight(x, z - eps);
		const hU = this.getHeight(x, z + eps);
		const nx = hL - hR;
		const ny = 2 * eps;
		const nz = hD - hU;
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
		return { x: nx / len, y: ny / len, z: nz / len };
	}

	getRoadBoundary(
		x: number,
		z: number,
	): {
		lateralDist: number;
		distFromCenter: number;
		roadHalfWidth: number;
		kerbEdge: number;
		guardrailDist: number;
		onRoad: boolean;
		onKerb: boolean;
		onShoulder: boolean;
		wallNormal?: { x: number; z: number };
		distToWall: number;
	} {
		const { sample } = this.nearestRoad(x, z);

		// Cross-product lateral distance (tangent is normalized, so this is exact)
		const toX = x - sample.point.x;
		const toZ = z - sample.point.z;
		const tx = sample.tangent?.x ?? 0;
		const tz = sample.tangent?.z ?? 1;
		const lateralDist = tz * toX - tx * toZ;
		const distFromCenter = Math.abs(lateralDist);

		// Road cross-section widths from sample geometry
		const halfW = Math.sqrt(
			(sample.kerbLeft.x - sample.point.x) ** 2 + (sample.kerbLeft.z - sample.point.z) ** 2,
		);
		const kerbW = Math.sqrt(
			(sample.grassLeft.x - sample.kerbLeft.x) ** 2 + (sample.grassLeft.z - sample.kerbLeft.z) ** 2,
		);
		const shoulderW =
			Math.sqrt(
				(sample.grassLeft.x - sample.point.x) ** 2 + (sample.grassLeft.z - sample.point.z) ** 2,
			) -
			halfW -
			kerbW;

		const kerbEdge = halfW + kerbW;
		const guardrailDist = halfW + kerbW + shoulderW;

		// Zone detection
		const onRoad = distFromCenter < halfW;
		const onKerb = distFromCenter >= halfW && distFromCenter < kerbEdge;
		const onShoulder = distFromCenter >= kerbEdge && distFromCenter < guardrailDist;

		// Wall collision: direct distance to nearest guardrail mesh position
		const dToWall = (p: { x: number; z: number }) => Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2);
		const distToLeft = dToWall(sample.grassLeft);
		const distToRight = dToWall(sample.grassRight);
		const isLeft = distToLeft < distToRight;
		const distToWall = isLeft ? distToLeft : distToRight;

		// Wall normal: from nearest guardrail toward car
		const wall = isLeft ? sample.grassLeft : sample.grassRight;
		const wnx = x - wall.x;
		const wnz = z - wall.z;
		const wnLen = Math.sqrt(wnx * wnx + wnz * wnz);
		const wallNormal = wnLen > 0.001 ? { x: wnx / wnLen, z: wnz / wnLen } : undefined;

		return {
			lateralDist,
			distFromCenter,
			roadHalfWidth: halfW,
			kerbEdge,
			guardrailDist,
			onRoad,
			onKerb,
			onShoulder,
			wallNormal,
			distToWall,
		};
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
	const [
		grassC,
		grassN,
		grassRA,
		dirtC,
		dirtN,
		dirtRA,
		rockC,
		rockN,
		rockRA,
		snowC,
		snowN,
		snowRA,
		mossC,
		mossN,
		mossRA,
	] = await Promise.all([
		loadTex(`${tex.grass}_Color.jpg`),
		loadNormalTex(`${tex.grass}_NormalGL.jpg`),
		loadNormalTex(`${tex.grass}_RoughnessAO.jpg`),
		loadTex(`${tex.dirt}_Color.jpg`),
		loadNormalTex(`${tex.dirt}_NormalGL.jpg`),
		loadNormalTex(`${tex.dirt}_RoughnessAO.jpg`),
		loadTex(`${tex.rock}_Color.jpg`),
		loadNormalTex(`${tex.rock}_NormalGL.jpg`),
		loadNormalTex(`${tex.rock}_RoughnessAO.jpg`),
		loadTex(`${tex.snow}_Color.jpg`),
		loadNormalTex(`${tex.snow}_NormalGL.jpg`),
		loadNormalTex(`${tex.snow}_RoughnessAO.jpg`),
		loadTex(`${tex.moss}_Color.jpg`),
		loadNormalTex(`${tex.moss}_NormalGL.jpg`),
		loadNormalTex(`${tex.moss}_RoughnessAO.jpg`),
	]);
	terrainTextures = {
		grassC,
		grassN,
		grassRA,
		dirtC,
		dirtN,
		dirtRA,
		rockC,
		rockN,
		rockRA,
		snowC,
		snowN,
		snowRA,
		mossC,
		mossN,
		mossRA,
	};
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
	vUv = uv; // raw UVs — stochasticUV handles tiling internally
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
uniform sampler2D tGrassN;
uniform sampler2D tGrassRA;
uniform sampler2D tDirtC;
uniform sampler2D tDirtN;
uniform sampler2D tDirtRA;
uniform sampler2D tRockC;
uniform sampler2D tRockN;
uniform sampler2D tRockRA;
uniform sampler2D tSnowC;
uniform sampler2D tSnowN;
uniform sampler2D tSnowRA;
uniform sampler2D tMossC;
uniform sampler2D tMossN;
uniform sampler2D tMossRA;
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
uniform float uMossRange;
uniform float uDirtNearDist;
uniform float uDirtFarDist;
uniform float uFarDirtStart;
uniform float uFarDirtEnd;
uniform float uPatchNoiseStrength;
uniform float uDebugMode;
uniform int uStreetLightCount;
uniform vec3 uStreetLightPos[4];
uniform vec3 uStreetLightColor[4];
uniform float uStreetLightIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBlend0;
varying vec3 vBlend1;

// Hash function for procedural noise
float hash2(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Value noise — smooth random at given scale
float valueNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f); // smoothstep
	float a = hash2(i);
	float b = hash2(i + vec2(1.0, 0.0));
	float c = hash2(i + vec2(0.0, 1.0));
	float d = hash2(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion — layered noise for organic patterns
float fbm(vec2 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) {
		v += a * valueNoise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}

// Voronoi — distance to nearest cell center
float voronoi(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float minDist = 1.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 neighbor = vec2(float(x), float(y));
			vec2 point = vec2(hash2(i + neighbor), hash2(i + neighbor + vec2(57.1, 93.3))) * 0.8 + 0.1; // jittered cell center
			float d = length(neighbor + point - f);
			minDist = min(minDist, d);
		}
	}
	return minDist;
}

// Multi-scale Voronoi — organic cell pattern
float voronoiFbm(vec2 p) {
	float v1 = voronoi(p);
	float v2 = voronoi(p * 1.7 + 3.7);
	float v3 = voronoi(p * 3.1 + 7.3);
	return v1 * 0.5 + v2 * 0.3 + v3 * 0.2;
}

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

	// ── Procedural noise driven by world position ──
	vec2 wp = vWorldPos.xz;
	float voroLarge = voronoiFbm(wp * 0.008);  // ~125m cells
	float voroSmall = voronoiFbm(wp * 0.025);  // ~40m cells
	float fbmLarge = fbm(wp * 0.006);           // broad variation
	float fbmSmall = fbm(wp * 0.02);            // detail variation
	// Combine into organic terrain noise (0-1)
	float terrainNoise = fbmLarge * 0.4 + voroLarge * 0.35 + voroSmall * 0.15 + fbmSmall * 0.1;
	// Terrain-driven biases: slope pushes toward rock/dirt, low areas toward dirt
	float slopeBias = smoothstep(0.0, 0.3, slope);
	float lowBias = smoothstep(5.0, -10.0, aboveRoad);
	float distBias = smoothstep(10.0, 50.0, dist) * 0.3; // slight increase far from road

	float wRock = smoothstep(uRockThreshold, uRockThreshold + 0.15, slope);
	// Add Voronoi-driven rock patches on moderate slopes
	wRock = max(wRock, smoothstep(0.55, 0.7, terrainNoise) * slopeBias * 0.5);

	float wSnowRaw = smoothstep(uSnowThreshold, uSnowThreshold + 20.0, aboveRoad);
	// Noisy transition band — patchy snow only in a narrow height range
	float snowBreakup = smoothstep(0.3, 0.7, terrainNoise);
	// Below the solid line: patchy. Above: fully solid.
	float solidLine = smoothstep(uSnowThreshold + 20.0, uSnowThreshold + 50.0, aboveRoad);
	float wSnow = wSnowRaw * mix(snowBreakup, 1.0, solidLine);

	// Rock fades out at high elevations — mountains become pure snow
	float rockHeightFade = 1.0 - solidLine;
	wRock *= rockHeightFade;

	float wNearMoss = smoothstep(0.0, 1.0, smoothstep(uMossRange, 0.0, dist)) * (0.5 + 0.5 * noise1);
	float wBelowDirt = smoothstep(uDirtNearDist, uDirtFarDist, aboveRoad);
	// Steep slopes show rock — but only at low/mid elevations
	float slopeBreak = smoothstep(0.35, 0.55, slope) * rockHeightFade * 0.7;
	wRock = max(wRock, slopeBreak);

	float wFarDirt = smoothstep(uFarDirtStart, uFarDirtEnd, dist) * (1.0 - uPatchNoiseStrength + uPatchNoiseStrength * terrainNoise);

	// Grass patches blend with dirt texture (lowlands) or snow texture (highlands)
	float patchSnowMix = smoothstep(uSnowThreshold, uSnowThreshold + 30.0, aboveRoad);

	// Grass starts at 1.0 and gets subtracted
	float wGrass = 1.0;

	// Voronoi-driven moss/snow patches within grass — influenced by terrain
	float patchThreshold = 0.28 + slopeBias * 0.1;
	float wGrassPatch = smoothstep(patchThreshold, patchThreshold + 0.15, terrainNoise) * 0.5;

	wGrass -= wRock;
	wGrass -= wSnow;
	wGrass -= wNearMoss;
	wGrass -= wBelowDirt;
	wGrass -= wFarDirt;
	wGrass -= wGrassPatch;
	wGrass = max(wGrass, 0.0);

	float total = wGrass + wRock + wSnow + wNearMoss + wBelowDirt + wFarDirt + wGrassPatch;
	wGrass /= total;
	wRock /= total;
	wSnow /= total;
	wNearMoss /= total;
	wBelowDirt /= total;
	wFarDirt /= total;
	wGrassPatch /= total;

	// Stochastic UVs to break tiling — each tile rotated randomly
	vec2 suvG = stochasticUV(vUv, uTexRepeat);
	vec2 suvD = stochasticUV(vUv, uTexRepeat * 1.1);
	vec2 suvR = stochasticUV(vUv, uTexRepeat);
	vec2 suvS = stochasticUV(vUv, uTexRepeat);
	vec2 suvM = stochasticUV(vUv, uTexRepeat * 0.9);

	// Color
	vec3 grass = texture2D(tGrassC, suvG).rgb;
	vec3 dirt = texture2D(tDirtC, suvD).rgb;
	vec3 rock = texture2D(tRockC, suvR).rgb;
	vec3 snow = texture2D(tSnowC, suvS).rgb * uSnowTint;
	vec3 moss = texture2D(tMossC, suvM).rgb;

	// Normals
	vec3 grassNormal = texture2D(tGrassN, suvG).rgb * 2.0 - 1.0;
	grassNormal = normalize(grassNormal);
	vec3 dirtNormal = texture2D(tDirtN, suvD).rgb * 2.0 - 1.0;
	dirtNormal = normalize(dirtNormal);
	vec3 rockNormal = texture2D(tRockN, suvR).rgb * 2.0 - 1.0;
	rockNormal = normalize(rockNormal);
	vec3 snowNormal = texture2D(tSnowN, suvS).rgb * 2.0 - 1.0;
	snowNormal = normalize(snowNormal);
	vec3 mossNormal = texture2D(tMossN, suvM).rgb * 2.0 - 1.0;
	mossNormal = normalize(mossNormal);

	// Roughness (R channel) and AO (G channel) packed together (values 0-1)
	float grassR = texture2D(tGrassRA, suvG).r;
	float grassAO = texture2D(tGrassRA, suvG).g;
	float dirtR = texture2D(tDirtRA, suvD).r;
	float dirtAO = texture2D(tDirtRA, suvD).g;
	float rockR = texture2D(tRockRA, suvR).r;
	float rockAO = texture2D(tRockRA, suvR).g;
	float snowR = texture2D(tSnowRA, suvS).r;
	float snowAO = texture2D(tSnowRA, suvS).g;
	float mossR = texture2D(tMossRA, suvM).r;
	float mossAO = texture2D(tMossRA, suvM).g;

	// Compute TBN from screen-space derivatives
	vec3 Q1 = dFdx(vWorldPos);
	vec3 Q2 = dFdy(vWorldPos);
	vec2 st1 = dFdx(vUv);
	vec2 st2 = dFdy(vUv);
	vec3 T = normalize(Q1 * st2.t - Q2 * st1.t);
	vec3 B = normalize(-Q1 * st2.s + Q2 * st1.s);
	vec3 N0 = normalize(vNormal);
	mat3 tbn = mat3(T, B, N0);

	// Blend normals — weighted by same blend factors as colors
	vec3 normalMap = normalize(
		(tbn * grassNormal) * wGrass +
		(tbn * dirtNormal) * (wBelowDirt + wFarDirt) +
		(tbn * rockNormal) * wRock +
		(tbn * mossNormal) * (wNearMoss + wGrassPatch * (1.0 - patchSnowMix)) +
		(tbn * snowNormal) * (wSnow + wGrassPatch * patchSnowMix) +
		(tbn * mossNormal) * wNearMoss
	);

	// Blend roughness and AO same as colors
	float blendedRough = grassR * wGrass + dirtR * (wBelowDirt + wFarDirt) + rockR * wRock + snowR * (wSnow + wGrassPatch * patchSnowMix) + mossR * (wNearMoss + wGrassPatch * (1.0 - patchSnowMix));
	float blendedAO = grassAO * wGrass + dirtAO * (wBelowDirt + wFarDirt) + rockAO * wRock + snowAO * (wSnow + wGrassPatch * patchSnowMix) + mossAO * (wNearMoss + wGrassPatch * (1.0 - patchSnowMix));
	blendedRough = clamp(blendedRough, 0.0, 1.0);
	blendedAO = clamp(blendedAO, 0.0, 1.0);
	// Gentle AO — blend 70% full brightness with 30% actual AO to avoid over-darkening
	blendedAO = mix(1.0, blendedAO, 0.3);

	vec3 baseColor = grass * uGrassTint * wGrass + dirt * uDirtTint * (wBelowDirt + wFarDirt) + rock * uRockTint * wRock + snow * (wSnow + wGrassPatch * patchSnowMix) + moss * uGrassTint * (wNearMoss + wGrassPatch * (1.0 - patchSnowMix));

	vec3 N = normalize(normalMap);
	vec3 sunDir = normalize(uSunDir);
	float NdotL = max(dot(N, sunDir), 0.0);

	// Snow specular sparkle (Blinn-Phong, tight highlight)
	vec3 viewDir = normalize(cameraPosition - vWorldPos);
	vec3 halfDir = normalize(sunDir + viewDir);
	// Roughness reduces specular intensity — rough surfaces scatter light
	float specRough = 1.0 - blendedRough; // invert: 0 rough = full spec
	float snowSpec = pow(max(dot(N, halfDir), 0.0), mix(32.0, 256.0, specRough)) * wSnow * uSunIntensity * specRough;

	// Fresnel rim on snow for icy look
	float snowFresnel = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0) * wSnow * 0.15 * specRough;

	// Rock specular (softer)
	float rockSpec = pow(max(dot(N, halfDir), 0.0), mix(16.0, 64.0, specRough)) * wRock * uSunIntensity * 0.15 * specRough;

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

	vec3 diffuse = baseColor * (uAmbientColor * uAmbientIntensity * blendedAO + uSunColor * NdotL * uSunIntensity + pointLighting);
	diffuse += vec3(snowSpec * 0.6 + snowFresnel); // snow sparkle
	diffuse += vec3(rockSpec * 0.3); // subtle rock sheen

	float fogDist = length(vWorldPos - cameraPosition);
	float fogFactor = smoothstep(uFogNear, uFogFar, fogDist);
	vec3 color = mix(diffuse, uFogColor, fogFactor);

	// Debug: show blend weights as colors (set uDebugMode > 0.5 to enable)
	if (uDebugMode > 0.5) {
		// Grass=green, Rock=red, Snow=white, Moss=blue, BelowDirt=orange, FarDirt=yellow, GrassPatch=magenta
		color = vec3(0.0, 0.8, 0.0) * wGrass
			+ vec3(0.8, 0.2, 0.0) * wRock
			+ vec3(1.0, 1.0, 1.0) * wSnow
			+ vec3(0.0, 0.2, 0.8) * wNearMoss
			+ vec3(1.0, 0.5, 0.0) * wBelowDirt
			+ vec3(1.0, 1.0, 0.0) * wFarDirt
			+ vec3(0.2, 0.5, 0.1) * wGrassPatch * (1.0 - patchSnowMix) // moss patches (lowlands)
			+ vec3(1.0, 1.0, 1.0) * wGrassPatch * patchSnowMix; // snow patches (highlands)
	}

	gl_FragColor = vec4(color, 1.0);
}
`;

// ── Build terrain ───────────────────────────────────────────────────────

/** Build terrain mesh with custom GLSL shader (7-layer blend based on height/slope/road distance). */
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
			tGrassN: { value: tex.grassN },
			tGrassRA: { value: tex.grassRA },
			tDirtC: { value: tex.dirtC },
			tDirtN: { value: tex.dirtN },
			tDirtRA: { value: tex.dirtRA },
			tRockC: { value: tex.rockC },
			tRockN: { value: tex.rockN },
			tRockRA: { value: tex.rockRA },
			tSnowC: { value: tex.snowC },
			tSnowN: { value: tex.snowN },
			tSnowRA: { value: tex.snowRA },
			tMossC: { value: tex.mossC },
			tMossN: { value: tex.mossN },
			tMossRA: { value: tex.mossRA },
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
			uMossRange: { value: biome.mossRange ?? 25.0 },
			uDirtNearDist: { value: biome.dirtNearDist ?? 0.0 },
			uDirtFarDist: { value: biome.dirtFarDist ?? -10.0 },
			uFarDirtStart: { value: biome.farDirtStart ?? 40.0 },
			uFarDirtEnd: { value: biome.farDirtEnd ?? 80.0 },
			uPatchNoiseStrength: { value: biome.patchNoiseStrength ?? 0.7 },
			uDebugMode: { value: 0.0 },
		},
	});

	// Store reference for sky.ts to update uniforms
	state.terrainMaterial = material;

	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	group.add(mesh);

	return group;
}
