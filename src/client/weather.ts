import * as THREE from "three";
import { state } from "./scene.ts";
import type { WeatherType } from "./utils.ts";

// ── Particle textures ───────────────────────────────────────────────────

function makeRainTexture(): THREE.Texture {
	const size = 32;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const grad = ctx.createLinearGradient(size / 2, 2, size / 2, size - 2);
	grad.addColorStop(0, "rgba(170,200,255,0)");
	grad.addColorStop(0.3, "rgba(170,200,255,0.6)");
	grad.addColorStop(0.7, "rgba(170,200,255,0.6)");
	grad.addColorStop(1, "rgba(170,200,255,0)");
	ctx.fillStyle = grad;
	ctx.fillRect(size / 2 - 1, 2, 2, size - 4);
	const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	glow.addColorStop(0, "rgba(170,200,255,0.15)");
	glow.addColorStop(1, "rgba(170,200,255,0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

function makeSnowTexture(): THREE.Texture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	grad.addColorStop(0, "rgba(255,255,255,1)");
	grad.addColorStop(0.3, "rgba(255,255,255,0.8)");
	grad.addColorStop(0.7, "rgba(230,235,255,0.3)");
	grad.addColorStop(1, "rgba(230,235,255,0)");
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = "rgba(255,255,255,0.4)";
	ctx.lineWidth = 1;
	for (let a = 0; a < 6; a++) {
		const angle = (a * Math.PI) / 3;
		ctx.beginPath();
		ctx.moveTo(size / 2, size / 2);
		ctx.lineTo(size / 2 + Math.cos(angle) * size * 0.35, size / 2 + Math.sin(angle) * size * 0.35);
		ctx.stroke();
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.needsUpdate = true;
	return tex;
}

// ── Particle systems ────────────────────────────────────────────────────

export function buildRainSystem(): { points: THREE.Points; velocities: Float32Array } {
	const count = 6000;
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count);
	const spread = 250;
	const height = 120;
	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * spread;
		positions[i * 3 + 1] = Math.random() * height;
		positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
		velocities[i] = 2.0 + Math.random() * 3.0;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const mat = new THREE.PointsMaterial({
		map: makeRainTexture(),
		color: 0xaaccff,
		size: 1.5,
		sizeAttenuation: true,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		opacity: 0.7,
	});
	return { points: new THREE.Points(geo, mat), velocities };
}

export function buildSnowSystem(): { points: THREE.Points; drifts: Float32Array } {
	const count = 4000;
	const positions = new Float32Array(count * 3);
	const drifts = new Float32Array(count * 2);
	const spread = 300;
	const height = 100;
	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * spread;
		positions[i * 3 + 1] = Math.random() * height;
		positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
		drifts[i * 2] = Math.random() * Math.PI * 2;
		drifts[i * 2 + 1] = 0.3 + Math.random() * 0.8;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const mat = new THREE.PointsMaterial({
		map: makeSnowTexture(),
		color: 0xffffff,
		size: 3.0,
		sizeAttenuation: true,
		transparent: true,
		blending: THREE.NormalBlending,
		depthWrite: false,
		opacity: 0.9,
	});
	return { points: new THREE.Points(geo, mat), drifts };
}

// ── Update & apply ──────────────────────────────────────────────────────

let rainVelocities: Float32Array | null = null;
let snowDrifts: Float32Array | null = null;

export function setRainVelocities(v: Float32Array): void {
	rainVelocities = v;
}

export function setSnowDrifts(v: Float32Array): void {
	snowDrifts = v;
}

export function updateWeather(delta: number): void {
	const { scene: sc, camera, rainSystem, snowSystem, currentWeather: weather } = state;
	if (!sc || !camera) return;

	const camX = camera.position.x;
	const camY = camera.position.y;
	const camZ = camera.position.z;

	if (rainSystem && rainVelocities) {
		const isHeavyRain = weather === "heavy_rain";
		const pos = rainSystem.geometry.attributes.position;
		const speedMult = isHeavyRain ? 1.5 : 1.0;
		for (let i = 0; i < pos.count; i++) {
			pos.array[i * 3 + 1] -= rainVelocities[i] * delta * 60 * speedMult;
			if (pos.array[i * 3 + 1] < camY - 20) {
				pos.array[i * 3] = camX + (Math.random() - 0.5) * 250;
				pos.array[i * 3 + 1] = camY + 40 + Math.random() * 80;
				pos.array[i * 3 + 2] = camZ + (Math.random() - 0.5) * 250;
			}
		}
		pos.needsUpdate = true;
		(rainSystem.material as THREE.PointsMaterial).opacity = isHeavyRain ? 0.8 : 0.5;
	}

	if (snowSystem && snowDrifts) {
		const pos = snowSystem.geometry.attributes.position;
		const time = performance.now() * 0.001;
		for (let i = 0; i < pos.count; i++) {
			pos.array[i * 3 + 1] -= (0.3 + snowDrifts[i * 2 + 1] * 0.2) * delta * 60;
			pos.array[i * 3] +=
				Math.sin(time * snowDrifts[i * 2 + 1] + snowDrifts[i * 2]) * 0.3 * delta * 60;
			pos.array[i * 3 + 2] +=
				Math.cos(time * snowDrifts[i * 2 + 1] * 0.7 + snowDrifts[i * 2]) * 0.2 * delta * 60;
			if (pos.array[i * 3 + 1] < camY - 20) {
				pos.array[i * 3] = camX + (Math.random() - 0.5) * 300;
				pos.array[i * 3 + 1] = camY + 30 + Math.random() * 70;
				pos.array[i * 3 + 2] = camZ + (Math.random() - 0.5) * 300;
			}
		}
		pos.needsUpdate = true;
	}
}

export function applyWeather(weather: WeatherType): void {
	const { rainSystem, snowSystem, currentTime, sun, ambient, skyUniforms, scene: sc } = state;
	if (!rainSystem || !snowSystem) return;
	state.currentWeather = weather;

	const rainVisible = weather === "rain" || weather === "heavy_rain";
	const snowVisible = weather === "snow";
	rainSystem.visible = rainVisible;
	snowSystem.visible = snowVisible;

	const nightDim = currentTime > 20 || currentTime < 5 ? 0.3 : currentTime > 18 ? 0.6 : 1.0;
	(rainSystem.material as THREE.PointsMaterial).color.setRGB(
		0.67 * nightDim,
		0.8 * nightDim,
		1.0 * nightDim,
	);
	(rainSystem.material as THREE.PointsMaterial).opacity =
		(weather === "heavy_rain" ? 0.8 : 0.5) * nightDim;
	(snowSystem.material as THREE.PointsMaterial).opacity = 0.9 * Math.max(0.4, nightDim);

	if (!sun || !ambient || !sc) return;

	switch (weather) {
		case "clear":
			break;
		case "cloudy":
			if (skyUniforms) {
				skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, 10);
			}
			break;
		case "rain": {
			if (skyUniforms) {
				skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, 15);
			}
			const fogR = sc.fog as THREE.Fog;
			fogR.far = Math.min(fogR.far, 600);
			fogR.near = Math.max(fogR.near, 100);
			break;
		}
		case "heavy_rain": {
			if (skyUniforms) {
				skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, 20);
			}
			const fogH = sc.fog as THREE.Fog;
			fogH.far = 250;
			fogH.near = 10;
			const isNight = currentTime > 20 || currentTime < 5;
			fogH.color.setRGB(isNight ? 0.05 : 0.18, isNight ? 0.05 : 0.19, isNight ? 0.07 : 0.22);
			break;
		}
		case "fog": {
			if (skyUniforms) {
				skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, 15);
			}
			const fogF = sc.fog as THREE.Fog;
			fogF.far = 120;
			fogF.near = 1;
			const isNightF = state.currentTime > 20 || state.currentTime < 5;
			fogF.color.setRGB(isNightF ? 0.12 : 0.65, isNightF ? 0.12 : 0.67, isNightF ? 0.15 : 0.7);
			break;
		}
		case "snow": {
			if (skyUniforms) {
				skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, 8);
			}
			const fogS = sc.fog as THREE.Fog;
			fogS.far = Math.min(fogS.far, 500);
			fogS.near = Math.max(fogS.near, 30);
			fogS.color.setRGB(0.6, 0.62, 0.68);
			break;
		}
	}
	// Sync terrain shader fog and lighting uniforms with weather
	if (state.terrainMaterial) {
		if (sc?.fog) {
			const tf = sc.fog as THREE.Fog;
			state.terrainMaterial.uniforms.uFogColor.value.copy(tf.color);
			state.terrainMaterial.uniforms.uFogNear.value = tf.near;
			state.terrainMaterial.uniforms.uFogFar.value = tf.far;
		}
		// Dim terrain sun/ambient to match weather
		const weatherSunMult =
			weather === "heavy_rain"
				? 0.2
				: weather === "rain"
					? 0.4
					: weather === "fog"
						? 0.3
						: weather === "cloudy"
							? 0.6
							: weather === "snow"
								? 0.5
								: 1.0;
		const weatherAmbMult =
			weather === "heavy_rain"
				? 0.5
				: weather === "rain"
					? 0.7
					: weather === "fog"
						? 0.6
						: weather === "cloudy"
							? 0.8
							: weather === "snow"
								? 0.8
								: 1.0;
		state.terrainMaterial.uniforms.uSunIntensity.value *= weatherSunMult;
		state.terrainMaterial.uniforms.uAmbientIntensity.value *= weatherAmbMult;

		// Weather-based terrain tint shifts
		const gt = state.terrainMaterial.uniforms.uGrassTint.value;
		const dt = state.terrainMaterial.uniforms.uDirtTint.value;
		const rt = state.terrainMaterial.uniforms.uRockTint.value;
		switch (weather) {
			case "heavy_rain":
				// Wet ground — darker, slightly blue-shifted
				gt.setRGB(gt.r * 0.85, gt.g * 0.85, gt.b * 0.95);
				dt.setRGB(dt.r * 0.8, dt.g * 0.8, dt.b * 0.9);
				rt.setRGB(rt.r * 0.85, rt.g * 0.85, rt.b * 0.92);
				break;
			case "rain":
				gt.setRGB(gt.r * 0.9, gt.g * 0.9, gt.b * 0.97);
				dt.setRGB(dt.r * 0.85, dt.g * 0.85, dt.b * 0.93);
				break;
			case "snow":
				// Snow brightens and cools terrain slightly
				gt.setRGB(
					Math.min(gt.r * 1.05, 1.2),
					Math.min(gt.g * 1.05, 1.2),
					Math.min(gt.b * 1.1, 1.3),
				);
				rt.setRGB(
					Math.min(rt.r * 1.05, 1.2),
					Math.min(rt.g * 1.05, 1.2),
					Math.min(rt.b * 1.1, 1.3),
				);
				break;
			case "fog":
				// Fog desaturates slightly
				gt.setRGB(gt.r * 0.95, gt.g * 0.95, gt.b * 0.98);
				break;
		}
	}

	// Weather effects on road surface
	switch (weather) {
		case "heavy_rain":
			state.roadRoughnessBase = 0.15;
			state.roadWetness = 1.0;
			break;
		case "rain":
			state.roadRoughnessBase = 0.25;
			state.roadWetness = 0.7;
			break;
		case "snow":
			state.roadRoughnessBase = 0.9;
			state.roadWetness = 0.0;
			break;
		case "fog":
			state.roadRoughnessBase = 0.7;
			state.roadWetness = 0.2;
			break;
		default:
			state.roadRoughnessBase = 0.8;
			state.roadWetness = 0.0;
	}
}
