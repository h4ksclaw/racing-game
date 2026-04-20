/**
 * Practice mode — thin shell on top of buildWorld().
 *
 * Adds: vehicle, keyboard input, HUD, chase/orbit camera.
 * ALL world building is in world.ts — nothing duplicated here.
 */

import * as THREE from "three";
import { AudioBus } from "./audio/AudioBus.ts";
import { deriveSoundConfig } from "./audio/audio-profiles.ts";
import { CameraController } from "./CameraController.ts";
import { RapierDebugRenderer } from "./rapier-debug-renderer.ts";
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
import { DEFAULT_INPUT, RapierVehicleController, type VehicleInput } from "./vehicle/index.ts";
import { VehicleRenderer } from "./vehicle/VehicleRenderer.ts";
import { updateWeather } from "./weather.ts";
import { buildWorld, type WorldResult } from "./world.ts";

// ── Config (from URL) ───────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const seed = Number(urlParams.get("seed")) || 42;
const hour = Number(urlParams.get("hour")) || 14;
const weather = (urlParams.get("weather") as WeatherType) || "clear";
const perfLow = urlParams.get("perf") === "low";
const debugMode = urlParams.get("debug") === "true" || urlParams.get("debug") === "1";

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
let vehicle: RapierVehicleController;
let renderer: VehicleRenderer | null = null;
let physicsDebug: RapierDebugRenderer | null = null;
let cameraCtrl: CameraController;
let world: WorldResult | null = null;
let engineAudio: import("./audio/EngineAudio.ts").EngineAudio | null = null;

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
	const groundY = world.terrain.getHeight(s.point.x, s.point.z) + 0.3;
	const cfg = vehicle.config.chassis;
	const bodyY = groundY + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1];
	vehicle.reset(s.point.x, bodyY, s.point.z, tangentAngle);
	cameraCtrl.setChaseMode();
}

// ── Build ───────────────────────────────────────────────────────────────

async function buildPractice(): Promise<void> {
	const loading = document.querySelector("loading-screen") as LoadingScreen | null;

	world = await buildWorld({
		seed,
		hour,
		weather,
		pixelRatioCap: perfLow ? 1 : 2,
		shadowResolution: perfLow ? 512 : 2048,
		shadowExtent: perfLow ? 50 : 100,
		shadowFar: perfLow ? 100 : 300,
		toneMapping: !perfLow,
		antialias: !perfLow,
		skipScenery: perfLow,
	});

	const carParam = urlParams.get("car");
	const customCfg = loadCustomConfig();
	const carConfig =
		customCfg && (carParam === "custom" || !carParam) ? applyOverrides(SPORTS_CAR, customCfg) : SPORTS_CAR;

	// Create renderer first to auto-derive chassis from model markers
	renderer = new VehicleRenderer(carConfig);
	const carModel = await renderer.loadModel();

	// Create Rapier vehicle controller with derived config (matching visual model)
	vehicle = new RapierVehicleController(renderer.derivedConfig);
	await vehicle.init();
	vehicle.setTerrain(world.terrain);
	carModel.castShadow = true;
	carModel.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});
	world.scene.add(carModel);

	// Camera
	cameraCtrl = new CameraController();
	cameraCtrl.setupInput(world.renderer);

	// Audio (starts on first user gesture)
	const startAudio = () => {
		if (engineAudio) return;
		const soundConfig =
			carConfig.sound ||
			deriveSoundConfig({
				cylinders: 4,
				idleRPM: carConfig.engine.idleRPM,
				maxRPM: carConfig.engine.maxRPM,
				turbo: carConfig.engine.turbo,
			});
		AudioBus.getInstance().acquire();
		import("./audio/EngineAudio.ts")
			.then(({ EngineAudio }) => {
				engineAudio = new EngineAudio(soundConfig);
				engineAudio.start();
			})
			.catch((e) => console.error("[audio] Failed to load EngineAudio:", e));
		window.removeEventListener("keydown", startAudio);
		window.removeEventListener("click", startAudio);
	};
	window.addEventListener("keydown", startAudio);
	window.addEventListener("click", startAudio);

	const rendererRef = renderer;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).__renderer = rendererRef;
	state.headlights = rendererRef?.headlights ?? [];
	state.onHeadlightIntensity = rendererRef ? (intensity: number) => rendererRef.setHeadlightIntensity(intensity) : null;
	applyTimeOfDay(hour);

	initUI();

	if (debugMode) {
		try {
			physicsDebug = new RapierDebugRenderer(world.scene);
		} catch (e) {
			console.error("[practice] RapierDebugRenderer failed:", e);
		}
	}

	// Initial placement: put car at track start (first sample)
	const startSample = world.trackData.samples[0];
	const startAngle = Math.atan2(startSample.tangent.x, startSample.tangent.z);
	const startGroundY = world.terrain.getHeight(startSample.point.x, startSample.point.z) + 0.3;
	const startCfg = vehicle.config.chassis;
	const startBodyY = startGroundY + startCfg.wheelRadius + startCfg.suspensionRestLength + startCfg.halfExtents[1];
	vehicle.reset(startSample.point.x, startBodyY, startSample.point.z, startAngle);

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

// ── Debug overlay (?debug=true) ─────────────────────────────────────────
let debugEl: HTMLDivElement | null = null;
let forceVecPanel: HTMLDivElement | null = null;
let showForceVectors = true;

// Force vector arrows (created once, updated each frame)
const FORCE_COLORS: Record<string, number> = {
	engine: 0x00ff00, // green
	brake: 0xff0000, // red
	wheelBrake: 0xff4444, // light red (Rapier native — usually ineffective)
	rolling: 0xff8800, // orange
	aero: 0x00ccff, // cyan
	engineBrake: 0xff00ff, // magenta
	coast: 0xffff00, // yellow
	total: 0xffffff, // white
};
const forceArrows: Map<string, THREE.ArrowHelper> = new Map();
let forceArrowsAdded = false;

function updateDebugOverlay(v: RapierVehicleController): void {
	if (!debugEl) {
		debugEl = document.createElement("div");
		debugEl.id = "debug-overlay";
		debugEl.style.cssText =
			"position:fixed;top:8px;left:8px;background:rgba(0,0,0,0.85);color:#0f0;font:12px/1.6 monospace;padding:10px;z-index:9999;pointer-events:none;white-space:pre;";
		document.body.appendChild(debugEl);
	}
	const info = v.getDebugInfo();
	debugEl.textContent = Object.entries(info)
		.map(([k, val]) => `${k}: ${val}`)
		.join("\n");
}

function initForceVecPanel(): void {
	if (forceVecPanel) return;
	forceVecPanel = document.createElement("div");
	forceVecPanel.style.cssText =
		"position:fixed;top:8px;left:240px;background:rgba(0,0,0,0.85);color:#fff;font:12px/1.6 monospace;padding:10px;z-index:9999;";
	forceVecPanel.innerHTML =
		`<div style="margin-bottom:6px;font-weight:bold">Force Vectors</div>` +
		`<label><input type="checkbox" id="fv-toggle" checked> Show arrows</label>`;
	document.body.appendChild(forceVecPanel);
	const toggle = document.getElementById("fv-toggle");
	if (toggle)
		toggle.addEventListener("change", (e) => {
			showForceVectors = (e.target as HTMLInputElement).checked;
		});
}

function updateForceArrows(v: RapierVehicleController): void {
	if (!state.scene || !v.physicsBody) return;
	const pos = v.physicsBody.translation();
	const rot = v.physicsBody.rotation();
	const heading = Math.atan2(2 * (rot.w * rot.y + rot.z * rot.x), 1 - 2 * (rot.y * rot.y + rot.x * rot.x));
	const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
	const origin = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
	const scale = 0.002; // N to world units (1kN = 2m arrow)

	if (!forceArrowsAdded) {
		for (const [name, color] of Object.entries(FORCE_COLORS)) {
			const arrow = new THREE.ArrowHelper(fwd.clone(), origin.clone(), 0.1, color, 0.2, 0.15);
			arrow.visible = showForceVectors;
			state.scene.add(arrow);
			forceArrows.set(name, arrow);
		}
		forceArrowsAdded = true;
	}

	// Update text panel with force values
	if (forceVecPanel) {
		let html = `<div style="margin-bottom:6px;font-weight:bold">Force Vectors</div>`;
		html += `<label><input type="checkbox" id="fv-toggle" ${showForceVectors ? "checked" : ""}> Show arrows</label><br>`;
		for (const [name, val] of Object.entries(v.forces)) {
			const c = FORCE_COLORS[name] ?? 0xffffff;
			html += `<span style="color:#${c.toString(16).padStart(6, "0")}">${name}</span>: ${val.toFixed(0)}N<br>`;
		}
		forceVecPanel.innerHTML = html;
		const toggle = document.getElementById("fv-toggle");
		if (toggle)
			toggle.addEventListener("change", (e) => {
				showForceVectors = (e.target as HTMLInputElement).checked;
			});
	}

	for (const [name, arrow] of forceArrows) {
		const val = (v.forces as Record<string, number>)[name] ?? 0;
		const len = Math.abs(val) * scale;
		arrow.visible = showForceVectors && len > 0.05; // 25N minimum to show
		if (arrow.visible) {
			arrow.position.copy(origin);
			const dir = val >= 0 ? fwd.clone() : fwd.clone().negate();
			arrow.setDirection(dir);
			arrow.setLength(Math.max(0.1, len), Math.max(0.05, len * 0.2), Math.max(0.03, len * 0.15));
		}
	}
}

// ── Main loop ───────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate(): void {
	requestAnimationFrame(animate);
	const now = performance.now();
	const delta = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	if (vehicle) {
		vehicle.update(input, delta);

		// Sync Three.js visuals directly from Rapier physics body
		if (renderer?.model && vehicle.physicsBody) {
			const body = vehicle.physicsBody;
			const p = body.translation();
			const r = body.rotation();

			renderer.model.position.set(p.x, p.y + renderer.getModelGroundOffset(), p.z);
			renderer.model.quaternion.set(r.x, r.y, r.z, r.w);

			// Wheel steering + spin using pivot structure
			// Each wheelMeshes[i] is a pivot Group containing the wheel clone
			// Inner clone has baked rotation from GLB + our axle alignment
			for (let i = 0; i < 4; i++) {
				const pivot = renderer.wheelMeshes[i];
				if (!pivot) continue;

				const steer = i < 2 ? vehicle.getSteerAngle() : 0;
				const spinDelta = (vehicle.state.speed / vehicle.config.chassis.wheelRadius) * delta;

				// Accumulate spin angle per wheel
				if (!pivot.userData.spinAngle) pivot.userData.spinAngle = 0;
				pivot.userData.spinAngle += spinDelta;

				// Pivot: spin around X (axle), steer around Y
				pivot.quaternion.setFromEuler(new THREE.Euler(pivot.userData.spinAngle, steer, 0, "YXZ"));
			}
		}

		// Camera
		if (world) {
			cameraCtrl.update(world.camera, vehicle);
		}

		// Terrain shader headlight data
		if (renderer) {
			const headlightData = renderer.getHeadlightData(vehicle.getForward());
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
		}

		// Brake / reverse lights
		if (renderer) {
			const isReversing = vehicle.state.gear === -1;
			if (isReversing) {
				renderer.setReversing(true);
			} else {
				renderer.setReversing(false);
				renderer.setBraking(vehicle.state.brake > 0 || !!input.handbrake);
			}
		}

		// Audio
		if (engineAudio) {
			engineAudio.update(vehicle.telemetry, vehicle.getPosition());
			AudioBus.getInstance().updateListener(vehicle.getPosition(), vehicle.getForward());
		}

		// HUD
		const speed = Math.abs(vehicle.state.speed * 3.6);
		const gear = vehicle.state.gear;
		const rpmFrac =
			(vehicle.state.rpm - vehicle.config.engine.idleRPM) /
			(vehicle.config.engine.maxRPM - vehicle.config.engine.idleRPM);
		const clampedRpm = Math.max(0, Math.min(1, rpmFrac));
		const steerInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
		const throttle = input.forward ? 1 : 0;
		const brake = input.backward && vehicle.state.gear !== -1 ? 1 : 0;

		updateUI(speed, gear, clampedRpm, steerInput, throttle, brake);

		if (mapEl) {
			const pos = vehicle.getPosition();
			mapEl.playerX = pos.x;
			mapEl.playerZ = pos.z;
			const fwd = vehicle.getForward();
			mapEl.heading = Math.atan2(fwd.x, fwd.z);
		}

		if (state.sun && renderer?.model) {
			const cp = renderer.model.position;
			state.sun.position.set(cp.x + 100, cp.y + 150, cp.z + 50);
			state.sun.target.position.set(cp.x, cp.y, cp.z);
			state.sun.target.updateMatrixWorld();
		}
	}

	updateWeather(delta);
	updateTerrainShadows();

	// Debug overlay
	if (debugMode && vehicle) {
		updateDebugOverlay(vehicle);
		initForceVecPanel();
		updateForceArrows(vehicle);
		if (physicsDebug) {
			physicsDebug.update(vehicle.rapierWorld, vehicle.physicsBody, vehicle.guardrailBodies);
		}
	}

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
