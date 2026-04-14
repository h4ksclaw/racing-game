import type { SceneryItem } from "@shared/track.ts";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildProceduralScenery } from "./procedural-scenery.ts";
import { state } from "./scene.ts";
import type { TerrainSampler } from "./terrain.ts";

// ── Decoration model cache ──────────────────────────────────────────────

const decorationCache = new Map<string, THREE.Group>();
let decorationsLoaded = false;

/** Per-model scale overrides (multiply with item.scale). Nature kit models are ~5-15 units tall. */
const MODEL_SCALE: Record<string, number> = {
	// Pines → tall trees (models ~7-10 units → want ~10-14m in-game)
	tree_pineTallA: 1.5,
	tree_pineTallB: 1.5,
	tree_pineTallC: 1.5,
	tree_pineTallD: 1.5,
	// Small pines (models ~7-10 units → want ~5-7m in-game)
	tree_pineSmallA: 0.8,
	tree_pineSmallB: 0.8,
	tree_pineSmallC: 0.8,
	tree_pineSmallD: 0.8,
	// Broadleaf trees (models ~6-8 units → want ~8-10m)
	tree_pineDefaultB: 1.3,
	tree_broadA: 1.3,
	tree_broadB: 1.3,
	tree_broadC: 1.1,
	tree_broadD: 1.5,
	// Dead trees (models ~9-16 units → want ~6-10m)
	tree_deadA: 0.7,
	tree_deadB: 0.6,
	// Twisted trees (models ~15-18 units → want ~6-8m)
	tree_twistedA: 0.5,
	tree_twistedB: 0.5,
	// Bushes (models ~2 units → want ~2-3m)
	bush_common: 1.5,
	bush_flowers: 1.5,
	// Rocks (models ~2-3 units → want ~2-4m)
	rock_tallA: 1.2,
	rock_tallB: 1.0,
	rock_tallC: 1.1,
	rock_tallD: 0.9,
	rock_tallE: 1.3,
	rock_tallF: 1.0,
	rock_tallG: 1.1,
	rock_tallH: 0.9,
	rock_tallI: 1.2,
	rock_tallJ: 1.0,
	// Stones (models ~2-3 units → want ~1-2m)
	stone_tallC: 0.6,
	stone_tallD: 0.7,
	stone_tallE: 0.6,
	stone_tallF: 0.8,
	stone_tallG: 0.6,
	stone_tallH: 0.7,
	stone_tallI: 0.6,
	stone_tallJ: 0.8,
	// Grass (models ~1-2 units → want ~1-2m)
	grass: 1.0,
	grass_large: 1.2,
	grass_wispy: 1.0,
	// Stumps, mushrooms, logs
	stump_old: 0.8,
	stump_round: 0.8,
	stump_square: 0.8,
	mushroom_red: 0.8,
	log_large: 1.0,
	crop_pumpkin: 0.8,
};

/** Default scale for models not in MODEL_SCALE */
const DEFAULT_MODEL_SCALE = 1.2;

let fallbackBiomeName = "Temperate Forest";
let currentLightModel: string | null = null;
const lightModelCache = new Map<string, THREE.Group>();
const LIGHT_MODEL_SCALE = 7;

export function setFallbackBiome(biomeName: string): void {
	fallbackBiomeName = biomeName;
}

export function setLightModel(modelPath: string | undefined): void {
	currentLightModel = modelPath ?? null;
}

export function loadLightModel(loader: GLTFLoader, path: string): Promise<void> {
	return new Promise((resolve) => {
		if (lightModelCache.has(path)) {
			resolve();
			return;
		}
		loader.load(
			path,
			(gltf) => {
				const scene = gltf.scene;

				// If the model has a baked root translation, negate it so base sits at origin.
				// Custom models (e.g. lightPost_exclusive v2) are already centered — skip.
				const bakedT = scene.position;
				if (bakedT.x !== 0 || bakedT.y !== 0 || bakedT.z !== 0) {
					scene.position.set(-bakedT.x, -bakedT.y, -bakedT.z);
				}

				lightModelCache.set(path, scene);
				resolve();
			},
			undefined,
			() => resolve(),
		);
	});
}

// ── Quaternius Nature Kit → SceneryType mapping ─────────────────────────

const NATURE_KIT_BASE = "/models/naturekit/glTF";

/**
 * Maps our internal SceneryType names to nature kit glTF files.
 * Multiple scenery types can share one model (with different scale/rotation).
 */
const NATURE_KIT_MAP: Record<string, string> = {
	// Pines (5 variants) — cycle through for A-D variants
	tree_pineTallA: "Pine_1",
	tree_pineTallB: "Pine_2",
	tree_pineTallC: "Pine_3",
	tree_pineTallD: "Pine_4",
	tree_pineSmallA: "Pine_5",
	tree_pineSmallB: "Pine_1",
	tree_pineSmallC: "Pine_2",
	tree_pineSmallD: "Pine_3",
	// Broadleaf trees
	tree_pineDefaultB: "CommonTree_1",
	// Rocks
	rock_tallA: "Rock_Medium_1",
	rock_tallB: "Rock_Medium_2",
	rock_tallC: "Rock_Medium_3",
	rock_tallD: "Rock_Medium_1",
	rock_tallE: "Rock_Medium_2",
	rock_tallF: "Rock_Medium_3",
	rock_tallG: "Rock_Medium_1",
	rock_tallH: "Rock_Medium_2",
	rock_tallI: "Rock_Medium_3",
	rock_tallJ: "Rock_Medium_1",
	// Stones (pebbles)
	stone_tallC: "Pebble_Round_1",
	stone_tallD: "Pebble_Round_2",
	stone_tallE: "Pebble_Round_3",
	stone_tallF: "Pebble_Round_4",
	stone_tallG: "Pebble_Round_5",
	stone_tallH: "Pebble_Square_1",
	stone_tallI: "Pebble_Square_2",
	stone_tallJ: "Pebble_Square_3",
	// Grass
	grass: "Grass_Common_Short",
	grass_large: "Grass_Common_Tall",
	// Stumps
	stump_old: "RockPath_Round_Small_1",
	stump_round: "RockPath_Round_Small_2",
	stump_square: "RockPath_Square_Small_1",
	// Mushroom
	mushroom_red: "Mushroom_Common",
	// Log
	log_large: "RockPath_Round_Wide",
	// Pumpkin
	crop_pumpkin: "Mushroom_Laetiporus",
};

/**
 * Additional models to load beyond the mapped ones — for future use
 * and to have variety available.
 */
const EXTRA_MODELS = [
	"CommonTree_2",
	"CommonTree_3",
	"CommonTree_4",
	"CommonTree_5",
	"DeadTree_1",
	"DeadTree_2",
	"DeadTree_3",
	"TwistedTree_1",
	"TwistedTree_2",
	"TwistedTree_3",
	"Bush_Common",
	"Bush_Common_Flowers",
	"Fern_1",
	"Clover_1",
	"Clover_2",
	"Flower_3_Group",
	"Flower_4_Group",
	"Plant_1",
	"Plant_7",
	"Grass_Wispy_Short",
	"Grass_Wispy_Tall",
	"Petal_1",
	"Petal_2",
	"Petal_3",
	"RockPath_Round_Thin",
	"RockPath_Square_Thin",
	"Pebble_Round_1",
	"Pebble_Square_1",
];

export async function loadDecorations(): Promise<void> {
	if (decorationsLoaded) return;
	decorationsLoaded = true;

	const loader = new GLTFLoader();

	// Collect unique model files to load
	const modelsToLoad = new Set<string>();
	for (const gltfFile of Object.values(NATURE_KIT_MAP)) {
		modelsToLoad.add(gltfFile);
	}
	for (const m of EXTRA_MODELS) {
		modelsToLoad.add(m);
	}

	const pending = modelsToLoad.size;
	let loaded = 0;

	const promise = new Promise<void>((resolve) => {
		for (const modelName of modelsToLoad) {
			const url = `${NATURE_KIT_BASE}/${modelName}.gltf`;
			loader.load(
				url,
				(gltf) => {
					// Cache the model under its original name
					const group = gltf.scene;
					group.name = modelName;
					decorationCache.set(modelName, group);

					// Also map to scenery types
					for (const [sceneryType, gltfName] of Object.entries(NATURE_KIT_MAP)) {
						if (gltfName === modelName && !decorationCache.has(sceneryType)) {
							const clone = group.clone() as THREE.Group;
							clone.name = sceneryType;
							decorationCache.set(sceneryType, clone);
						}
					}

					loaded++;
					if (loaded === pending) {
						console.log(
							`Nature Kit: loaded ${loaded} models, ${decorationCache.size} cache entries`,
						);
						resolve();
					}
				},
				undefined,
				(error) => {
					console.warn(`Failed to load nature kit model ${modelName}:`, error);
					loaded++;
					if (loaded === pending) {
						// If nothing loaded, try Kenney fallback then procedural
						if (decorationCache.size === 0) {
							console.log("Nature Kit failed, trying Kenney GLB fallback");
							loadKenneyFallback(loader).then(resolve);
						} else {
							resolve();
						}
					}
				},
			);
		}
	});

	return promise;
}

/** Fallback: try loading the old Kenney GLB files */
function loadKenneyFallback(loader: GLTFLoader): Promise<void> {
	let pending = 2;
	return new Promise((resolve) => {
		const done = () => {
			if (--pending === 0) {
				if (decorationCache.size === 0) {
					console.log("Kenney GLB also failed, using procedural fallback");
					buildProceduralScenery(fallbackBiomeName, decorationCache);
				}
				console.log(`Fallback: loaded ${decorationCache.size} decoration models`);
				resolve();
			}
		};

		function loadGLB(url: string) {
			loader.load(
				url,
				(gltf) => {
					gltf.scene.traverse((node) => {
						if (!node.name || !(node instanceof THREE.Object3D)) return;
						const baseName = node.name.replace(/\.\d+$/, "");
						if (!decorationCache.has(baseName)) {
							const clone = node.clone() as THREE.Group;
							clone.name = baseName;
							decorationCache.set(baseName, clone);
						}
					});
					done();
				},
				undefined,
				(error) => {
					console.error(`Failed to load ${url}:`, error);
					done();
				},
			);
		}

		loadGLB("/models/maps/map1/decorations.glb");
		loadGLB("/models/maps/map1/gates.glb");
	});
}

export function buildInstancedScenery(
	scenery: SceneryItem[],
	terrain: TerrainSampler,
): THREE.Group {
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();

	const byType = new Map<string, SceneryItem[]>();
	for (const item of scenery) {
		if (item.type === "barrier") continue;
		let arr = byType.get(item.type);
		if (!arr) {
			arr = [];
			byType.set(item.type, arr);
		}
		arr.push(item);
	}

	for (const [type, items] of byType) {
		if (items.length < 3) {
			for (const item of items) {
				const obj = createSceneryObject(item, terrain);
				if (obj) group.add(obj);
			}
			continue;
		}

		const cached = decorationCache.get(type);
		if (cached) {
			const meshEntries: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] =
				[];
			cached.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					meshEntries.push({ geo: child.geometry, mat: child.material });
				}
			});

			if (meshEntries.length === 0) {
				for (const item of items) {
					const obj = createSceneryObject(item, terrain);
					if (obj) group.add(obj);
				}
				continue;
			}

			const typeScale = MODEL_SCALE[type] ?? DEFAULT_MODEL_SCALE;

			for (const entry of meshEntries) {
				const instanced = new THREE.InstancedMesh(entry.geo, entry.mat, items.length);
				instanced.castShadow = true;
				instanced.receiveShadow = false;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const scale = typeScale * (item.scale ?? 1);
					const tY = terrain.getHeight(item.position.x, item.position.z);
					dummy.position.set(item.position.x, tY, item.position.z);
					dummy.rotation.set(0, item.rotation ?? 0, 0);
					dummy.scale.setScalar(scale);
					dummy.updateMatrix();
					instanced.setMatrixAt(i, dummy.matrix);
				}
				instanced.instanceMatrix.needsUpdate = true;
				group.add(instanced);
			}
		} else {
			for (const item of items) {
				const obj = createSceneryObject(item, terrain);
				if (obj) group.add(obj);
			}
		}
	}

	return group;
}

function createSceneryObject(item: SceneryItem, terrain: TerrainSampler): THREE.Group | null {
	const cached = decorationCache.get(item.type);
	if (cached) {
		const obj = cached.clone();
		const typeScale = MODEL_SCALE[item.type] ?? DEFAULT_MODEL_SCALE;
		obj.scale.setScalar(typeScale * (item.scale ?? 1));
		const tY = terrain.getHeight(item.position.x, item.position.z);
		obj.position.set(item.position.x, tY, item.position.z);
		obj.rotation.y = item.rotation ?? 0;
		return obj;
	}

	const group = new THREE.Group();
	const tY = terrain.getHeight(item.position.x, item.position.z);
	group.position.set(item.position.x, tY, item.position.z);

	switch (item.type) {
		case "barrier": {
			const barrier = new THREE.Mesh(
				new THREE.BoxGeometry(0.5, 1.5, 3),
				new THREE.MeshLambertMaterial({ color: 0xcc3333 }),
			);
			barrier.position.y = 0.75;
			group.add(barrier);
			break;
		}
		case "light": {
			// Try GLB model first, fall back to procedural
			let lightUsed = false;
			if (currentLightModel && lightModelCache.has(currentLightModel)) {
				const model = lightModelCache.get(currentLightModel)!.clone();

				// Scale from base
				model.scale.setScalar(LIGHT_MODEL_SCALE);

				const isAutumnWoods = currentLightModel?.includes("lightPost_exclusive");

				// Replace unlit materials with proper PBR MeshStandardMaterial.
				// Material names: Pilar (pole), top (housing), pylon (arm), light_direction (helper cone).
				let lightWorldY = 0;
				let spotOrigin: THREE.Vector3 | null = null;
				let spotDirection: THREE.Vector3 | null = null;
				model.traverse((child) => {
					if (!(child instanceof THREE.Mesh)) return;
					child.castShadow = true;
					const matName = child.material?.name || "";
					const mat = child.material as THREE.MeshStandardMaterial;
					const color = mat.color ? mat.color.clone() : new THREE.Color(0.8, 0.8, 0.8);

					if (matName === "Pilar") {
						// Main pole — dark metallic
						child.material = new THREE.MeshStandardMaterial({
							color: new THREE.Color(0.35, 0.35, 0.37),
							metalness: 0.7,
							roughness: 0.25,
						});
						const box = new THREE.Box3().setFromObject(child);
						if (box.max.y > lightWorldY) lightWorldY = box.max.y;
					} else if (matName === "top") {
						// Light housing — dark metallic with emissive
						child.material = new THREE.MeshStandardMaterial({
							color: 0x888888,
							emissive: 0xffffcc,
							emissiveIntensity: isAutumnWoods ? 0.15 : 0.6,
							metalness: 0.7,
							roughness: 0.3,
						});
						if (!isAutumnWoods) {
							state.lightFixtures.push(child as THREE.Mesh);
						}
						const box = new THREE.Box3().setFromObject(child);
						if (box.max.y > lightWorldY) lightWorldY = box.max.y;
					} else if (matName === "pylon") {
						// Arm bracket — dark metallic with subtle bloom for Autumn Woods
						child.material = new THREE.MeshStandardMaterial({
							color: new THREE.Color(0.35, 0.35, 0.37),
							metalness: 0.7,
							roughness: 0.25,
							emissive: isAutumnWoods ? 0xffffcc : 0x000000,
							emissiveIntensity: 0.2,
						});
						if (isAutumnWoods) {
							child.userData.bloomMult = 0.15;
							state.lightFixtures.push(child as THREE.Mesh);
						}
					} else if (matName === "light_direction") {
						// Direction helper cone — extract direction vector, then hide
						child.visible = false;
						const box = new THREE.Box3().setFromObject(child);
						const center = new THREE.Vector3();
						box.getCenter(center);
						spotOrigin = new THREE.Vector3(box.max.x, box.max.y, box.max.z);
						spotDirection = new THREE.Vector3(
							box.max.x - center.x,
							box.max.y - center.y,
							box.max.z - center.z,
						).normalize();
					} else if (matName === "road") {
						child.material = new THREE.MeshStandardMaterial({
							color: new THREE.Color(0.25, 0.25, 0.25),
							metalness: 0.3,
							roughness: 0.7,
						});
					} else if (matName === "red") {
						child.material = new THREE.MeshStandardMaterial({
							color: new THREE.Color(0.9, 0.3, 0.3),
							emissive: 0xff2200,
							emissiveIntensity: 0.3,
							metalness: 0.4,
							roughness: 0.3,
						});
					} else if (matName === "grass") {
						child.material = new THREE.MeshStandardMaterial({
							color,
							metalness: 0.0,
							roughness: 0.9,
						});
					} else {
						child.material = new THREE.MeshStandardMaterial({
							color,
							metalness: 0.4,
							roughness: 0.5,
						});
					}
				});

				// Orient: arm extends in +Z in local space.
				// item.rotation = tangentAngle ± π/2 (from track.ts)
				// Add π to flip arms inward
				model.rotation.y = (item.rotation ?? 0) + Math.PI;

				group.add(model);

				// Place light at the fixture height
				let light: THREE.Light;
				const lightY = lightWorldY * LIGHT_MODEL_SCALE;
				if (isAutumnWoods && spotDirection) {
					// SpotLight aimed straight down from cone tip
					const spot = new THREE.SpotLight(0xffeeaa, 0, 80, Math.PI / 2, 0.7, 1.5);
					// Place spotlight at cone center (arm tip), aim straight down
					const s = LIGHT_MODEL_SCALE;
					spot.position.set(spotOrigin!.x * s, spotOrigin!.y * s, spotOrigin!.z * s);
					// Aim at ground directly below the cone tip
					spot.target.position.set(spotOrigin!.x * s, 0, spotOrigin!.z * s);
					group.add(spot);
					group.add(spot.target);
					light = spot;
				} else if (isAutumnWoods) {
					// Fallback: SpotLight straight down
					const spot = new THREE.SpotLight(0xffeeaa, 0, 80, Math.PI / 2, 0.7, 1.5);
					spot.position.set(0, lightY, 0);
					spot.target.position.set(0, 0, 0);
					group.add(spot);
					group.add(spot.target);
					light = spot;
				} else {
					const pointLight = new THREE.PointLight(0xffeeaa, 0, 60, 2);
					pointLight.position.set(0, lightY, 0);
					group.add(pointLight);
					light = pointLight;
				}
				state.streetLights.push(light);
				lightUsed = true;
			}
			if (!lightUsed) {
				// Procedural fallback
				const post = new THREE.Mesh(
					new THREE.CylinderGeometry(0.15, 0.15, 5),
					new THREE.MeshLambertMaterial({ color: 0x888888 }),
				);
				post.position.y = 2.5;
				group.add(post);
				const fixture = new THREE.Mesh(
					new THREE.BoxGeometry(1, 0.3, 0.5),
					new THREE.MeshLambertMaterial({
						color: 0xffffcc,
						emissive: 0xffffaa,
						emissiveIntensity: 0.5,
					}),
				);
				fixture.position.y = 5.5;
				group.add(fixture);
				state.lightFixtures.push(fixture);
				const pointLight = new THREE.PointLight(0xffeeaa, 0, 60, 2);
				pointLight.position.y = 5;
				group.add(pointLight);
				state.streetLights.push(pointLight);
			}
			break;
		}
		default:
			return null;
	}
	return group;
}
