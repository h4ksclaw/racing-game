import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { state } from "./scene.ts";
import type { TimeKeyframe, WeatherType } from "./utils.ts";

// ── Time keyframes ──────────────────────────────────────────────────────

export const timeKeyframes: TimeKeyframe[] = [
	{
		hour: 0,
		sunColor: [0.15, 0.15, 0.3],
		sunIntensity: 0.02,
		sunElevation: -30,
		ambientColor: [0.04, 0.04, 0.08],
		ambientIntensity: 0.08,
		fogColor: [0.02, 0.02, 0.06],
		fogNear: 50,
		fogFar: 800,
		turbidity: 0.5,
		rayleigh: 0.5,
		starsOpacity: 1.0,
	},
	{
		hour: 5,
		sunColor: [0.2, 0.15, 0.3],
		sunIntensity: 0.05,
		sunElevation: -10,
		ambientColor: [0.08, 0.06, 0.12],
		ambientIntensity: 0.1,
		fogColor: [0.05, 0.04, 0.08],
		fogNear: 100,
		fogFar: 1000,
		turbidity: 1,
		rayleigh: 0.8,
		starsOpacity: 0.6,
	},
	{
		hour: 6,
		sunColor: [1.0, 0.5, 0.2],
		sunIntensity: 0.3,
		sunElevation: 2,
		ambientColor: [0.4, 0.25, 0.2],
		ambientIntensity: 0.25,
		fogColor: [0.5, 0.3, 0.2],
		fogNear: 200,
		fogFar: 1200,
		turbidity: 8,
		rayleigh: 2,
		starsOpacity: 0.1,
	},
	{
		hour: 8,
		sunColor: [1.0, 0.9, 0.7],
		sunIntensity: 0.85,
		sunElevation: 25,
		ambientColor: [0.45, 0.5, 0.55],
		ambientIntensity: 0.4,
		fogColor: [0.7, 0.75, 0.8],
		fogNear: 400,
		fogFar: 1800,
		turbidity: 3,
		rayleigh: 1,
		starsOpacity: 0,
	},
	{
		hour: 12,
		sunColor: [1.0, 1.0, 0.95],
		sunIntensity: 1.2,
		sunElevation: 65,
		ambientColor: [0.5, 0.55, 0.6],
		ambientIntensity: 0.5,
		fogColor: [0.75, 0.8, 0.85],
		fogNear: 600,
		fogFar: 2000,
		turbidity: 2.5,
		rayleigh: 1,
		starsOpacity: 0,
	},
	{
		hour: 16,
		sunColor: [1.0, 0.9, 0.7],
		sunIntensity: 0.9,
		sunElevation: 30,
		ambientColor: [0.45, 0.48, 0.52],
		ambientIntensity: 0.4,
		fogColor: [0.7, 0.72, 0.78],
		fogNear: 500,
		fogFar: 1800,
		turbidity: 3,
		rayleigh: 1,
		starsOpacity: 0,
	},
	{
		hour: 18,
		sunColor: [1.0, 0.5, 0.15],
		sunIntensity: 0.6,
		sunElevation: 8,
		ambientColor: [0.45, 0.3, 0.25],
		ambientIntensity: 0.35,
		fogColor: [0.6, 0.35, 0.2],
		fogNear: 400,
		fogFar: 1500,
		turbidity: 10,
		rayleigh: 3,
		starsOpacity: 0,
	},
	{
		hour: 19.5,
		sunColor: [0.6, 0.2, 0.15],
		sunIntensity: 0.15,
		sunElevation: -2,
		ambientColor: [0.15, 0.1, 0.15],
		ambientIntensity: 0.15,
		fogColor: [0.15, 0.08, 0.12],
		fogNear: 200,
		fogFar: 1000,
		turbidity: 6,
		rayleigh: 1.5,
		starsOpacity: 0.3,
	},
	{
		hour: 21,
		sunColor: [0.2, 0.2, 0.35],
		sunIntensity: 0.03,
		sunElevation: -20,
		ambientColor: [0.05, 0.05, 0.1],
		ambientIntensity: 0.08,
		fogColor: [0.03, 0.03, 0.07],
		fogNear: 100,
		fogFar: 800,
		turbidity: 1,
		rayleigh: 0.5,
		starsOpacity: 0.8,
	},
	{
		hour: 24,
		sunColor: [0.15, 0.15, 0.3],
		sunIntensity: 0.02,
		sunElevation: -30,
		ambientColor: [0.04, 0.04, 0.08],
		ambientIntensity: 0.08,
		fogColor: [0.02, 0.02, 0.06],
		fogNear: 50,
		fogFar: 800,
		turbidity: 0.5,
		rayleigh: 0.5,
		starsOpacity: 1.0,
	},
];

// ── Helpers ─────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpColor(
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Interpolate between time keyframes to get the current sky/lighting state for a given hour (0–24). */
export function getTimeState(hour: number): TimeKeyframe {
	hour = ((hour % 24) + 24) % 24;
	let a = timeKeyframes[0];
	let b = timeKeyframes[1];
	for (let i = 0; i < timeKeyframes.length - 1; i++) {
		if (hour >= timeKeyframes[i].hour && hour <= timeKeyframes[i + 1].hour) {
			a = timeKeyframes[i];
			b = timeKeyframes[i + 1];
			break;
		}
	}
	const range = b.hour - a.hour;
	const t = range > 0 ? (hour - a.hour) / range : 0;
	return {
		hour,
		sunColor: lerpColor(a.sunColor, b.sunColor, t),
		sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
		sunElevation: lerp(a.sunElevation, b.sunElevation, t),
		ambientColor: lerpColor(a.ambientColor, b.ambientColor, t),
		ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
		fogColor: lerpColor(a.fogColor, b.fogColor, t),
		fogNear: lerp(a.fogNear, b.fogNear, t),
		fogFar: lerp(a.fogFar, b.fogFar, t),
		turbidity: lerp(a.turbidity, b.turbidity, t),
		rayleigh: lerp(a.rayleigh, b.rayleigh, t),
		starsOpacity: lerp(a.starsOpacity, b.starsOpacity, t),
	};
}

/** Build a star field Points mesh (visible at night, hidden during day). */
export function buildStars(): THREE.Points {
	const count = 3000;
	const positions = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		const r = 4000;
		positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = Math.abs(r * Math.cos(phi));
		positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
		sizes[i] = 1 + Math.random() * 3;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
	const mat = new THREE.PointsMaterial({
		color: 0xffffff,
		size: 3,
		sizeAttenuation: false,
		transparent: true,
		opacity: 0,
	});
	return new THREE.Points(geo, mat);
}

/** Create sky dome, sun light, and ambient light. Returns references for per-frame updates. */
export function setupSky(scene: THREE.Scene): {
	uniforms: Record<string, THREE.IUniform>;
	mesh: THREE.Mesh;
} {
	const sky = new Sky();
	sky.scale.setScalar(10000);
	// Exclude sky from bloom — clamp output below bloom threshold
	(sky.material as THREE.ShaderMaterial).onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			"gl_FragColor = vec4( texColor, 1.0 );",
			"gl_FragColor = vec4( min(texColor, vec3(0.72)), 1.0 );",
		);
	};
	scene.add(sky);
	const uniforms = sky.material.uniforms;
	uniforms.turbidity.value = 4;
	uniforms.rayleigh.value = 2;
	uniforms.mieCoefficient.value = 0.005;
	uniforms.mieDirectionalG.value = 0.8;
	const sunPos = new THREE.Vector3();
	const phi = THREE.MathUtils.degToRad(90 - 45);
	const theta = THREE.MathUtils.degToRad(180);
	sunPos.setFromSphericalCoords(1, phi, theta);
	uniforms.sunPosition.value.copy(sunPos);
	return { uniforms, mesh: sky };
}

/** Apply time-of-day settings: sun position, light colors/intensity, fog, stars, bloom. */
export function applyTimeOfDay(hour: number): void {
	const {
		scene: sc,
		sun,
		ambient,
		skyUniforms,
		stars,
		streetLights,
		lightFixtures,
		terrainMaterial,
		roadMaterial,
		roadSnowOverlayMaterial,
		renderer,
	} = state;
	if (!sc || !sun || !ambient) return;
	const st = getTimeState(hour);

	// Weather multipliers for sun/ambient intensity
	const WEATHER_MULT: Record<WeatherType, { sun: number; ambient: number }> = {
		clear: { sun: 1.0, ambient: 1.0 },
		cloudy: { sun: 0.6, ambient: 0.8 },
		rain: { sun: 0.4, ambient: 0.7 },
		heavy_rain: { sun: 0.15, ambient: 0.4 },
		fog: { sun: 0.2, ambient: 0.4 },
		snow: { sun: 0.5, ambient: 0.8 },
	};
	const STAR_MULT: Record<WeatherType, number> = {
		clear: 1.0,
		cloudy: 0.4,
		rain: 0.0,
		heavy_rain: 0.0,
		fog: 0.1,
		snow: 0.0,
	};

	const wm = WEATHER_MULT[state.currentWeather];
	const sunElev = THREE.MathUtils.degToRad(st.sunElevation);
	const sunAzimuth = THREE.MathUtils.degToRad(((hour - 6) / 12) * 180);
	const sunDir = new THREE.Vector3(
		Math.cos(sunElev) * Math.sin(sunAzimuth),
		Math.sin(sunElev),
		Math.cos(sunElev) * Math.cos(sunAzimuth),
	);

	// ── Sun light ───────────────────────────────────────────────────────
	sun.color.setRGB(...st.sunColor);
	sun.intensity = st.sunIntensity * wm.sun;
	sun.position.copy(sunDir).multiplyScalar(300);

	ambient.color.setRGB(...st.ambientColor);
	ambient.intensity = st.ambientIntensity * wm.ambient;

	const fog = sc.fog as THREE.Fog;
	fog.color.setRGB(...st.fogColor);
	fog.near = st.fogNear;
	fog.far = st.fogFar;

	if (skyUniforms) {
		skyUniforms.turbidity.value = st.turbidity;
		skyUniforms.rayleigh.value = st.rayleigh;
		skyUniforms.sunPosition.value.copy(sunDir);
	}

	if (stars) {
		(stars.material as THREE.PointsMaterial).opacity =
			st.starsOpacity * STAR_MULT[state.currentWeather];
	}

	const nightFactor = Math.max(0, 1 - st.sunIntensity / 0.3);
	for (const light of streetLights) {
		// SpotLights need higher intensity to match PointLight coverage
		const mult = light instanceof THREE.SpotLight ? 3 : 1;
		light.intensity = nightFactor * 30 * mult;
	}
	for (const fixture of lightFixtures) {
		const mat = fixture.material as THREE.MeshLambertMaterial;
		const bloomMult = (fixture.userData.bloomMult as number) ?? 1.0;
		mat.emissiveIntensity = 0.15 + nightFactor * 25 * bloomMult;
	}

	// House windows glow warmly at night
	for (const win of state.houseWindows) {
		const mat = win.material as THREE.MeshStandardMaterial;
		const bloomMult = (win.userData.bloomMult as number) ?? 1.0;
		mat.emissive = mat.emissive || new THREE.Color(0.9, 0.7, 0.3);
		mat.emissiveIntensity = nightFactor * 2.5 * bloomMult;
	}

	const sunDirNorm = sunDir.clone().normalize();
	if (terrainMaterial) {
		const u = terrainMaterial.uniforms;
		u.uSunDir.value.copy(sunDirNorm);
		u.uSunIntensity.value = st.sunIntensity;
		u.uSunColor.value.setRGB(...st.sunColor);
		u.uAmbientColor.value.setRGB(...st.ambientColor);
		u.uAmbientIntensity.value = st.ambientIntensity;
		u.uFogColor.value.setRGB(...st.fogColor);
		u.uFogNear.value = st.fogNear;
		u.uFogFar.value = st.fogFar;
		u.uStreetLightIntensity.value = nightFactor;
	}

	if (roadSnowOverlayMaterial) {
		const u = roadSnowOverlayMaterial.uniforms;
		u.uSunDir.value.copy(sunDirNorm);
		u.uSunColor.value.setRGB(...st.sunColor);
		u.uSunIntensity.value = st.sunIntensity;
		u.uAmbientColor.value.setRGB(...st.ambientColor);
		u.uAmbientIntensity.value = st.ambientIntensity;
		u.uFogColor.value.setRGB(...st.fogColor);
		u.uFogNear.value = st.fogNear;
		u.uFogFar.value = st.fogFar;
	}

	if (state.concreteSlabMaterial) {
		const u = state.concreteSlabMaterial.uniforms;
		u.uSunDir.value.copy(sunDirNorm);
		u.uSunColor.value.setRGB(...st.sunColor);
		u.uAmbient.value.setRGB(...st.ambientColor);
		u.uFogColor.value.setRGB(...st.fogColor);
		u.uFogDensity.value = 1.0 / Math.max(1, st.fogFar - st.fogNear);
	}

	if (renderer) {
		const biomeExpMult = state.currentBiome?.exposureMult ?? 1.0;
		renderer.toneMappingExposure = (0.4 + st.sunIntensity * 0.4) * biomeExpMult;
		if (roadMaterial) {
			// Base roughness: 0.7 (night) to 1.0 (day); rain makes it shinier
			const wetReduction = state.roadWetness * 0.4;
			roadMaterial.roughness =
				state.roadRoughnessBase * (0.7 + st.sunIntensity * 0.3) * (1 - wetReduction);
			roadMaterial.metalness = 0.02 + state.roadWetness * 0.15;
		}
	}
}
