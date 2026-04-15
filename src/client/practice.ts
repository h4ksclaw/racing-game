/**
 * Practice mode — single-player free roam on procedural tracks.
 *
 * Uses arcade physics (no physics engine) for smooth, predictable driving.
 * Car raycasts against TerrainSampler for ground contact.
 */

import { generateTrack, mulberry32 } from "@shared/track.ts";
import * as THREE from "three";
import { getBiomeForSeed } from "./biomes.ts";
import { initBloom } from "./effects.ts";
import { buildMeshes } from "./road.ts";
import { state } from "./scene.ts";
import { buildInstancedScenery, loadDecorations, setFallbackBiome } from "./scenery.ts";
import { applyTimeOfDay, setupSky } from "./sky.ts";
import { buildTerrain, TerrainSampler } from "./terrain.ts";
import type { TrackResponse, WeatherType } from "./utils.ts";
import { ArcadeCarController, DEFAULT_INPUT, type VehicleInput } from "./vehicle/index.ts";
import { applyWeather, buildRainSystem, buildSnowSystem, updateWeather } from "./weather.ts";

// ── Config from URL ────────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const seed = Number(urlParams.get("seed")) || 42;
const hour = Number(urlParams.get("hour")) || 14;
const weather = (urlParams.get("weather") as WeatherType) || "clear";

state.currentTime = hour;
state.currentWeather = weather;

// ── Renderer ───────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ── Scene ──────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 100, 800);
state.scene = scene;
state.renderer = renderer;

// ── Camera ─────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 1500);
state.camera = camera;

// ── Lighting ───────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
sun.shadow.camera.far = 300;
sun.shadow.bias = -0.001;
scene.add(sun);
state.sun = sun;

const ambient = new THREE.HemisphereLight(0x87ceeb, 0x362d1e, 0.6);
scene.add(ambient);
state.ambient = ambient;

// ── Sky ────────────────────────────────────────────────────────────────
const skyUniforms = setupSky(scene);
state.skyUniforms = skyUniforms;
applyTimeOfDay(hour);
applyWeather(weather);

// ── Rain/Snow ──────────────────────────────────────────────────────────
const rain = buildRainSystem();
const snow = buildSnowSystem();
state.rainSystem = rain.points;
state.snowSystem = snow.points;
rain.points.visible = false;
snow.points.visible = false;
scene.add(rain.points);
scene.add(snow.points);

// ── Input ──────────────────────────────────────────────────────────────
const input: VehicleInput = { ...DEFAULT_INPUT };

window.addEventListener("keydown", (e) => {
	switch (e.code) {
		case "KeyW":
		case "ArrowUp":
			input.forward = true;
			break;
		case "KeyS":
		case "ArrowDown":
			input.backward = true;
			break;
		case "KeyA":
		case "ArrowLeft":
			input.left = true;
			break;
		case "KeyD":
		case "ArrowRight":
			input.right = true;
			break;
		case "Space":
			input.handbrake = true;
			e.preventDefault();
			break;
		case "KeyR":
			resetCar();
			break;
	}
});

window.addEventListener("keyup", (e) => {
	switch (e.code) {
		case "KeyW":
		case "ArrowUp":
			input.forward = false;
			break;
		case "KeyS":
		case "ArrowDown":
			input.backward = false;
			break;
		case "KeyA":
		case "ArrowLeft":
			input.left = false;
			break;
		case "KeyD":
		case "ArrowRight":
			input.right = false;
			break;
		case "Space":
			input.handbrake = false;
			break;
	}
});

// ── Vehicle ────────────────────────────────────────────────────────────
let car: ArcadeCarController;
let terrain: TerrainSampler | null = null;
let trackData: TrackResponse | null = null;

function resetCar(): void {
	if (!trackData || !car) return;
	const samples = trackData.samples;
	const pos = car.getPosition();
	let nearestIdx = 0;
	let nearestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < samples.length; i += 10) {
		const dx = samples[i].point.x - pos.x;
		const dz = samples[i].point.z - pos.z;
		const dist = dx * dx + dz * dz;
		if (dist < nearestDist) {
			nearestDist = dist;
			nearestIdx = i;
		}
	}
	const s = samples[nearestIdx];
	const tangentAngle = Math.atan2(s.tangent.x, s.tangent.z);
	const groundY = terrain ? terrain.getHeight(s.point.x, s.point.z) : s.point.y;
	car.reset(s.point.x, groundY + 1, s.point.z, tangentAngle);
}

// ── Chase Camera ───────────────────────────────────────────────────────
const CAM_HEIGHT = 4;
const CAM_DIST = 8;
const CAM_LOOK_AHEAD = 4;

function updateChaseCamera(): void {
	if (!car) return;
	const pos = car.getPosition();
	const fwd = car.getForward();

	const targetX = pos.x - fwd.x * CAM_DIST;
	const targetY = pos.y + CAM_HEIGHT;
	const targetZ = pos.z - fwd.z * CAM_DIST;

	camera.position.x += (targetX - camera.position.x) * 0.06;
	camera.position.y += (targetY - camera.position.y) * 0.05;
	camera.position.z += (targetZ - camera.position.z) * 0.06;

	camera.lookAt(pos.x + fwd.x * CAM_LOOK_AHEAD, pos.y + 1, pos.z + fwd.z * CAM_LOOK_AHEAD);
}

// ── HUD ────────────────────────────────────────────────────────────────
const speedEl = document.getElementById("speedometer");
const gearEl = document.getElementById("gear-display");
const rpmBar = document.getElementById("rpm-bar");
const hudEl = document.getElementById("hud");
const loadingEl = document.getElementById("loading");

function updateHUD(): void {
	if (!car || !speedEl) return;
	const kmh = Math.abs(Math.round(car.state.speed * 3.6));
	speedEl.innerHTML = `${kmh} <span class="unit">km/h</span>`;

	const gear =
		car.state.speed < -0.5 ? "R" : car.state.speed < 0.5 ? "N" : String(car.state.gear + 1);
	if (gearEl) gearEl.textContent = gear;

	const rpmPct = ((car.state.rpm - 1000) / 7500) * 100;
	if (rpmBar) rpmBar.style.width = `${Math.max(0, Math.min(100, rpmPct))}%`;
}

// ── Build Scene ────────────────────────────────────────────────────────
async function buildPractice(): Promise<void> {
	const biome = getBiomeForSeed(seed);
	const rng = mulberry32(seed);

	let data: TrackResponse;
	try {
		const resp = await fetch(`/api/track?seed=${seed}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		data = await resp.json();
	} catch {
		const gen = generateTrack(seed);
		data = { ...gen, seed };
	}
	trackData = data;

	// World size
	let trackMax = 0;
	for (const s of data.samples) {
		const d = Math.sqrt(s.point.x ** 2 + s.point.z ** 2);
		if (d > trackMax) trackMax = d;
	}
	const worldSize = Math.max(1600, Math.ceil((trackMax * 2 + 200) / 200) * 200);

	// Terrain
	terrain = new TerrainSampler(data.seed, data.samples, {
		noiseAmp: biome.noiseAmp,
		mountainAmp: biome.mountainAmplifier,
		worldRadius: worldSize / 2,
	});
	const terrainGroup = await buildTerrain(data, terrain, biome, worldSize);
	scene.add(terrainGroup);

	// Road
	setFallbackBiome(biome.name);
	scene.add(await buildMeshes(data, rng, biome));

	// Scenery
	const { generateScenery } = await import("@shared/track.ts");
	const scenery = generateScenery(data.seed, data.samples, {
		treeTypes: biome.treeTypes,
		grassTypes: biome.grassTypes,
		treeDensity: biome.treeDensity,
		grassDensity: biome.grassDensity,
		rockDensity: biome.rockDensity,
	});
	await loadDecorations();
	scene.add(buildInstancedScenery(scenery, terrain));

	// Car (arcade physics — no cannon-es)
	car = new ArcadeCarController();
	car.setTerrain(terrain);
	const carModel = await car.loadModel();
	carModel.castShadow = true;
	carModel.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});
	scene.add(carModel);

	// Spawn at track start
	resetCar();

	// Post-processing
	initBloom(renderer, scene, camera);

	if (loadingEl) loadingEl.style.display = "none";
	if (hudEl) hudEl.style.display = "flex";
}

// ── Resize ─────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Main Loop ──────────────────────────────────────────────────────────
let lastTime = performance.now();

function animate(): void {
	requestAnimationFrame(animate);

	const now = performance.now();
	const delta = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	if (car) {
		car.update(input, delta);
		car.syncVisuals();
		updateChaseCamera();
		updateHUD();
	}

	updateWeather(delta);

	if (state.composer) {
		state.composer.render();
	} else {
		renderer.render(scene, camera);
	}
}

// ── Start ──────────────────────────────────────────────────────────────
buildPractice()
	.then(() => {
		animate();
	})
	.catch((err) => {
		console.error("Failed to build practice scene:", err);
		if (loadingEl) loadingEl.textContent = "Error loading track. Check console.";
	});
