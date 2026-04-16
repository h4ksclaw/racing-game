/**
 * Practice mode — thin shell on top of buildWorld().
 *
 * Adds: vehicle, keyboard input, HUD, chase/orbit camera.
 * ALL world building is in world.ts — nothing duplicated here.
 */

import * as THREE from "three";
import { state } from "./scene.ts";
import type { WeatherType } from "./utils.ts";
import { DEFAULT_INPUT, VehicleController, type VehicleInput } from "./vehicle/index.ts";
import { SPORTS_CAR } from "./vehicle/types.ts";
import { updateWeather } from "./weather.ts";
import { buildWorld, type WorldResult } from "./world.ts";

// ── Config (from URL) ───────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const seed = Number(urlParams.get("seed")) || 42;
const hour = Number(urlParams.get("hour")) || 14;
const weather = (urlParams.get("weather") as WeatherType) || "clear";

// ── HUD elements ────────────────────────────────────────────────────────
const speedEl = document.getElementById("speedometer");
const gearEl = document.getElementById("gear-display");
const rpmBar = document.getElementById("rpm-bar");
const hudEl = document.getElementById("hud");
const loadingEl = document.getElementById("loading");

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

// ── HUD ─────────────────────────────────────────────────────────────────

function updateHUD(): void {
	if (!vehicle || !speedEl) return;
	const kmh = Math.abs(Math.round(vehicle.state.speed * 3.6));
	speedEl.innerHTML = `${kmh} <span class="unit">km/h</span>`;

	const gear =
		vehicle.state.speed < -0.5 ? "R" : vehicle.state.speed < 0.5 ? "N" : String(vehicle.state.gear);
	if (gearEl) gearEl.textContent = gear;

	const rpmPct =
		((vehicle.state.rpm - vehicle.config.engine.idleRPM) /
			(vehicle.config.engine.maxRPM - vehicle.config.engine.idleRPM)) *
		100;
	if (rpmBar) rpmBar.style.width = `${Math.max(0, Math.min(100, rpmPct))}%`;
}

// ── Build ───────────────────────────────────────────────────────────────

async function buildPractice(): Promise<void> {
	world = await buildWorld({
		seed,
		hour,
		weather,
		// Practice-specific overrides
		pixelRatioCap: 2,
		shadowResolution: 2048,
		shadowExtent: 100,
		shadowFar: 300,
		toneMapping: true,
	});

	// Vehicle (page-specific)
	vehicle = new VehicleController(SPORTS_CAR);
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
	setupCameraInput(world.renderer);
	resetCar();

	if (loadingEl) loadingEl.style.display = "none";
	if (hudEl) hudEl.style.display = "flex";
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
		updateHUD();
	}

	updateWeather(delta);

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
		if (loadingEl) loadingEl.textContent = "Error loading track. Check console.";
	});
