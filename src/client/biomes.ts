import type { SceneryType } from "@shared/track.ts";

// ── Biome configuration ────────────────────────────────────────────────

export interface BiomeTextureSet {
	grass: string;
	dirt: string;
	rock: string;
	snow: string;
	moss: string;
}

export interface BiomeConfig {
	name: string;

	// Terrain texture paths (relative to /textures/)
	textures: BiomeTextureSet;

	// Terrain blend thresholds (relative to avgRoadY)
	snowThreshold: number; // above this → snow
	rockThreshold: number; // slope > this → rock (0-1)

	// Terrain color tints (multiplied with texture)
	grassTint: [number, number, number];
	dirtTint: [number, number, number];
	rockTint: [number, number, number];

	// Vegetation
	treeTypes: SceneryType[]; // which tree variants to use
	grassTypes: SceneryType[]; // which grass variants
	treeDensity: number; // multiplier
	grassDensity: number;
	rockDensity: number;

	// Atmosphere defaults
	fogColor: [number, number, number];
	fogNear: number;
	fogFar: number;
	skyTurbidity: number;
	skyRayleigh: number;

	// Terrain height
	noiseAmp: number;
	mountainAmplifier: number;
}

// ── Biome definitions ──────────────────────────────────────────────────

const BIOMES: BiomeConfig[] = [
	{
		name: "Temperate Forest",
		textures: {
			grass: "/textures/grass/Grass004_1K-JPG",
			dirt: "/textures/dirt/Ground015_1K-JPG",
			rock: "/textures/rock_mossy/Rock011_1K-JPG",
			snow: "/textures/snow/Ground061_1K-JPG",
			moss: "/textures/moss/Moss002_1K-JPG",
		},
		snowThreshold: 80,
		rockThreshold: 0.5,
		grassTint: [1.0, 1.0, 1.0],
		dirtTint: [1.0, 1.0, 1.0],
		rockTint: [1.0, 1.0, 1.0],
		treeTypes: ["tree_pineTallA", "tree_pineTallB", "tree_pineDefaultB", "tree_pineSmallA"],
		grassTypes: ["grass", "grass_large"],
		treeDensity: 1.0,
		grassDensity: 1.0,
		rockDensity: 1.0,
		fogColor: [0.75, 0.82, 0.78],
		fogNear: 400,
		fogFar: 1000,
		skyTurbidity: 4,
		skyRayleigh: 2,
		noiseAmp: 60,
		mountainAmplifier: 3,
	},
	{
		name: "Autumn Woods",
		textures: {
			grass: "/textures/grass_moss/Grass007_1K-JPG",
			dirt: "/textures/dirt_dry/Ground031_1K-JPG",
			rock: "/textures/rock_gray/Rock010_1K-JPG",
			snow: "/textures/snow/Ground061_1K-JPG",
			moss: "/textures/forest_floor/Ground012_1K-JPG",
		},
		snowThreshold: 60,
		rockThreshold: 0.45,
		grassTint: [1.2, 0.95, 0.7],
		dirtTint: [1.1, 0.85, 0.65],
		rockTint: [1.0, 0.9, 0.75],
		treeTypes: ["tree_pineDefaultB", "tree_pineTallA", "tree_pineSmallA"],
		grassTypes: ["grass" as SceneryType],
		treeDensity: 0.85,
		grassDensity: 0.7,
		rockDensity: 1.2,
		fogColor: [0.85, 0.78, 0.65],
		fogNear: 350,
		fogFar: 900,
		skyTurbidity: 6,
		skyRayleigh: 3,
		noiseAmp: 55,
		mountainAmplifier: 3,
	},
	{
		name: "Desert Canyon",
		textures: {
			grass: "/textures/sand/Ground057_1K-JPG",
			dirt: "/textures/sand_desert/Ground092A_1K-JPG",
			rock: "/textures/rock_dark/Rock031_1K-JPG",
			snow: "/textures/sand/Ground057_1K-JPG",
			moss: "/textures/dirt_dry/Ground031_1K-JPG",
		},
		snowThreshold: 200,
		rockThreshold: 0.35,
		grassTint: [1.1, 0.95, 0.75],
		dirtTint: [1.15, 1.0, 0.8],
		rockTint: [1.2, 0.9, 0.7],
		treeTypes: ["tree_pineDefaultB"],
		grassTypes: ["grass" as SceneryType],
		treeDensity: 0.15,
		grassDensity: 0.1,
		rockDensity: 2.5,
		fogColor: [0.9, 0.82, 0.68],
		fogNear: 300,
		fogFar: 800,
		skyTurbidity: 10,
		skyRayleigh: 1,
		noiseAmp: 80,
		mountainAmplifier: 5,
	},
	{
		name: "Alpine Meadow",
		textures: {
			grass: "/textures/grass/Grass004_1K-JPG",
			dirt: "/textures/rock_gray/Rock010_1K-JPG",
			rock: "/textures/rock_mossy/Rock011_1K-JPG",
			snow: "/textures/snow/Ground061_1K-JPG",
			moss: "/textures/grass_moss/Grass007_1K-JPG",
		},
		snowThreshold: 40,
		rockThreshold: 0.4,
		grassTint: [0.95, 1.05, 1.0],
		dirtTint: [0.9, 0.9, 0.95],
		rockTint: [0.95, 0.95, 1.0],
		treeTypes: ["tree_pineTallA", "tree_pineTallB", "tree_pineDefaultB"],
		grassTypes: ["grass", "grass_large"],
		treeDensity: 0.5,
		grassDensity: 0.6,
		rockDensity: 1.8,
		fogColor: [0.8, 0.85, 0.9],
		fogNear: 300,
		fogFar: 800,
		skyTurbidity: 3,
		skyRayleigh: 2,
		noiseAmp: 70,
		mountainAmplifier: 6,
	},
	{
		name: "Tropical Jungle",
		textures: {
			grass: "/textures/forest_floor/Ground012_1K-JPG",
			dirt: "/textures/dirt/Ground015_1K-JPG",
			rock: "/textures/rock_mossy/Rock011_1K-JPG",
			snow: "/textures/moss/Moss002_1K-JPG",
			moss: "/textures/moss/Moss002_1K-JPG",
		},
		snowThreshold: 300,
		rockThreshold: 0.55,
		grassTint: [0.9, 1.15, 0.85],
		dirtTint: [0.85, 0.95, 0.75],
		rockTint: [0.9, 1.05, 0.85],
		treeTypes: ["tree_pineDefaultB", "tree_pineTallA", "tree_pineSmallA", "tree_pineSmallB"],
		grassTypes: ["grass", "grass_large"],
		treeDensity: 1.5,
		grassDensity: 1.4,
		rockDensity: 0.6,
		fogColor: [0.72, 0.82, 0.7],
		fogNear: 250,
		fogFar: 700,
		skyTurbidity: 5,
		skyRayleigh: 3,
		noiseAmp: 45,
		mountainAmplifier: 3,
	},
	{
		name: "Rural Countryside",
		textures: {
			grass: "/textures/grass/Grass004_1K-JPG",
			dirt: "/textures/path/Pathway004_1K-JPG",
			rock: "/textures/gravel/Gravel015_1K-JPG",
			snow: "/textures/snow/Ground061_1K-JPG",
			moss: "/textures/moss/Moss002_1K-JPG",
		},
		snowThreshold: 70,
		rockThreshold: 0.5,
		grassTint: [1.05, 1.1, 0.95],
		dirtTint: [1.0, 0.95, 0.85],
		rockTint: [1.0, 1.0, 0.95],
		treeTypes: ["tree_pineDefaultB", "tree_pineTallA", "tree_pineSmallA"],
		grassTypes: ["grass", "grass_large"],
		treeDensity: 0.6,
		grassDensity: 1.2,
		rockDensity: 0.8,
		fogColor: [0.82, 0.85, 0.8],
		fogNear: 450,
		fogFar: 1100,
		skyTurbidity: 3,
		skyRayleigh: 1.5,
		noiseAmp: 40,
		mountainAmplifier: 2,
	},
];

// ── Biome selection ────────────────────────────────────────────────────

export function getBiomeForSeed(seed: number): BiomeConfig {
	return BIOMES[seed % BIOMES.length];
}

export function getAllBiomes(): BiomeConfig[] {
	return BIOMES;
}

export function getBiomeByName(name: string): BiomeConfig | undefined {
	return BIOMES.find((b) => b.name === name);
}
