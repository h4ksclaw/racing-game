/**
 * Track viewer — thin shell on top of buildWorld().
 *
 * Adds: OrbitControls, seed/weather/time UI, flyover preview.
 * ALL world building is in world.ts — nothing duplicated here.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { updateBloomSize } from "./effects.ts";
import { state } from "./scene.ts";
import { applyTimeOfDay } from "./sky.ts";
import type { WeatherType } from "./utils.ts";
import { applyWeather, updateWeather } from "./weather.ts";
import { buildWorld, type WorldResult } from "./world.ts";

// ── State ───────────────────────────────────────────────────────────────

const infoEl = document.getElementById("info");
let world: WorldResult | null = null;
let controls: OrbitControls | null = null;

// ── Generate ────────────────────────────────────────────────────────────

async function generate(): Promise<void> {
	const urlParams = new URLSearchParams(window.location.search);
	const seed = Number(urlParams.get("seed")) || 42;
	const hour = Number(urlParams.get("hour")) || 12;
	const weather = (urlParams.get("weather") as WeatherType) || "clear";

	// Sync UI
	const seedDisplay = document.getElementById("seedDisplay") as HTMLElement | null;
	if (seedDisplay) seedDisplay.textContent = String(seed);
	const timeSliderEl = document.getElementById("timeSlider") as HTMLInputElement | null;
	if (timeSliderEl) timeSliderEl.value = String(hour);
	updateTimeLabel(hour);
	const weatherEl = document.getElementById("weatherSelect") as HTMLSelectElement | null;
	if (weatherEl) weatherEl.value = weather;

	// Dispose previous world
	if (world) {
		world.dispose();
		if (controls) {
			controls.dispose();
			controls = null;
		}
	}

	// Build the world (single source of truth)
	world = await buildWorld({ seed, hour, weather });

	// OrbitControls (page-specific)
	controls = new OrbitControls(world.camera, world.renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.target.set(
		world.trackData.samples[0].point.x,
		world.trackData.samples[0].point.y,
		world.trackData.samples[0].point.z,
	);
	state.controls = controls;

	// Reset flyover
	state.flyover.active = false;
	state.flyover.distance = 0;

	if (infoEl) {
		infoEl.textContent = `Seed: ${seed} | Biome: ${world.biome.name} | Length: ${world.trackData.length.toFixed(0)}m | Samples: ${world.trackData.numSamples} | Scenery: ${world.sceneryCount}`;
	}
}

// ── URL helpers ─────────────────────────────────────────────────────────

function setURLParam(key: string, value: string): void {
	const url = new URL(window.location.href);
	url.searchParams.set(key, value);
	history.replaceState(null, "", url);
}

function updateTimeLabel(hour: number): void {
	const timeLabel = document.getElementById("timeLabel") as HTMLElement | null;
	if (timeLabel) {
		const h = Math.floor(hour);
		const m = Math.floor((hour % 1) * 60);
		timeLabel.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}
}

// ── UI events ───────────────────────────────────────────────────────────

document.getElementById("generateBtn")?.addEventListener("click", () => {
	const seed = Math.floor(Math.random() * 100000);
	setURLParam("seed", String(seed));
	generate();
});

document.getElementById("flyoverBtn")?.addEventListener("click", () => {
	const btn = document.getElementById("flyoverBtn") as HTMLButtonElement | null;
	if (!btn) return;
	if (state.flyover.active) {
		state.flyover.active = false;
		state.flyover.distance = 0;
		btn.textContent = "▶ Preview Track";
		if (controls) controls.enabled = true;
	} else {
		state.flyover.active = true;
		state.flyover.distance = 0;
		btn.textContent = "⏹ Stop Preview";
	}
});

document.getElementById("practiceBtn")?.addEventListener("click", () => {
	const params = new URLSearchParams(window.location.search);
	window.location.href = `/practice?${params.toString()}`;
});

const flyoverSpeed = document.getElementById("flyoverSpeed") as HTMLInputElement | null;
if (flyoverSpeed) {
	flyoverSpeed.addEventListener("input", () => {
		state.flyover.speed = Number(flyoverSpeed.value);
		const label = document.getElementById("flyoverSpeedLabel");
		if (label) label.textContent = `${flyoverSpeed.value} km/h`;
	});
}

const timeSlider = document.getElementById("timeSlider") as HTMLInputElement | null;
if (timeSlider) {
	timeSlider.addEventListener("input", () => {
		const hour = Number.parseFloat(timeSlider.value);
		state.currentTime = hour;
		setURLParam("hour", String(hour));
		applyTimeOfDay(hour);
		applyWeather(state.currentWeather);
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

// ── Terrain street lights (viewer-specific rendering) ───────────────────

function updateTerrainStreetLights(): void {
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

// ── Flyover ─────────────────────────────────────────────────────────────

function updateFlyover(delta: number): void {
	const { flyover, camera, controls, worldSamples } = state;
	if (!flyover.active || !camera || !worldSamples.length) return;
	if (controls) controls.enabled = false;

	const speedMs = (flyover.speed / 3.6) * delta;
	flyover.distance += speedMs;

	let walked = 0;
	let idx = 0;
	let segLen = 0;
	for (let i = 1; i < worldSamples.length; i++) {
		const dx = worldSamples[i].point.x - worldSamples[i - 1].point.x;
		const dy = worldSamples[i].point.y - worldSamples[i - 1].point.y;
		const dz = worldSamples[i].point.z - worldSamples[i - 1].point.z;
		segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (walked + segLen >= flyover.distance) {
			idx = i;
			break;
		}
		walked += segLen;
	}
	if (idx === 0) {
		flyover.distance = 0;
		idx = 1;
	}

	const s = worldSamples[idx];
	const prev = worldSamples[idx - 1];
	const t = segLen > 0 ? (flyover.distance - walked) / segLen : 0;

	const px = prev.point.x + (s.point.x - prev.point.x) * t;
	const py = prev.point.y + (s.point.y - prev.point.y) * t + 5;
	const pz = prev.point.z + (s.point.z - prev.point.z) * t;

	const tx = prev.tangent.x + (s.tangent.x - prev.tangent.x) * t;
	const ty = prev.tangent.y + (s.tangent.y - prev.tangent.y) * t;
	const tz = prev.tangent.z + (s.tangent.z - prev.tangent.z) * t;
	const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);

	camera.position.set(px, py, pz);
	camera.lookAt(px + (tx / tLen) * 10, py + (ty / tLen) * 10, pz + (tz / tLen) * 10);
}

// ── Render loop ─────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate(): void {
	requestAnimationFrame(animate);
	const now = performance.now();
	const delta = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (controls) controls.update();
	updateWeather(delta);
	updateTerrainStreetLights();
	updateFlyover(delta);
	if (state.scene && state.camera) {
		if (state.composer) {
			state.composer.render();
		} else {
			world?.renderer.render(state.scene, state.camera);
		}
	}
}

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
	if (!world) return;
	world.camera.aspect = window.innerWidth / window.innerHeight;
	world.camera.updateProjectionMatrix();
	world.renderer.setSize(window.innerWidth, window.innerHeight);
	updateBloomSize();
});

// ── Debug ───────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
	if (e.key === "d" || e.key === "D") {
		const m = state.terrainMaterial;
		if (!m) return;
		const cur = m.uniforms.uDebugMode.value as number;
		m.uniforms.uDebugMode.value = cur > 0.5 ? 0.0 : 1.0;
		console.log("Terrain debug mode:", m.uniforms.uDebugMode.value > 0.5 ? "ON" : "OFF");
	}
});

// ── Boot ────────────────────────────────────────────────────────────────

generate().then(animate);
