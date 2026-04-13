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

function loadTexLinear(path: string): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		new THREE.TextureLoader().load(
			path,
			(tex) => {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
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
	private readonly roadInfluence = 40;
	private readonly blendStart = 15;

	constructor(
		seed: number,
		samples: TrackSample[],
		opts: { noiseAmp?: number; mountainAmp?: number } = {},
	) {
		const rng = mulberry32(seed + 99999);
		this.noise2D = createNoise2D(rng);
		this.samples = samples;
		this.noiseAmp = opts.noiseAmp ?? 60;
		this.mountainAmp = opts.mountainAmp ?? 3;

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
		const { dist, sample } = this.nearestRoad(x, z);
		const centerDist = Math.sqrt(x * x + z * z);
		const mountainFactor = 1 + smoothstep(600, 900, centerDist) * this.mountainAmp;
		const noiseH =
			this.fbm(x * this.noiseScale, z * this.noiseScale) * this.noiseAmp * mountainFactor;
		const blend = smoothstep(this.blendStart, this.roadInfluence, dist);
		return sample.point.y * (1 - blend) + (this.avgRoadY + noiseH) * blend - 0.3;
	}
}

// ── Terrain textures ────────────────────────────────────────────────────

const TERRAIN_TEX_REPEAT = 800; // 2m per texture tile (1600/800)
let terrainTextures: Record<string, THREE.Texture> | null = null;
let loadedBiome: string | null = null;

async function loadTerrainTextures(biome: {
	textures: { grass: string; dirt: string; rock: string; snow: string; moss: string };
	name: string;
}): Promise<Record<string, THREE.Texture>> {
	// Reload if biome changed
	if (terrainTextures && loadedBiome === biome.name) return terrainTextures;
	const tex = biome.textures;
	const [grassC, grassN, dirtC, dirtN, rockC, rockN, snowC, snowN, mossC, mossN] =
		await Promise.all([
			loadTex(`${tex.grass}_Color.jpg`),
			loadTexLinear(`${tex.grass}_NormalGL.jpg`),
			loadTex(`${tex.dirt}_Color.jpg`),
			loadTexLinear(`${tex.dirt}_NormalGL.jpg`),
			loadTex(`${tex.rock}_Color.jpg`),
			loadTexLinear(`${tex.rock}_NormalGL.jpg`),
			loadTex(`${tex.snow}_Color.jpg`),
			loadTexLinear(`${tex.snow}_NormalGL.jpg`),
			loadTex(`${tex.moss}_Color.jpg`),
			loadTexLinear(`${tex.moss}_NormalGL.jpg`),
		]);
	// ShaderMaterial handles UV tiling via uTexRepeat uniform
	terrainTextures = { grassC, grassN, dirtC, dirtN, rockC, rockN, snowC, snowN, mossC, mossN };
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
uniform sampler2D tGrassN;
uniform sampler2D tDirtC;
uniform sampler2D tDirtN;
uniform sampler2D tRockC;
uniform sampler2D tRockN;
uniform sampler2D tSnowC;
uniform sampler2D tSnowN;
uniform sampler2D tMossC;
uniform sampler2D tMossN;
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

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vBlend0;
varying vec3 vBlend1;

vec3 perturbNormal(vec3 N, vec2 uv, sampler2D normalMap) {
	vec3 nm = texture2D(normalMap, uv).rgb * 2.0 - 1.0;
	nm.xy *= 1.5;
	return normalize(N + nm * 0.3);
}

void main() {
	float aboveRoad = vBlend0.x;
	float slope = vBlend0.y;
	float dist = vBlend0.z;
	float noise1 = vBlend1.x;
	float noise2 = vBlend1.y;
	float nearRoad = vBlend1.z;

	float wRock = smoothstep(uRockThreshold, uRockThreshold + 0.2, slope);
	float wSnow = smoothstep(uSnowThreshold, uSnowThreshold + 30.0, aboveRoad);
	float wNearMoss = smoothstep(0.0, 1.0, nearRoad) * (0.5 + 0.5 * noise1);
	float wBelowDirt = smoothstep(0.0, -10.0, aboveRoad);
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

	vec3 grass = texture2D(tGrassC, vUv).rgb;
	vec3 dirt = texture2D(tDirtC, vUv).rgb;
	vec3 rock = texture2D(tRockC, vUv).rgb;
	vec3 snow = texture2D(tSnowC, vUv).rgb;
	vec3 moss = texture2D(tMossC, vUv).rgb;

	vec3 baseColor = grass * uGrassTint * wGrass + dirt * uDirtTint * (wBelowDirt + wFarDirt) + rock * uRockTint * wRock + snow * wSnow + moss * uGrassTint * wNearMoss;

	vec3 N = normalize(vNormal);
	vec3 nGrass = perturbNormal(N, vUv, tGrassN);
	vec3 nDirt = perturbNormal(N, vUv, tDirtN);
	vec3 nRock = perturbNormal(N, vUv, tRockN);
	vec3 nSnow = perturbNormal(N, vUv, tSnowN);
	vec3 nMoss = perturbNormal(N, vUv, tMossN);
	vec3 blendedNormal = nGrass * wGrass + nDirt * (wBelowDirt + wFarDirt) + nRock * wRock + nSnow * wSnow + nMoss * wNearMoss;
	blendedNormal = normalize(blendedNormal);

	vec3 sunDir = normalize(uSunDir);
	float NdotL = max(dot(blendedNormal, sunDir), 0.0);
	vec3 diffuse = baseColor * (uAmbientColor * uAmbientIntensity + uSunColor * NdotL * uSunIntensity);

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
): Promise<THREE.Group> {
	const group = new THREE.Group();
	const tex = await loadTerrainTextures(biome);

	const worldSize = 1600;
	const segments = 256;

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
		const noise2 = Math.cos(x * 0.03 + z * 0.09) * 0.5 + 0.5;
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

	const material = new THREE.ShaderMaterial({
		vertexShader: terrainVertexShader,
		fragmentShader: terrainFragmentShader,
		uniforms: {
			tGrassC: { value: tex.grassC },
			tGrassN: { value: tex.grassN },
			tDirtC: { value: tex.dirtC },
			tDirtN: { value: tex.dirtN },
			tRockC: { value: tex.rockC },
			tRockN: { value: tex.rockN },
			tSnowC: { value: tex.snowC },
			tSnowN: { value: tex.snowN },
			tMossC: { value: tex.mossC },
			tMossN: { value: tex.mossN },
			uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
			uSunIntensity: { value: 1.0 },
			uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
			uAmbientColor: { value: new THREE.Color(0.4, 0.45, 0.5) },
			uAmbientIntensity: { value: 0.8 },
			uTexRepeat: { value: TERRAIN_TEX_REPEAT },
			uFogColor: { value: new THREE.Color(...biome.fogColor) },
			uFogNear: { value: biome.fogNear },
			uFogFar: { value: biome.fogFar },
			uGrassTint: { value: new THREE.Color(...biome.grassTint) },
			uDirtTint: { value: new THREE.Color(...biome.dirtTint) },
			uRockTint: { value: new THREE.Color(...biome.rockTint) },
			uSnowThreshold: { value: biome.snowThreshold },
			uRockThreshold: { value: biome.rockThreshold },
		},
	});

	// Store reference for sky.ts to update uniforms
	state.terrainMaterial = material;

	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	group.add(mesh);

	return group;
}
