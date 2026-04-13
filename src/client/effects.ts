import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { state } from "./scene.ts";

let composer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;

export function initBloom(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
): void {
	composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));

	bloomPass = new UnrealBloomPass(
		new THREE.Vector2(window.innerWidth, window.innerHeight),
		0.2, // strength
		0.4, // radius
		0.85, // threshold — only bright stuff blooms
	);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());

	state.composer = composer;
}

export function getComposer(): EffectComposer | null {
	return composer;
}

export function updateBloomSize(): void {
	if (!composer) return;
	composer.setSize(window.innerWidth, window.innerHeight);
}

export function setBloomStrength(strength: number): void {
	if (bloomPass) bloomPass.strength = strength;
}

export function setBloomThreshold(threshold: number): void {
	if (bloomPass) bloomPass.threshold = threshold;
}
