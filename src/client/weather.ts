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

// ── Cloud layer ────────────────────────────────────────────────────────

/** Build a cloud layer group with ~50 procedurally-generated puffy clouds. */
export function buildCloudLayer(): THREE.Group {
	const group = new THREE.Group();
	const cloudCount = 50;
	const spread = 1200;
	const height = 300;

	// Reusable cloud material
	const cloudMat = new THREE.MeshBasicMaterial({
		color: new THREE.Color(0.92, 0.92, 0.95),
		transparent: true,
		opacity: 0.7,
		depthWrite: false,
		side: THREE.DoubleSide,
	});

	for (let i = 0; i < cloudCount; i++) {
		const cloudGroup = new THREE.Group();

		// Build puffy cloud from overlapping spheres
		const blobCount = 4 + Math.floor(Math.random() * 6);
		const baseSize = 30 + Math.random() * 50;

		for (let b = 0; b < blobCount; b++) {
			const isFlat = Math.random() < 0.4;
			const w = baseSize * (0.5 + Math.random() * 1.0);
			const h = isFlat
				? baseSize * (0.15 + Math.random() * 0.2)
				: baseSize * (0.4 + Math.random() * 0.6);
			const d = baseSize * (0.4 + Math.random() * 0.8);
			const geo = new THREE.SphereGeometry(1, 16, 12);
			geo.scale(w, h, d);
			const mesh = new THREE.Mesh(geo, cloudMat);
			mesh.position.set(
				(Math.random() - 0.5) * baseSize * 1.5,
				(Math.random() - 0.5) * baseSize * 0.3,
				(Math.random() - 0.5) * baseSize * 1.0,
			);
			cloudGroup.add(mesh);
		}

		cloudGroup.position.set(
			(Math.random() - 0.5) * spread,
			height + Math.random() * 150,
			(Math.random() - 0.5) * spread,
		);
		cloudGroup.userData.baseOpacity = 0.5 + Math.random() * 0.4;
		cloudGroup.userData.baseY = cloudGroup.position.y;
		group.add(cloudGroup);
	}

	group.visible = false;
	return group;
}

// ── Particle systems ────────────────────────────────────────────────────

/** Build rain particle system. Returns the Points mesh and a velocity array for animation. */
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

/** Build snow particle system. Returns the Points mesh and a drift array for animation. */
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

/** Update rain particle velocities (called each frame by the animation loop). */
export function setRainVelocities(v: Float32Array): void {
	rainVelocities = v;
}

/** Update snow particle drift offsets (called each frame by the animation loop). */
export function setSnowDrifts(v: Float32Array): void {
	snowDrifts = v;
}

/** Advance weather animation by `delta` seconds. Updates rain, snow, clouds, fog. */
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

// ── Cloud weather settings ─────────────────────────────────────────────

interface CloudWeatherSetting {
	visible: boolean;
	opacity: number;
	color: [number, number, number];
	scale: number;
	yOffset: number;
}

const CLOUD_SETTINGS: Record<string, CloudWeatherSetting> = {
	clear: { visible: false, opacity: 0, color: [0.92, 0.92, 0.95], scale: 1, yOffset: 0 },
	cloudy: { visible: true, opacity: 0.55, color: [0.85, 0.85, 0.88], scale: 1.3, yOffset: -20 },
	rain: { visible: true, opacity: 0.75, color: [0.5, 0.5, 0.55], scale: 1.8, yOffset: -60 },
	heavy_rain: { visible: true, opacity: 0.9, color: [0.3, 0.3, 0.35], scale: 2.5, yOffset: -100 },
	snow: { visible: true, opacity: 0.65, color: [0.72, 0.73, 0.78], scale: 1.6, yOffset: -40 },
	fog: { visible: true, opacity: 0.8, color: [0.65, 0.65, 0.68], scale: 2.0, yOffset: -80 },
};

function applyCloudWeather(weather: WeatherType, cloudLayer: THREE.Group): void {
	const cs = CLOUD_SETTINGS[weather] ?? CLOUD_SETTINGS.clear;
	cloudLayer.visible = cs.visible;

	if (!cs.visible) return;

	// Factor in time of day — clouds go dark at night
	const hour = state.currentTime ?? 12;
	const isNight = hour < 5 || hour > 21;
	const isDusk = (hour >= 5 && hour < 7) || (hour >= 19 && hour <= 21);
	let nightDim: number;
	let nightTint: THREE.Color;
	if (isNight) {
		nightDim = 0.08;
		nightTint = new THREE.Color(0.05, 0.05, 0.1);
	} else if (isDusk) {
		// Smooth transition at dawn/dusk
		let t: number;
		if (hour < 7) t = (hour - 5) / 2;
		else t = (21 - hour) / 2;
		nightDim = 0.08 + t * 0.92;
		nightTint = new THREE.Color(0.05 + t * 0.85, 0.05 + t * 0.8, 0.1 + t * 0.85);
	} else {
		nightDim = 1.0;
		nightTint = new THREE.Color(1, 1, 1);
	}

	const cloudColor = new THREE.Color(...cs.color);
	cloudColor.multiply(nightTint);
	cloudColor.multiplyScalar(nightDim);

	for (const cloud of cloudLayer.children) {
		cloud.scale.setScalar(cs.scale);
		cloud.position.y = (cloud.userData.baseY ?? 375) + cs.yOffset;

		for (const child of cloud.children) {
			if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
				child.material.opacity =
					cs.opacity * (cloud.userData.baseOpacity ?? 0.6) * Math.max(nightDim, 0.15);
				child.material.color.copy(cloudColor);
			}
		}
	}
}

/** Switch to a new weather type. Toggles rain/snow visibility, adjusts fog, wetness, lighting, and terrain tint. */
export function applyWeather(weather: WeatherType): void {
	const {
		rainSystem,
		snowSystem,
		currentTime,
		sun,
		ambient,
		skyUniforms,
		scene: sc,
		cloudLayer,
		skyMesh,
	} = state;
	if (!rainSystem || !snowSystem) return;
	state.currentWeather = weather;

	// ── Particle visibility ─────────────────────────────────────────────
	rainSystem.visible = weather === "rain" || weather === "heavy_rain";
	snowSystem.visible = weather === "snow";

	if (cloudLayer) {
		applyCloudWeather(weather, cloudLayer);
	}

	// Night dimming for particles
	const nightDim = currentTime > 20 || currentTime < 5 ? 0.3 : currentTime > 18 ? 0.6 : 1.0;
	(rainSystem.material as THREE.PointsMaterial).color.setRGB(
		0.67 * nightDim,
		0.8 * nightDim,
		1.0 * nightDim,
	);
	(rainSystem.material as THREE.PointsMaterial).opacity =
		(weather === "heavy_rain" ? 0.8 : 0.5) * nightDim;
	(snowSystem.material as THREE.PointsMaterial).color.setRGB(
		0.7 + 0.3 * nightDim,
		0.7 + 0.3 * nightDim,
		0.8 + 0.2 * nightDim,
	);
	(snowSystem.material as THREE.PointsMaterial).opacity = 0.9 * nightDim;

	if (!sun || !ambient || !sc) return;

	// ── Fog & sky config per weather type ────────────────────────────────
	const isNight = currentTime > 20 || currentTime < 5;
	const fog = sc.fog as THREE.Fog;

	const WEATHER_FOG: Partial<
		Record<
			WeatherType,
			{ turbidity: number; far: number; near: number; color?: [number, number, number] }
		>
	> = {
		clear: { turbidity: 0, far: Infinity, near: 0 },
		cloudy: { turbidity: 10, far: Infinity, near: 0 },
		rain: { turbidity: 15, far: 600, near: 100 },
		heavy_rain: {
			turbidity: 20,
			far: 250,
			near: 10,
			color: isNight ? [0.05, 0.05, 0.07] : [0.18, 0.19, 0.22],
		},
		fog: {
			turbidity: 15,
			far: 120,
			near: 1,
			color: isNight ? [0.12, 0.12, 0.15] : [0.65, 0.67, 0.7],
		},
		snow: { turbidity: 8, far: 500, near: 30, color: [0.6, 0.62, 0.68] },
	};

	const fogCfg = WEATHER_FOG[weather];
	if (fogCfg && skyUniforms) {
		if (fogCfg.turbidity > 0) {
			skyUniforms.turbidity.value = Math.max(skyUniforms.turbidity.value, fogCfg.turbidity);
		}
		if (fogCfg.far < Infinity) {
			fog.far = Math.min(fog.far, fogCfg.far);
			fog.near = Math.max(fog.near, fogCfg.near);
		}
		if (fogCfg.color) {
			fog.color.setRGB(...fogCfg.color);
		}
	}

	// ── Terrain shader sync ─────────────────────────────────────────────
	const WEATHER_LIGHTING: Record<WeatherType, { sun: number; ambient: number }> = {
		clear: { sun: 1.0, ambient: 1.0 },
		cloudy: { sun: 0.6, ambient: 0.8 },
		rain: { sun: 0.4, ambient: 0.7 },
		heavy_rain: { sun: 0.2, ambient: 0.5 },
		fog: { sun: 0.3, ambient: 0.6 },
		snow: { sun: 0.5, ambient: 0.8 },
	};

	const WEATHER_ROAD: Record<WeatherType, { roughness: number; wetness: number }> = {
		clear: { roughness: 0.8, wetness: 0.0 },
		cloudy: { roughness: 0.8, wetness: 0.0 },
		rain: { roughness: 0.25, wetness: 0.7 },
		heavy_rain: { roughness: 0.15, wetness: 1.0 },
		fog: { roughness: 0.7, wetness: 0.2 },
		snow: { roughness: 0.9, wetness: 0.0 },
	};

	if (state.terrainMaterial) {
		state.terrainMaterial.uniforms.uFogColor.value.copy(fog.color);
		state.terrainMaterial.uniforms.uFogNear.value = fog.near;
		state.terrainMaterial.uniforms.uFogFar.value = fog.far;

		const lighting = WEATHER_LIGHTING[weather];
		state.terrainMaterial.uniforms.uSunIntensity.value *= lighting.sun;
		state.terrainMaterial.uniforms.uAmbientIntensity.value *= lighting.ambient;

		// Weather-based terrain tint shifts
		const gt = state.terrainMaterial.uniforms.uGrassTint.value;
		const dt = state.terrainMaterial.uniforms.uDirtTint.value;
		const rt = state.terrainMaterial.uniforms.uRockTint.value;
		switch (weather) {
			case "heavy_rain":
				gt.setRGB(gt.r * 0.85, gt.g * 0.85, gt.b * 0.95);
				dt.setRGB(dt.r * 0.8, dt.g * 0.8, dt.b * 0.9);
				rt.setRGB(rt.r * 0.85, rt.g * 0.85, rt.b * 0.92);
				break;
			case "rain":
				gt.setRGB(gt.r * 0.9, gt.g * 0.9, gt.b * 0.97);
				dt.setRGB(dt.r * 0.85, dt.g * 0.85, dt.b * 0.93);
				break;
			case "fog":
				gt.setRGB(gt.r * 0.95, gt.g * 0.95, gt.b * 0.98);
				break;
		}
	}

	// ── Road surface ─────────────────────────────────────────────────────
	const road = WEATHER_ROAD[weather];
	state.roadRoughnessBase = road.roughness;
	state.roadWetness = road.wetness;

	// ── Sky dome visibility ─────────────────────────────────────────────
	const lowVisibility =
		weather === "heavy_rain" || weather === "fog" || weather === "rain" || weather === "snow";
	if (skyMesh) skyMesh.visible = !lowVisibility;
	sc.background = lowVisibility ? fog.color.clone() : new THREE.Color(0x87ceeb);
}
