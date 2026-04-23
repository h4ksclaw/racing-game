/**
 * Procedural scenery generators — creates Three.js geometry for trees,
 * rocks, grass, and other scenery items without external model files.
 *
 * These are registered into the decorationCache in scenery.ts as fallbacks
 * when GLB models aren't available.
 */

import * as THREE from "three";

// ── Color palettes per biome ────────────────────────────────────────────

export interface BiomeColors {
	trunk: number;
	leaf: number;
	leafAlt: number;
	rock: number;
	rockAlt: number;
	grass: number;
	grassAlt: number;
	stump: number;
	mushroomCap: number;
	mushroomStem: number;
	log: number;
	pumpkin: number;
}

const PALETTES: Record<string, BiomeColors> = {
	"Temperate Forest": {
		trunk: 0x5c3a1e,
		leaf: 0x2d6e2d,
		leafAlt: 0x1f5c1f,
		rock: 0x6b6b6b,
		rockAlt: 0x7a7a6e,
		grass: 0x3a8a3a,
		grassAlt: 0x2f7a2f,
		stump: 0x6b4226,
		mushroomCap: 0xcc3333,
		mushroomStem: 0xeeddcc,
		log: 0x6b4226,
		pumpkin: 0xe67e22,
	},
	"Autumn Woods": {
		trunk: 0x5c3a1e,
		leaf: 0xcc7722,
		leafAlt: 0xbb3311,
		rock: 0x6b6b6b,
		rockAlt: 0x7a7a6e,
		grass: 0x8a8a3a,
		grassAlt: 0x9a7a2a,
		stump: 0x6b4226,
		mushroomCap: 0xcc3333,
		mushroomStem: 0xeeddcc,
		log: 0x6b4226,
		pumpkin: 0xe67e22,
	},
	"Desert Canyon": {
		trunk: 0x7a5c3a,
		leaf: 0x5a8a3a,
		leafAlt: 0x4a7a2a,
		rock: 0x9a8a6e,
		rockAlt: 0xb09a7a,
		grass: 0x8a8a5a,
		grassAlt: 0x7a7a4a,
		stump: 0x7a5c3a,
		mushroomCap: 0xbb6633,
		mushroomStem: 0xddccaa,
		log: 0x7a5c3a,
		pumpkin: 0xd67a1a,
	},
	"Alpine Meadow": {
		trunk: 0x4a3a2a,
		leaf: 0x2a6a4a,
		leafAlt: 0x1a5a3a,
		rock: 0x8a8a8a,
		rockAlt: 0x9a9a9a,
		grass: 0x4a8a4a,
		grassAlt: 0x3a7a3a,
		stump: 0x5a3a2a,
		mushroomCap: 0xcc3333,
		mushroomStem: 0xeeddcc,
		log: 0x5a3a2a,
		pumpkin: 0xe67e22,
	},
	"Tropical Jungle": {
		trunk: 0x4a3018,
		leaf: 0x1a8a2a,
		leafAlt: 0x0a7a1a,
		rock: 0x5a6a5a,
		rockAlt: 0x6a7a6a,
		grass: 0x2a9a3a,
		grassAlt: 0x1a8a2a,
		stump: 0x4a3018,
		mushroomCap: 0xdd5522,
		mushroomStem: 0xeecc99,
		log: 0x4a3018,
		pumpkin: 0xe67e22,
	},
	"Rural Countryside": {
		trunk: 0x5c3a1e,
		leaf: 0x4a8a3a,
		leafAlt: 0x3a7a2a,
		rock: 0x7a7a6e,
		rockAlt: 0x8a8a7e,
		grass: 0x4a9a4a,
		grassAlt: 0x3a8a3a,
		stump: 0x6b4226,
		mushroomCap: 0xcc3333,
		mushroomStem: 0xeeddcc,
		log: 0x6b4226,
		pumpkin: 0xe67e22,
	},
};

/** Get the color palette for procedural scenery generation in a given biome. */
export function getPalette(biomeName: string): BiomeColors {
	return PALETTES[biomeName] ?? PALETTES["Temperate Forest"];
}

// ── Material cache ──────────────────────────────────────────────────────

const matCache = new Map<string, THREE.MeshLambertMaterial>();

function mat(color: number, opts?: Partial<THREE.MeshLambertMaterialParameters>): THREE.MeshLambertMaterial {
	const key = `${color}-${JSON.stringify(opts ?? {})}`;
	let m = matCache.get(key);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color, ...opts });
		matCache.set(key, m);
	}
	return m;
}

// ── Tree generators ─────────────────────────────────────────────────────

/** Pine tree — cone canopy + tapered trunk. Models built at GLB-scale (small), multiplied by GLB_SCALE=8 at render. */
function createPineTree(palette: BiomeColors, tall: boolean, variant: number): THREE.Group {
	const g = new THREE.Group();
	const height = tall ? 0.3 + variant * 0.04 : 0.15 + variant * 0.02;
	const canopyR = tall ? 0.1 + variant * 0.012 : 0.06 + variant * 0.01;
	const trunkR = 0.015 + variant * 0.003;

	// Trunk — tapered cylinder
	const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, height * 0.5, 6);
	const trunk = new THREE.Mesh(trunkGeo, mat(palette.trunk));
	trunk.position.y = height * 0.25;
	trunk.castShadow = true;
	g.add(trunk);

	// Canopy — layered cones for a pine look
	const layers = tall ? 3 : 2;
	for (let i = 0; i < layers; i++) {
		const layerH = (height * 0.4) / layers;
		const layerR = canopyR * (1 - i * 0.2);
		const coneGeo = new THREE.ConeGeometry(layerR, layerH, 7);
		const cone = new THREE.Mesh(coneGeo, mat(i % 2 === 0 ? palette.leaf : palette.leafAlt));
		cone.position.y = height * 0.45 + i * layerH * 0.6;
		cone.castShadow = true;
		g.add(cone);
	}

	return g;
}

/** Default/broad tree — sphere canopy */
function createDefaultTree(palette: BiomeColors, variant: number): THREE.Group {
	const g = new THREE.Group();
	const height = 0.22 + variant * 0.025;
	const canopyR = 0.11 + variant * 0.012;
	const trunkR = 0.015;

	// Trunk
	const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, height * 0.55, 6);
	const trunk = new THREE.Mesh(trunkGeo, mat(palette.trunk));
	trunk.position.y = height * 0.275;
	trunk.castShadow = true;
	g.add(trunk);

	// Canopy — slightly squashed sphere + a second smaller one offset for organic look
	const mainGeo = new THREE.SphereGeometry(canopyR, 7, 5);
	const main = new THREE.Mesh(mainGeo, mat(palette.leaf));
	main.position.y = height * 0.65;
	main.scale.y = 0.85;
	main.castShadow = true;
	g.add(main);

	// Secondary canopy blob
	const subGeo = new THREE.SphereGeometry(canopyR * 0.6, 6, 4);
	const sub = new THREE.Mesh(subGeo, mat(palette.leafAlt));
	sub.position.set(canopyR * 0.3, height * 0.75, canopyR * 0.2);
	sub.castShadow = true;
	g.add(sub);

	return g;
}

// ── Rock generators ─────────────────────────────────────────────────────

function createRock(palette: BiomeColors, large: boolean, variant: number): THREE.Group {
	const g = new THREE.Group();
	const size = large ? 0.06 + variant * 0.018 : 0.03 + variant * 0.01;

	// Dodecahedron with slight distortion for natural look
	const geo = new THREE.DodecahedronGeometry(size, 0);
	const posAttr = geo.attributes.position;
	for (let i = 0; i < posAttr.count; i++) {
		const x = posAttr.getX(i);
		const y = posAttr.getY(i);
		const z = posAttr.getZ(i);
		const noise = 0.85 + Math.sin(x * 5 + variant) * 0.1 + Math.cos(z * 7 + variant) * 0.1;
		posAttr.setXYZ(i, x * noise, y * (large ? 0.7 : 0.6) * noise, z * noise);
	}
	posAttr.needsUpdate = true;
	geo.computeVertexNormals();

	const rock = new THREE.Mesh(geo, mat(variant % 2 === 0 ? palette.rock : palette.rockAlt));
	rock.position.y = size * 0.3;
	rock.rotation.set(variant * 0.5, variant * 1.3, variant * 0.8);
	rock.castShadow = true;
	g.add(rock);

	return g;
}

// ── Grass generators ────────────────────────────────────────────────────

function createGrass(palette: BiomeColors, large: boolean): THREE.Group {
	const g = new THREE.Group();
	const blades = large ? 8 : 5;
	const height = large ? 0.05 : 0.025;

	for (let i = 0; i < blades; i++) {
		const angle = (i / blades) * Math.PI * 2;
		const spread = large ? 0.018 : 0.01;
		const bladeGeo = new THREE.PlaneGeometry(0.04, height * (0.7 + Math.random() * 0.3));
		const blade = new THREE.Mesh(
			bladeGeo,
			mat(i % 2 === 0 ? palette.grass : palette.grassAlt, {
				side: THREE.DoubleSide,
			}),
		);
		blade.position.set(Math.cos(angle) * spread, height * 0.5, Math.sin(angle) * spread);
		blade.rotation.y = angle;
		blade.rotation.x = (Math.random() - 0.5) * 0.3;
		g.add(blade);
	}

	return g;
}

// ── Forest floor details ────────────────────────────────────────────────

function createStump(palette: BiomeColors, variant: number): THREE.Group {
	const g = new THREE.Group();
	const r = 0.025 + variant * 0.006;
	const h = 0.018 + variant * 0.004;

	const stumpGeo = new THREE.CylinderGeometry(r * 0.9, r, h, 8);
	const stump = new THREE.Mesh(stumpGeo, mat(palette.stump));
	stump.position.y = h * 0.5;
	stump.castShadow = true;
	g.add(stump);

	// Top rings
	const topGeo = new THREE.CylinderGeometry(r * 0.7, r * 0.9, 0.02, 8);
	const top = new THREE.Mesh(topGeo, mat(palette.log));
	top.position.y = h;
	g.add(top);

	return g;
}

function createMushroom(palette: BiomeColors): THREE.Group {
	const g = new THREE.Group();

	const stemGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.018, 6);
	const stem = new THREE.Mesh(stemGeo, mat(palette.mushroomStem));
	stem.position.y = 0.009;
	g.add(stem);

	const capGeo = new THREE.SphereGeometry(0.012, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.6);
	const cap = new THREE.Mesh(capGeo, mat(palette.mushroomCap));
	cap.position.y = 0.017;
	g.add(cap);

	// White spots
	for (let i = 0; i < 3; i++) {
		const spotGeo = new THREE.CircleGeometry(0.003, 5);
		const spot = new THREE.Mesh(spotGeo, mat(0xffffff));
		const a = (i / 3) * Math.PI * 2 + 0.5;
		spot.position.set(Math.cos(a) * 0.008, 0.021, Math.sin(a) * 0.008);
		spot.lookAt(spot.position.x * 2, 0.025, spot.position.z * 2);
		g.add(spot);
	}

	return g;
}

function createLog(palette: BiomeColors): THREE.Group {
	const g = new THREE.Group();
	const geo = new THREE.CylinderGeometry(0.015, 0.018, 0.1, 8);
	const log = new THREE.Mesh(geo, mat(palette.log));
	log.position.y = 0.015;
	log.rotation.z = Math.PI * 0.5;
	log.rotation.y = 0.3;
	log.castShadow = true;
	g.add(log);

	// Cut end — lighter circle
	const endGeo = new THREE.CircleGeometry(0.015, 8);
	const end = new THREE.Mesh(endGeo, mat(palette.stump));
	end.position.set(0.05, 0.015, 0);
	end.rotation.y = Math.PI * 0.5;
	g.add(end);

	return g;
}

function createPumpkin(): THREE.Group {
	const g = new THREE.Group();
	const bodyGeo = new THREE.SphereGeometry(0.018, 8, 6);
	const body = new THREE.Mesh(bodyGeo, mat(0xe67e22));
	body.position.y = 0.015;
	body.scale.y = 0.8;
	body.castShadow = true;
	g.add(body);

	// Ridges
	for (let i = 0; i < 4; i++) {
		const ridgeGeo = new THREE.BoxGeometry(0.001, 0.027, 0.035);
		const ridge = new THREE.Mesh(ridgeGeo, mat(0xd35400));
		const a = (i / 4) * Math.PI;
		ridge.position.set(Math.cos(a) * 0.01, 0.015, Math.sin(a) * 0.01);
		ridge.rotation.y = a;
		g.add(ridge);
	}

	// Stem
	const stemGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.007, 4);
	const stem = new THREE.Mesh(stemGeo, mat(0x27ae60));
	stem.position.y = 0.032;
	g.add(stem);

	return g;
}

// ── Master registry ─────────────────────────────────────────────────────

export type SceneryType =
	| "tree_pineTallA"
	| "tree_pineTallB"
	| "tree_pineTallC"
	| "tree_pineTallD"
	| "tree_pineSmallA"
	| "tree_pineSmallB"
	| "tree_pineSmallC"
	| "tree_pineSmallD"
	| "tree_pineDefaultB"
	| "rock_tallA"
	| "rock_tallB"
	| "rock_tallC"
	| "rock_tallD"
	| "rock_tallE"
	| "rock_tallF"
	| "rock_tallG"
	| "rock_tallH"
	| "rock_tallI"
	| "rock_tallJ"
	| "stone_tallC"
	| "stone_tallD"
	| "stone_tallE"
	| "stone_tallF"
	| "stone_tallG"
	| "stone_tallH"
	| "stone_tallI"
	| "stone_tallJ"
	| "grass"
	| "grass_large"
	| "stump_old"
	| "stump_round"
	| "stump_square"
	| "mushroom_red"
	| "crop_pumpkin"
	| "log_large";

/**
 * Build all procedural scenery models for a given biome and inject them
 * into the decoration cache. Returns the populated cache.
 */
/** Build procedural tree, rock, and grass geometry for a biome. Caches results by type. */
export function buildProceduralScenery(biomeName: string, cache: Map<string, THREE.Group>): void {
	const palette = getPalette(biomeName);

	// Pine trees (tall variants A-D)
	cache.set("tree_pineTallA", createPineTree(palette, true, 0));
	cache.set("tree_pineTallB", createPineTree(palette, true, 1));
	cache.set("tree_pineTallC", createPineTree(palette, true, 2));
	cache.set("tree_pineTallD", createPineTree(palette, true, 3));

	// Pine trees (small variants A-D)
	cache.set("tree_pineSmallA", createPineTree(palette, false, 0));
	cache.set("tree_pineSmallB", createPineTree(palette, false, 1));
	cache.set("tree_pineSmallC", createPineTree(palette, false, 2));
	cache.set("tree_pineSmallD", createPineTree(palette, false, 3));

	// Default broad tree
	cache.set("tree_pineDefaultB", createDefaultTree(palette, 0));

	// Large rocks (A-J)
	for (let i = 0; i < 10; i++) {
		const letter = String.fromCharCode(65 + i);
		cache.set(`rock_tall${letter}`, createRock(palette, true, i));
	}

	// Small stones (C-J)
	for (let i = 2; i < 10; i++) {
		const letter = String.fromCharCode(65 + i);
		cache.set(`stone_tall${letter}`, createRock(palette, false, i));
	}

	// Grass
	cache.set("grass", createGrass(palette, false));
	cache.set("grass_large", createGrass(palette, true));

	// Stumps
	cache.set("stump_old", createStump(palette, 0));
	cache.set("stump_round", createStump(palette, 1));
	cache.set("stump_square", createStump(palette, 2));

	// Mushroom
	cache.set("mushroom_red", createMushroom(palette));

	// Log
	cache.set("log_large", createLog(palette));

	// Pumpkin
	cache.set("crop_pumpkin", createPumpkin());
}
