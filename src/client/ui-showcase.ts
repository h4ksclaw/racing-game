/**
 * UI Showcase — demonstrates all Lit components with a live Three.js background.
 */

import * as THREE from "three";
import { state } from "./scene.ts";
import { applyTimeOfDay, buildStars } from "./sky.ts";

// ── Import all UI components (registers custom elements) ─────────────────
import "./ui/game-hud.ts";
import "./ui/control-panel.ts";
import "./ui/world-controls.ts";
import "./ui/settings-panel.ts";
import "./ui/notification-toast.ts";

// ── Three.js background ─────────────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 80, 120);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const geo = new THREE.TorusKnotGeometry(20, 6, 128, 32);
const mat = new THREE.MeshStandardMaterial({ color: 0x00e5a0, metalness: 0.7, roughness: 0.3 });
const mesh = new THREE.Mesh(geo, mat);
scene.add(mesh);

const ambientLight = new THREE.HemisphereLight(0x88bbff, 0x445511, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffcc, 1.2);
dirLight.position.set(100, 150, 50);
scene.add(dirLight);

const stars = buildStars();
scene.add(stars);

state.scene = scene;
state.sun = dirLight;
state.ambient = ambientLight;
state.renderer = renderer;

applyTimeOfDay(18.5);

// ── HUD demo: animate values ─────────────────────────────────────────────
const hud = document.querySelector("game-hud") as GameHud;

import type { GameHud } from "./ui/game-hud.ts";

let t = 0;

function animate(): void {
	requestAnimationFrame(animate);
	t += 0.016;
	mesh.rotation.x += 0.003;
	mesh.rotation.y += 0.005;

	const speed = 60 + Math.sin(t * 0.5) * 80 + Math.sin(t * 1.3) * 20;
	const rpm = 0.3 + Math.abs(Math.sin(t * 0.8)) * 0.65;
	const gears = [1, 2, 3, 4, 5];
	const gearIdx = Math.min(Math.floor(speed / 40), 4);
	hud.speed = Math.max(0, speed);
	hud.gear = gears[gearIdx] ?? 5;
	hud.rpm = rpm;

	renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
