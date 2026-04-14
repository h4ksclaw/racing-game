import { generateScenery, generateTrack, mulberry32 } from "@shared/track.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getBiomeForSeed } from "./biomes.ts";
import { initBloom, updateBloomSize } from "./effects.ts";
import { buildGuardrails, buildMeshes } from "./road.ts";
import { state } from "./scene.ts";
import { buildInstancedScenery, loadDecorations, setFallbackBiome } from "./scenery.ts";
import { applyTimeOfDay, buildStars, setupSky } from "./sky.ts";
import { buildTerrain, TerrainSampler } from "./terrain.ts";
import type { TrackResponse, WeatherType } from "./utils.ts";
import {
	applyWeather,
	buildRainSystem,
	buildSnowSystem,
	setRainVelocities,
	setSnowDrifts,
	updateWeather,
} from "./weather.ts";

// ── Renderer setup ──────────────────────────────────────────────────────

const infoEl = document.getElementById("info");

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
state.renderer = renderer;

let dispose: () => void = () => {};

function clearScene() {
	dispose();
	if (state.controls) state.controls.dispose();
	state.scene = null;
	state.camera = null;
	state.controls = null;
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
}

async function buildScene(data: TrackResponse) {
	clearScene();

	const scene = new THREE.Scene();

	// Biome
	const biome = getBiomeForSeed(data.seed);

	scene.background = new THREE.Color(0x87ceeb);
	scene.fog = new THREE.Fog(
		new THREE.Color(...biome.fogColor).getHex(),
		biome.fogNear,
		biome.fogFar,
	);
	state.scene = scene;

	// Sky
	state.skyUniforms = setupSky(scene);
	state.skyUniforms.turbidity.value = biome.skyTurbidity;
	state.skyUniforms.rayleigh.value = biome.skyRayleigh;

	// Lights
	scene.add(new THREE.HemisphereLight(0x88bbff, 0x445511, 0.6));
	state.ambient = scene.children[scene.children.length - 1] as THREE.HemisphereLight;

	const sun = new THREE.DirectionalLight(0xffffcc, 1.2);
	sun.position.set(200, 300, 100);
	sun.castShadow = true;
	sun.shadow.mapSize.width = 1024;
	sun.shadow.mapSize.height = 1024;
	sun.shadow.camera.near = 10;
	sun.shadow.camera.far = 500;
	sun.shadow.camera.left = -200;
	sun.shadow.camera.right = 200;
	sun.shadow.camera.top = 200;
	sun.shadow.camera.bottom = -200;
	scene.add(sun);
	state.sun = sun;

	// Stars
	state.stars = buildStars();
	scene.add(state.stars);

	// Weather particles
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

	// Terrain
	const trackMax = data.maxExtent ?? 800;
	// World must contain the full track (±trackMax) + padding
	const worldSize = Math.max(1600, Math.ceil((trackMax * 2 + 200) / 200) * 200);
	const terrain = new TerrainSampler(data.seed, data.samples, {
		noiseAmp: biome.noiseAmp,
		mountainAmp: biome.mountainAmplifier,
		worldRadius: worldSize / 2,
	});
	scene.add(await buildTerrain(data, terrain, biome, worldSize));

	// Track meshes
	const rng = mulberry32(data.seed);
	scene.add(await buildMeshes(data, rng, biome));

	// Scenery
	const scenery = generateScenery(data.seed, data.samples, {
		treeTypes: biome.treeTypes,
		grassTypes: biome.grassTypes,
		treeDensity: biome.treeDensity,
		grassDensity: biome.grassDensity,
		rockDensity: biome.rockDensity,
	});
	setFallbackBiome(biome.name);
	await loadDecorations();
	scene.add(buildInstancedScenery(scenery, terrain));

	// Guardrails
	scene.add(buildGuardrails(data.samples, terrain));

	// Camera
	const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1200);
	camera.position.set(
		data.samples[0].point.x + 50,
		data.samples[0].point.y + 80,
		data.samples[0].point.z + 50,
	);
	state.camera = camera;

	// Controls
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.target.set(data.samples[0].point.x, data.samples[0].point.y, data.samples[0].point.z);
	state.controls = controls;

	// Post-processing (bloom)
	initBloom(renderer, scene, camera);

	dispose = () => {
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
	};

	if (infoEl) {
		infoEl.textContent = `Seed: ${data.seed} | Biome: ${biome.name} | Length: ${data.length.toFixed(0)}m | Samples: ${data.numSamples} | Scenery: ${scenery.length}`;
	}

	applyTimeOfDay(state.currentTime);
	applyWeather(state.currentWeather);
}

// ── Generate ────────────────────────────────────────────────────────────

async function generate() {
	const urlParams = new URLSearchParams(window.location.search);
	const seed = Number(urlParams.get("seed")) || 42;
	const hour = Number(urlParams.get("hour")) || 12;
	const weather = (urlParams.get("weather") as WeatherType) || "clear";

	const seedDisplay = document.getElementById("seedDisplay") as HTMLElement | null;
	if (seedDisplay) seedDisplay.textContent = String(seed);
	const timeSliderEl = document.getElementById("timeSlider") as HTMLInputElement | null;
	if (timeSliderEl) timeSliderEl.value = String(hour);
	updateTimeLabel(hour);
	const weatherEl = document.getElementById("weatherSelect") as HTMLSelectElement | null;
	if (weatherEl) weatherEl.value = weather;

	state.currentTime = hour;
	state.currentWeather = weather;

	const params = new URLSearchParams({ seed: String(seed) });

	try {
		const resp = await fetch(`/api/track?${params}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data: TrackResponse = await resp.json();
		await buildScene(data);
	} catch (_err) {
		const data = generateTrack(seed);
		await buildScene({ ...data, seed });
	}
}

function setURLParam(key: string, value: string) {
	const url = new URL(window.location.href);
	url.searchParams.set(key, value);
	history.replaceState(null, "", url);
}

function updateTimeLabel(hour: number) {
	const timeLabel = document.getElementById("timeLabel") as HTMLElement | null;
	if (timeLabel) {
		const h = Math.floor(hour);
		const m = Math.floor((hour % 1) * 60);
		timeLabel.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}
}

// ── UI ───────────────────────────────────────────────────────────────────

document.getElementById("generateBtn")?.addEventListener("click", () => {
	const seed = Math.floor(Math.random() * 100000);
	setURLParam("seed", String(seed));
	generate();
});
document.getElementById("randomBtn")?.addEventListener("click", () => {
	const seed = Math.floor(Math.random() * 100000);
	setURLParam("seed", String(seed));
	generate();
});

const timeSlider = document.getElementById("timeSlider") as HTMLInputElement | null;
if (timeSlider) {
	timeSlider.addEventListener("input", () => {
		const hour = Number.parseFloat(timeSlider.value);
		state.currentTime = hour;
		setURLParam("hour", String(hour));
		applyTimeOfDay(hour);
		updateTimeLabel(hour);
	});
}

const weatherSelect = document.getElementById("weatherSelect") as HTMLSelectElement | null;
if (weatherSelect) {
	weatherSelect.addEventListener("change", () => {
		state.currentWeather = weatherSelect.value as WeatherType;
		setURLParam("weather", weatherSelect.value);
		applyTimeOfDay(state.currentTime);
		applyWeather(state.currentWeather);
	});
}

// ── Render loop ──────────────────────────────────────────────────────────

let lastTime = performance.now();

function updateTerrainStreetLights() {
	const { camera, terrainMaterial, streetLights } = state;
	if (!camera || !terrainMaterial || streetLights.length === 0) return;
	const camPos = camera.position;
	const sorted = streetLights
		.map((l) => ({ pos: l.position, dist: camPos.distanceTo(l.position) }))
		.sort((a, b) => a.dist - b.dist)
		.slice(0, 4);
	const posArr = terrainMaterial.uniforms.uStreetLightPos.value as THREE.Vector3[];
	for (let i = 0; i < 4; i++) {
		posArr[i].copy(i < sorted.length ? sorted[i].pos : new THREE.Vector3(0, -9999, 0));
	}
	terrainMaterial.uniforms.uStreetLightCount.value = Math.min(sorted.length, 4);
}

function animate() {
	requestAnimationFrame(animate);
	const now = performance.now();
	const delta = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (state.controls) state.controls.update();
	updateWeather(delta);
	updateTerrainStreetLights();
	if (state.scene && state.camera) {
		if (state.composer) {
			state.composer.render();
		} else {
			renderer.render(state.scene, state.camera);
		}
	}
}

window.addEventListener("resize", () => {
	if (state.camera) {
		state.camera.aspect = window.innerWidth / window.innerHeight;
		state.camera.updateProjectionMatrix();
	}
	renderer.setSize(window.innerWidth, window.innerHeight);
	updateBloomSize();
});

generate();
animate();
