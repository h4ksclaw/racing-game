/**
 * Single source of truth for world/scene generation.
 *
 * Both the track viewer and practice mode call buildWorld() to get
 * an identical scene. Thin page-specific shells add their own
 * controls (OrbitControls, vehicle, HUD, etc.) on top.
 *
 * NO scene assembly logic lives in page-specific files.
 */

import type { HouseItem } from "@shared/track.ts";
import { generateHouses, generateScenery, mulberry32 } from "@shared/track.ts";
import * as THREE from "three";
import { getBiomeForSeed } from "./biomes.ts";
import { buildHouses } from "./buildings.ts";
import { initBloom } from "./effects.ts";
import { buildGuardrails, buildMeshes } from "./road.ts";
import { state } from "./scene.ts";
import {
	buildInstancedScenery,
	loadDecorations,
	loadLightModel,
	setFallbackBiome,
	setLightModel,
} from "./scenery.ts";
import { applyTimeOfDay, buildStars, setupSky } from "./sky.ts";
import { buildTerrain, TerrainSampler } from "./terrain.ts";
import type { WorldResponse } from "./utils.ts";
import {
	applyWeather,
	buildCloudLayer,
	buildRainSystem,
	buildSnowSystem,
	setRainVelocities,
	setSnowDrifts,
} from "./weather.ts";

// ── Types ───────────────────────────────────────────────────────────────

export interface WorldOptions {
	/** Override seed (default: from URL or 42) */
	seed?: number;
	/** Time of day 0–24 (default: from URL or 12) */
	hour?: number;
	/** Weather type (default: from URL or "clear") */
	weather?: "clear" | "cloudy" | "rain" | "heavy_rain" | "fog" | "snow";
	/** Pixel ratio cap (default: 1.5) */
	pixelRatioCap?: number;
	/** Shadow map resolution (default: 1024) */
	shadowResolution?: number;
	/** Shadow camera frustum half-extent (default: 200) */
	shadowExtent?: number;
	/** Shadow camera far plane (default: 500) */
	shadowFar?: number;
	/** Enable ACES filmic tone mapping (default: false) */
	toneMapping?: boolean;
}

export interface WorldResult {
	/** The root Three.js scene */
	scene: THREE.Scene;
	/** The terrain height sampler */
	terrain: TerrainSampler;
	/** The camera (positioned at track start) */
	camera: THREE.PerspectiveCamera;
	/** The WebGL renderer (already appended to body) */
	renderer: THREE.WebGLRenderer;
	/** The full track data */
	trackData: WorldResponse;
	/** The biome config used */
	biome: ReturnType<typeof getBiomeForSeed>;
	/** Scenery items placed in the world */
	sceneryCount: number;
	/** Dispose all Three.js resources */
	dispose: () => void;
}

// ── buildWorld ──────────────────────────────────────────────────────────

export async function buildWorld(options: WorldOptions = {}): Promise<WorldResult> {
	const urlParams = new URLSearchParams(window.location.search);

	const seed = options.seed ?? (Number(urlParams.get("seed")) || 42);
	const hour = options.hour ?? (Number(urlParams.get("hour")) || 12);
	const weather =
		options.weather ?? (urlParams.get("weather") as WorldOptions["weather"]) ?? "clear";
	const pixelRatioCap = options.pixelRatioCap ?? 1.5;
	const shadowRes = options.shadowResolution ?? 1024;
	const shadowExtent = options.shadowExtent ?? 200;
	const shadowFar = options.shadowFar ?? 500;
	const useToneMapping = options.toneMapping ?? false;

	state.currentTime = hour;
	state.currentWeather = weather;

	// ── Fetch or generate track data ──
	let trackData: WorldResponse;
	try {
		const resp = await fetch(`/api/world?seed=${seed}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		trackData = await resp.json();
	} catch {
		const gen = (await import("@shared/track.ts")).generateTrack(seed);
		trackData = { ...gen, seed };
	}
	state.worldSamples = trackData.samples;

	// ── Biome ──
	const biome = getBiomeForSeed(seed);
	state.currentBiome = biome;

	// ── Renderer ──
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: "high-performance",
	});
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	if (useToneMapping) {
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
	}
	document.body.appendChild(renderer.domElement);
	state.renderer = renderer;

	// ── Scene ──
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x87ceeb);
	scene.fog = new THREE.Fog(
		new THREE.Color(...biome.fogColor).getHex(),
		biome.fogNear,
		biome.fogFar,
	);
	state.scene = scene;

	// ── Sky ──
	const { uniforms: skyUniforms, mesh: skyMesh } = setupSky(scene);
	state.skyUniforms = skyUniforms;
	state.skyMesh = skyMesh;
	skyUniforms.turbidity.value = biome.skyTurbidity;
	skyUniforms.rayleigh.value = biome.skyRayleigh;

	// ── Lighting ──
	const ambient = new THREE.HemisphereLight(0x88bbff, 0x445511, 0.6);
	scene.add(ambient);
	state.ambient = ambient;

	const sun = new THREE.DirectionalLight(0xffffcc, 1.2);
	sun.position.set(200, 300, 100);
	sun.castShadow = true;
	sun.shadow.mapSize.width = shadowRes;
	sun.shadow.mapSize.height = shadowRes;
	sun.shadow.camera.near = 10;
	sun.shadow.camera.far = shadowFar;
	sun.shadow.camera.left = -shadowExtent;
	sun.shadow.camera.right = shadowExtent;
	sun.shadow.camera.top = shadowExtent;
	sun.shadow.camera.bottom = -shadowExtent;
	scene.add(sun);
	state.sun = sun;

	// ── Stars ──
	state.stars = buildStars();
	scene.add(state.stars);

	// ── Weather particles ──
	const rain = buildRainSystem();
	state.rainSystem = rain.points;
	setRainVelocities(rain.velocities);
	rain.points.visible = false;
	scene.add(rain.points);

	const snow = buildSnowSystem();
	state.snowSystem = snow.points;
	setSnowDrifts(snow.drifts);
	snow.points.visible = false;
	scene.add(snow.points);

	// ── Terrain ──
	const trackMax = trackData.maxExtent ?? 800;
	const worldSize = Math.max(1600, Math.ceil((trackMax * 2 + 200) / 200) * 200);
	const terrain = new TerrainSampler(trackData.seed, trackData.samples, {
		noiseAmp: biome.noiseAmp,
		mountainAmp: biome.mountainAmplifier,
		worldRadius: worldSize / 2,
	});

	// ── Houses (generate before terrain mesh so flatten zones apply) ──
	let houseGroup: THREE.Group | null = null;
	let houseItems: HouseItem[] = [];
	if (biome.houses?.enabled) {
		houseItems = generateHouses(trackData.seed, trackData.samples, biome.houses);
		// Add flatten zones to terrain — use local road Y, not global average
		for (const house of houseItems) {
			const { sample } = terrain.nearestRoad(house.position.x, house.position.z);
			const houseY = sample.point.y;
			terrain.flattenZones.push({
				x: house.position.x,
				z: house.position.z,
				radius: biome.houses.flattenRadius,
				y: houseY,
			});
		}
		houseGroup = buildHouses(houseItems, biome.houses, terrain);
	}

	scene.add(await buildTerrain(trackData, terrain, biome, worldSize));
	if (houseGroup) scene.add(houseGroup);

	// ── Road meshes ──
	const rng = mulberry32(trackData.seed);
	scene.add(await buildMeshes(trackData, rng, biome, terrain.avgRoadY));

	// ── Scenery ──
	setFallbackBiome(biome.name);
	setLightModel(biome.lightModel);
	await loadDecorations();
	if (biome.lightModel) {
		const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
		await loadLightModel(new GLTFLoader(), biome.lightModel);
	}
	const scenery = generateScenery(trackData.seed, trackData.samples, {
		treeTypes: biome.treeTypes,
		grassTypes: biome.grassTypes,
		treeDensity: biome.treeDensity,
		grassDensity: biome.grassDensity,
		rockDensity: biome.rockDensity,
		avoidZones:
			houseItems.length > 0
				? houseItems.map((h) => ({
						x: h.position.x,
						z: h.position.z,
						radius: (biome.houses?.flattenRadius ?? 10) + 2,
					}))
				: undefined,
	});
	scene.add(buildInstancedScenery(scenery, terrain));

	// ── Cloud layer ──
	const clouds = buildCloudLayer();
	state.cloudLayer = clouds;
	scene.add(clouds);
	console.log("[world] cloud layer added to scene, children:", clouds.children.length);

	// ── Guardrails ──
	scene.add(buildGuardrails(trackData.samples, terrain, biome.guardrail));

	// ── Camera ──
	const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1200);
	camera.position.set(
		trackData.samples[0].point.x + 50,
		trackData.samples[0].point.y + 80,
		trackData.samples[0].point.z + 50,
	);
	state.camera = camera;

	// ── Post-processing ──
	initBloom(renderer, scene, camera);

	// ── Apply time + weather ──
	applyTimeOfDay(hour);
	applyWeather(weather);

	// ── Dispose helper ──
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		renderer.domElement.remove();
		scene.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					for (const m of child.material) m.dispose();
				} else {
					child.material.dispose();
				}
			}
		});
		if (state.controls) {
			state.controls.dispose();
			state.controls = null;
		}
		state.scene = null;
		state.camera = null;
		state.sun = null;
		state.ambient = null;
		state.skyUniforms = null;
		state.stars = null;
		state.streetLights = [];
		state.lightFixtures = [];
		state.rainSystem = null;
		state.snowSystem = null;
		state.terrainMaterial = null;
		state.roadMaterial = null;
		state.composer = null;
		state.renderer = null;
	};

	return {
		scene,
		terrain,
		camera,
		renderer,
		trackData,
		biome,
		sceneryCount: scenery.length,
		dispose,
	};
}
