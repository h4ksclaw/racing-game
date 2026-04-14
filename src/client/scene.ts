import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { BiomeConfig } from "./biomes.ts";
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
	streetLights: [] as THREE.Light[],
	lightFixtures: [] as THREE.Mesh[],
	rainSystem: null as THREE.Points | null,
	snowSystem: null as THREE.Points | null,
	terrainMaterial: null as THREE.ShaderMaterial | null,
	roadMaterial: null as THREE.MeshStandardMaterial | null,
	roadSnowOverlayMaterial: null as THREE.ShaderMaterial | null,
	concreteSlabMaterial: null as THREE.ShaderMaterial | null,
	currentBiome: null as BiomeConfig | null,
	roadRoughnessBase: 0.8, // set by biome, overridden by weather
	roadWetness: 0.0, // 0=dry, 1=soaked (rain)
	_baseSunIntensity: undefined as number | undefined,
	_baseAmbientIntensity: undefined as number | undefined,
	currentTime: 12,
	currentWeather: "clear" as WeatherType,
};
