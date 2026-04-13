import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { WeatherType } from "./utils.ts";

/**
 * Central mutable state shared across all track viewer modules.
 * Initialized by scene.ts → buildScene().
 */
export const state = {
	scene: null as THREE.Scene | null,
	camera: null as THREE.PerspectiveCamera | null,
	controls: null as OrbitControls | null,
	renderer: null as THREE.WebGLRenderer | null,
	composer: null as EffectComposer | null,
	sun: null as THREE.DirectionalLight | null,
	ambient: null as THREE.HemisphereLight | null,
	skyUniforms: null as Record<string, THREE.IUniform> | null,
	stars: null as THREE.Points | null,
	streetLights: [] as THREE.PointLight[],
	lightFixtures: [] as THREE.Mesh[],
	rainSystem: null as THREE.Points | null,
	snowSystem: null as THREE.Points | null,
	terrainMaterial: null as THREE.ShaderMaterial | null,
	roadMaterial: null as THREE.MeshStandardMaterial | null,
	currentTime: 12,
	currentWeather: "clear" as WeatherType,
};
