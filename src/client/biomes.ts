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
	snowTint?: [number, number, number]; // boost snow brightness (default 1.3, 1.3, 1.35)

	// Road appearance per biome
	roadTint: [number, number, number]; // color multiplier on road texture
	roadRoughnessBase: number; // base roughness (lower = shinier)
	roadSnowOverlay?: { amount: number; color: [number, number, number] }; // procedural snow patches on road
	concreteSlab?: {
		texture: string;
		tint: [number, number, number];
		earthColor: [number, number, number];
		dropMax: number;
	}; // road edge slab

	// Vegetation
	treeTypes: SceneryType[]; // which tree variants to use
	grassTypes: SceneryType[]; // which grass variants
	bushTypes?: SceneryType[]; // which bush/shrub variants
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

	// Texture tiling
	texRepeat?: number; // overrides default TERRAIN_TEX_REPEAT
	exposureMult?: number; // multiplier on renderer exposure (default 1.0)

	// Terrain blend distances (override shader defaults)
	mossRange?: number; // how far from road moss extends (default 25)
	dirtNearDist?: number; // belowDirt fade start (default 0)
	dirtFarDist?: number; // belowDirt fade end (default -10)
	farDirtStart?: number; // farDirt blend start distance from road (default 40)
	farDirtEnd?: number; // farDirt blend end distance from road (default 80)
	patchNoiseStrength?: number; // how strongly noise2 breaks up farDirt (default 0.7)
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
		grassTint: [0.85, 1.0, 0.8],
		dirtTint: [0.95, 0.9, 0.85],
		rockTint: [0.9, 0.9, 0.92],
		roadTint: [0.95, 0.95, 0.95],
		roadRoughnessBase: 0.85,
		concreteSlab: {
			texture: "/textures/path/Pathway004_1K-JPG",
			tint: [0.55, 0.52, 0.48],
			earthColor: [0.38, 0.33, 0.25],
			dropMax: 0.15,
		},
		treeTypes: [
			"tree_pineTallA",
			"tree_pineTallB",
			"tree_pineDefaultB",
			"tree_broadA",
			"tree_broadB",
		],
		grassTypes: ["grass", "grass_large"],
		treeDensity: 1.0,
		grassDensity: 1.0,
		rockDensity: 1.0,
		fogColor: [0.75, 0.82, 0.78],
		fogNear: 400,
		fogFar: 1800,
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
		grassTint: [1.15, 0.9, 0.65],
		dirtTint: [1.1, 0.85, 0.65],
		rockTint: [0.95, 0.88, 0.75],
		roadTint: [1.0, 0.92, 0.85],
		roadRoughnessBase: 0.9,
		concreteSlab: {
			texture: "/textures/dirt/Ground015_1K-JPG",
			tint: [0.7, 0.58, 0.45],
			earthColor: [0.45, 0.35, 0.22],
			dropMax: 0.12,
		},
		treeTypes: ["tree_broadA", "tree_broadB", "tree_broadC", "tree_deadA", "tree_pineTallA"],
		grassTypes: ["grass" as SceneryType],
		treeDensity: 0.85,
		grassDensity: 0.7,
		rockDensity: 1.2,
		fogColor: [0.85, 0.78, 0.65],
		fogNear: 350,
		fogFar: 1600,
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
		grassTint: [1.15, 1.0, 0.75],
		dirtTint: [1.2, 1.05, 0.8],
		rockTint: [1.2, 0.9, 0.7],
		roadTint: [1.05, 0.95, 0.82],
		roadRoughnessBase: 0.95,
		treeTypes: ["tree_deadA", "tree_deadB", "tree_twistedA"],
		concreteSlab: {
			texture: "/textures/sand_desert/Ground092A_1K-JPG",
			tint: [1.05, 0.92, 0.72],
			earthColor: [0.85, 0.72, 0.52],
			dropMax: 0.08,
		},
		grassTypes: ["grass_wispy" as SceneryType],
		treeDensity: 0.15,
		grassDensity: 0.1,
		rockDensity: 2.5,
		fogColor: [0.9, 0.82, 0.68],
		fogNear: 300,
		fogFar: 1400,
		skyTurbidity: 10,
		skyRayleigh: 1,
		noiseAmp: 80,
		mountainAmplifier: 5,
	},
	{
		name: "Alpine Meadow",
		textures: {
			grass: "/textures/gravel/Gravel015_1K-JPG", // rocky alpine ground, not grass
			dirt: "/textures/rock_gray/Rock010_1K-JPG",
			rock: "/textures/rock_mossy/Rock011_1K-JPG",
			snow: "/textures/snow/Snow_Procedural",
			moss: "/textures/rock_dark/Rock031_1K-JPG", // dark rock for variety
		},
		snowThreshold: 40,
		rockThreshold: 0.5,
		grassTint: [0.65, 0.62, 0.58], // gray-brown rocky ground
		dirtTint: [0.55, 0.53, 0.5],
		rockTint: [0.6, 0.58, 0.55],
		snowTint: [1.06, 1.06, 1.1],
		roadTint: [0.85, 0.87, 0.92],
		roadRoughnessBase: 0.8,
		roadSnowOverlay: { amount: 0.65, color: [0.92, 0.93, 0.97] },
		concreteSlab: {
			texture: "/textures/gravel/Gravel015_1K-JPG",
			tint: [0.65, 0.63, 0.6],
			earthColor: [0.5, 0.48, 0.45],
			dropMax: 0.2,
		},
		treeTypes: [
			"tree_pineTallA",
			"tree_pineTallB",
			"tree_pineTallC",
			"tree_pineTallD",
			"tree_pineDefaultB",
			"tree_pineSmallA",
			"tree_pineSmallB",
		],
		grassTypes: [], // no grass in alpine — it's rocks and snow
		treeDensity: 0.9,
		grassDensity: 0.0,
		rockDensity: 2.0,
		fogColor: [0.72, 0.78, 0.85],
		fogNear: 250,
		fogFar: 1200,
		skyTurbidity: 2,
		skyRayleigh: 1.5,
		noiseAmp: 70,
		mountainAmplifier: 6,
		texRepeat: 600, // tighter tiling to hide repeats
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
		grassTint: [0.82, 1.1, 0.78],
		dirtTint: [0.8, 0.92, 0.7],
		rockTint: [0.82, 0.95, 0.78],
		roadTint: [0.88, 0.92, 0.85],
		roadRoughnessBase: 0.75,
		concreteSlab: {
			texture: "/textures/forest_floor/Ground012_1K-JPG",
			tint: [0.6, 0.72, 0.48],
			earthColor: [0.35, 0.42, 0.25],
			dropMax: 0.1,
		},
		treeTypes: ["tree_broadA", "tree_broadB", "tree_broadC", "tree_broadD", "tree_twistedA"],
		grassTypes: ["grass_large", "grass_wispy" as SceneryType],
		treeDensity: 1.5,
		grassDensity: 1.4,
		rockDensity: 0.6,
		fogColor: [0.72, 0.82, 0.7],
		fogNear: 250,
		fogFar: 1200,
		skyTurbidity: 5,
		skyRayleigh: 3,
		noiseAmp: 45,
		mountainAmplifier: 3,
	},
	{
		name: "Rural Countryside",
		textures: {
			grass: "/textures/grass_moss/Grass007_1K-JPG", // mossy grass — rich varied greens
			dirt: "/textures/forest_floor/Ground012_1K-JPG", // forest floor — dark earthy tones
			rock: "/textures/rock_mossy/Rock011_1K-JPG", // mossy rocks
			snow: "/textures/gravel/Gravel015_1K-JPG", // gravel patches mixed into grass
			moss: "/textures/moss/Moss002_1K-JPG", // deep moss
		},
		snowThreshold: 70,
		rockThreshold: 0.5,
		grassTint: [0.85, 0.95, 0.72],
		dirtTint: [0.82, 0.78, 0.68],
		rockTint: [0.8, 0.8, 0.76],
		roadRoughnessBase: 0.88,
		snowTint: [0.8, 0.78, 0.72], // gravel tint (snow slot = gravel for this biome)
		roadTint: [0.88, 0.88, 0.86],
		concreteSlab: {
			texture: "/textures/path/Pathway004_1K-JPG",
			tint: [0.58, 0.55, 0.48],
			earthColor: [0.4, 0.38, 0.28],
			dropMax: 0.15,
		},
		treeTypes: ["tree_broadA", "tree_broadB", "tree_broadC", "tree_pineDefaultB", "tree_pineTallA"],
		grassTypes: ["grass", "grass_large", "grass_wispy"],
		bushTypes: ["bush_common", "bush_flowers", "bush_flowers"],
		treeDensity: 1.2,
		grassDensity: 3.0,
		rockDensity: 0.8,
		fogColor: [0.82, 0.85, 0.8],
		fogNear: 450,
		fogFar: 1800,
		skyTurbidity: 3,
		skyRayleigh: 1.5,
		noiseAmp: 40,
		mountainAmplifier: 2,
		exposureMult: 0.85,
		// Blend: mostly grass with scattered dirt/rock patches
		mossRange: 30, // moss extends 30m from road
		dirtNearDist: -5, // only show below-dirt when well below road
		dirtFarDist: -30, // stronger fade for below-dirt
		farDirtStart: 200, // far dirt only at extreme distances
		farDirtEnd: 400, // gradual fade to far dirt
		patchNoiseStrength: 0.9, // strong noise breakup on far dirt
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
