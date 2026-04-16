/**
 * Practice mode — thin shell on top of buildWorld().
 *
 * Adds: vehicle, keyboard input, HUD, chase/orbit camera.
 * ALL world building is in world.ts — nothing duplicated here.
 */

import * as THREE from "three";
import { AudioBus } from "./audio/AudioBus.ts";
import { deriveSoundConfig } from "./audio/audio-profiles.ts";
import { state } from "./scene.ts";
import { applyTimeOfDay } from "./sky.ts";
import { updateTerrainShadows } from "./terrain.ts";
import { applyOverrides, loadCustomConfig } from "./ui/garage-store.ts";
import type { GearStrip } from "./ui/gear-strip.ts";
import type { LoadingScreen } from "./ui/loading-screen.ts";
import type { RaceMinimap } from "./ui/minimap.ts";
import type { PedalBars } from "./ui/pedal-bars.ts";
import type { RaceToast } from "./ui/race-toast.ts";
import type { RpmBar } from "./ui/rpm-bar.ts";
import type { SessionBadge } from "./ui/session-badge.ts";
import type { SpeedDisplay } from "./ui/speed-display.ts";
import type { SpeedTrap } from "./ui/speed-trap.ts";
import type { SteerIndicator } from "./ui/steer-indicator.ts";
import type { WeatherType } from "./utils.ts";
import { SPORTS_CAR } from "./vehicle/configs.ts";
import { DEFAULT_INPUT, VehicleController, type VehicleInput } from "./vehicle/index.ts";
import { updateWeather } from "./weather.ts";
import { buildWorld, type WorldResult } from "./world.ts";

// ── Config (from URL) ───────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const seed = Number(urlParams.get("seed")) || 42;
const hour = Number(urlParams.get("hour")) || 14;
const weather = (urlParams.get("weather") as WeatherType) || "clear";

// ── UI component refs ───────────────────────────────────────────────────
let uiReady = false;
let sessionStart = 0;
let topSpeed = 0;

let speedDisplay: SpeedDisplay | null = null;
let rpmBarEl: RpmBar | null = null;
let gearStripEl: GearStrip | null = null;
let steerEl: SteerIndicator | null = null;
let pedalsEl: PedalBars | null = null;
let sessionEl: SessionBadge | null = null;
let trapEl: SpeedTrap | null = null;
let mapEl: RaceMinimap | null = null;

function initUI(): void {
	speedDisplay = document.querySelector("speed-display");
	rpmBarEl = document.querySelector("rpm-bar");
	gearStripEl = document.querySelector("gear-strip");
	steerEl = document.querySelector("steer-indicator");
	pedalsEl = document.querySelector("pedal-bars");
	sessionEl = document.querySelector("session-badge");
	trapEl = document.querySelector("speed-trap");
	mapEl = document.querySelector("race-minimap");
}

function updateUI(
	speed: number,
	gear: number,
	rpmFrac: number,
	steerInput: number,
	throttle: number,
	brake: number,
): void {
	if (!uiReady) return;

	const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
	if (sessionEl) sessionEl.elapsed = elapsed;
	if (speedDisplay) {
		speedDisplay.speed = speed;
		speedDisplay.gear = gear;
		speedDisplay.rpm = rpmFrac;
	}
	if (rpmBarEl) rpmBarEl.rpm = rpmFrac;
	if (gearStripEl) gearStripEl.gear = gear;
	if (steerEl) steerEl.input = steerInput;
	if (pedalsEl) {
		pedalsEl.throttle = throttle;
		pedalsEl.brake = brake;
	}

	const absSpeed = Math.abs(Math.round(speed));
	if (absSpeed > topSpeed) topSpeed = absSpeed;
	if (trapEl) trapEl.topSpeed = topSpeed;
	if (mapEl) mapEl.speed = absSpeed;
}

// ── Input ───────────────────────────────────────────────────────────────
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

// ── Vehicle ─────────────────────────────────────────────────────────────
let vehicle: VehicleController;
let world: WorldResult | null = null;

function resetCar(): void {
	if (!world || !vehicle) return;
	const samples = world.trackData.samples;
	const pos = vehicle.getPosition();
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
	const groundY = world.terrain.getHeight(s.point.x, s.point.z);
	vehicle.reset(s.point.x, groundY + 2, s.point.z, tangentAngle);
	camMode = "chase";
}

// ── Camera: Chase + Orbit (GTA-style) ───────────────────────────────────
type CameraMode = "chase" | "orbit";
let camMode: CameraMode = "chase";

let orbitYaw = 0;
let orbitPitch = 0.3;
let orbitDist = 10;
const orbitTarget = new THREE.Vector3();
const orbitSpherical = new THREE.Spherical();

const CHASE_HEIGHT = 4;
const CHASE_DIST = 8;
const CHASE_LOOK_AHEAD = 5;
const CHASE_SMOOTH = 0.08;

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

function setupCameraInput(renderer: THREE.WebGLRenderer): void {
	renderer.domElement.addEventListener("mousedown", (e) => {
		if (e.button === 0 && !isDragging) {
			camMode = "chase";
			return;
		}
	});

	renderer.domElement.addEventListener("contextmenu", (e) => {
		e.preventDefault();
	});

	renderer.domElement.addEventListener("mousedown", (e) => {
		if (e.button === 2) {
			isDragging = true;
			lastMouseX = e.clientX;
			lastMouseY = e.clientY;
			camMode = "orbit";
		}
	});

	window.addEventListener("mouseup", () => {
		isDragging = false;
	});

	window.addEventListener("mousemove", (e) => {
		if (!isDragging) return;
		const dx = e.clientX - lastMouseX;
		const dy = e.clientY - lastMouseY;
		lastMouseX = e.clientX;
		lastMouseY = e.clientY;
		orbitYaw -= dx * 0.005;
		orbitPitch = Math.max(-0.5, Math.min(1.2, orbitPitch + dy * 0.005));
	});

	renderer.domElement.addEventListener("wheel", (e) => {
		if (camMode === "orbit") {
			orbitDist = Math.max(3, Math.min(30, orbitDist + e.deltaY * 0.01));
		}
	});
}

function updateCamera(): void {
	if (!vehicle || !world) return;
	const camera = world.camera;

	const pos = vehicle.getPosition();
	const fwd = vehicle.getForward();
	orbitTarget.set(pos.x, pos.y + 1, pos.z);

	if (camMode === "chase") {
		const targetX = pos.x - fwd.x * CHASE_DIST;
		const targetY = pos.y + CHASE_HEIGHT;
		const targetZ = pos.z - fwd.z * CHASE_DIST;

		camera.position.x += (targetX - camera.position.x) * CHASE_SMOOTH;
		camera.position.y += (targetY - camera.position.y) * CHASE_SMOOTH;
		camera.position.z += (targetZ - camera.position.z) * CHASE_SMOOTH;

		const lookX = pos.x + fwd.x * CHASE_LOOK_AHEAD;
		const lookZ = pos.z + fwd.z * CHASE_LOOK_AHEAD;
		camera.lookAt(lookX, pos.y + 1, lookZ);

		orbitYaw = Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
		orbitDist = camera.position.distanceTo(orbitTarget);
		orbitPitch = Math.atan2(
			camera.position.y - pos.y - 1,
			Math.sqrt((camera.position.x - pos.x) ** 2 + (camera.position.z - pos.z) ** 2),
		);
	} else {
		const carYaw = Math.atan2(fwd.x, fwd.z);
		orbitYaw += ((carYaw - orbitYaw + Math.PI) % (2 * Math.PI)) - Math.PI;

		orbitSpherical.set(orbitDist, Math.PI / 2 - orbitPitch, orbitYaw);
		const targetPos = new THREE.Vector3().setFromSpherical(orbitSpherical);
		targetPos.add(orbitTarget);

		camera.position.lerp(targetPos, 0.1);
		camera.lookAt(orbitTarget);
	}
}

// ── Build ───────────────────────────────────────────────────────────────

async function buildPractice(): Promise<void> {
	const loading = document.querySelector("loading-screen") as LoadingScreen | null;

	world = await buildWorld({
		seed,
		hour,
		weather,
		pixelRatioCap: 2,
		shadowResolution: 2048,
		shadowExtent: 100,
		shadowFar: 300,
		toneMapping: true,
	});

	const carParam = urlParams.get("car");
	const customCfg = loadCustomConfig();
	const carConfig =
		customCfg && (carParam === "custom" || !carParam)
			? applyOverrides(SPORTS_CAR, customCfg)
			: SPORTS_CAR;
	vehicle = new VehicleController(carConfig);
	const carModel = await vehicle.loadModel();
	carModel.castShadow = true;
	carModel.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});
	world.scene.add(carModel);

	vehicle.setTerrain(world.terrain);

	const startAudio = () => {
		const soundConfig =
			carConfig.sound ||
			deriveSoundConfig({
				cylinders: 4,
				idleRPM: carConfig.engine.idleRPM,
				maxRPM: carConfig.engine.maxRPM,
				turbo: carConfig.engine.turbo,
			});
		console.log(
			"[audio] config:",
			JSON.stringify({ volume: soundConfig.volume, cylinders: soundConfig.cylinders }),
		);
		vehicle.initAudio(soundConfig);
		window.removeEventListener("keydown", startAudio);
		window.removeEventListener("click", startAudio);
	};
	window.addEventListener("keydown", startAudio);
	window.addEventListener("click", startAudio);

	state.headlights = vehicle.headlights;
	applyTimeOfDay(hour);
	setupCameraInput(world.renderer);
	resetCar();

	initUI();

	if (loading) loading.visible = false;

	uiReady = true;
	sessionStart = Date.now();

	const toast = document.querySelector("race-toast") as RaceToast | null;
	if (toast) toast.show("WORLD LOADED");
}

// ── Resize ──────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
	if (!world) return;
	world.camera.aspect = window.innerWidth / window.innerHeight;
	world.camera.updateProjectionMatrix();
	world.renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Main loop ───────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate(): void {
	requestAnimationFrame(animate);
	const now = performance.now();
	const delta = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	if (vehicle) {
		vehicle.update(input, delta);
		vehicle.syncVisuals();
		updateCamera();

		// Update audio listener to match camera position
		if (vehicle.audio && world) {
			const cam = world.camera;
			const fwd = new THREE.Vector3();
			cam.getWorldDirection(fwd);
			AudioBus.getInstance().updateListener(
				{ x: cam.position.x, y: cam.position.y, z: cam.position.z },
				{ x: fwd.x, y: fwd.y, z: fwd.z },
			);
		}

		// Update terrain shader with car headlight data
		const headlightData = vehicle.renderer.getHeadlightData(vehicle.getForward());
		if (headlightData && state.terrainMaterial) {
			const u = state.terrainMaterial.uniforms;
			const posArr = u.uCarLightPos.value as THREE.Vector3[];
			const dirArr = u.uCarLightDir.value as THREE.Vector3[];
			for (let i = 0; i < 2; i++) {
				if (headlightData.positions[i]) posArr[i].copy(headlightData.positions[i]);
				if (headlightData.directions[i]) dirArr[i].copy(headlightData.directions[i]);
			}
			u.uCarLightIntensity.value = headlightData.intensity;
		}

		const speed = Math.abs(vehicle.state.speed * 3.6);
		const gear = vehicle.state.gear;
		const rpmFrac =
			(vehicle.state.rpm - vehicle.config.engine.idleRPM) /
			(vehicle.config.engine.maxRPM - vehicle.config.engine.idleRPM);
		const clampedRpm = Math.max(0, Math.min(1, rpmFrac));

		const steerInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
		const throttle = input.forward ? 1 : 0;
		const brake = input.backward ? 1 : 0;

		updateUI(speed, gear, clampedRpm, steerInput, throttle, brake);

		if (mapEl) {
			const pos = vehicle.getPosition();
			mapEl.playerX = pos.x;
			mapEl.playerZ = pos.z;
			const fwd = vehicle.getForward();
			mapEl.heading = Math.atan2(fwd.x, fwd.z);
		}

		if (state.sun && vehicle.model) {
			const cp = vehicle.model.position;
			state.sun.position.set(cp.x + 100, cp.y + 150, cp.z + 50);
			state.sun.target.position.set(cp.x, cp.y, cp.z);
			state.sun.target.updateMatrixWorld();
		}
	}

	updateWeather(delta);
	updateTerrainShadows();

	if (state.composer) {
		state.composer.render();
	} else if (world && state.scene) {
		world.renderer.render(state.scene, world.camera);
	}
}

// ── Boot ────────────────────────────────────────────────────────────────

buildPractice()
	.then(() => {
		animate();
	})
	.catch((err) => {
		console.error("Failed to build practice scene:", err);
		const loading = document.querySelector("loading-screen") as LoadingScreen | null;
		if (loading) loading.message = "Error loading track. Check console.";
	});
