import type { TrackSample } from "@shared/track.ts";
import * as THREE from "three";
import type { BiomeConfig } from "./biomes.ts";
import { state } from "./scene.ts";
import type { TerrainSampler } from "./terrain.ts";
import type { TrackResponse } from "./utils.ts";

// ── Texture helpers ───────────────────────────────────────────────────

function loadTex(path: string, srgb = true): Promise<THREE.Texture> {
	return new Promise((resolve, reject) =>
		new THREE.TextureLoader().load(
			path,
			(tex) => {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
				tex.anisotropy = 16;
				if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
				resolve(tex);
			},
			undefined,
			reject,
		),
	);
}

// ── Road snow overlay shader ─────────────────────────────────────────

const snowOverlayVert = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
varying vec3 vNormal;

void main() {
	vUv = uv;
	vNormal = normalize(normalMatrix * normal);
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const snowOverlayFrag = /* glsl */ `
uniform float uSnowAmount;
uniform float uSnowThreshold; // height at which snow begins (same as terrain)
uniform float uAvgRoadY;      // average road Y (passed in)
uniform vec3 uSnowColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vWorldPos;
varying vec2 vUv;
varying vec3 vNormal;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float snowNoise(vec2 p) {
	float n = 0.0;
	n += vnoise(p * 0.8) * 0.5;
	n += vnoise(p * 1.6 + 3.7) * 0.25;
	n += vnoise(p * 3.2 + 7.1) * 0.125;
	n += vnoise(p * 6.4 + 13.3) * 0.0625;
	return n / 0.9375;
}

void main() {
	vec2 wp = vWorldPos.xz;
	float snowPatch = snowNoise(wp);

	// Height-based fade: snow only appears above snowThreshold
	float aboveRoad = vWorldPos.y - uAvgRoadY;
	float heightFade = smoothstep(uSnowThreshold, uSnowThreshold + 30.0, aboveRoad);
	// At very high elevations, snow is solid regardless of noise
	float heightSolid = smoothstep(uSnowThreshold + 60.0, uSnowThreshold + 100.0, aboveRoad);

	// Snow patch mask
	float threshold = 1.0 - uSnowAmount * 0.8;
	float snowMask = smoothstep(threshold - 0.05, threshold + 0.05, snowPatch);
	float edgeFade = smoothstep(threshold, threshold + 0.15, snowPatch);
	float thickness = mix(0.3, 0.85, edgeFade);

	// Apply height fade — low areas get no road snow
	snowMask *= mix(heightFade, 1.0, heightSolid);
	thickness *= mix(heightFade, 1.0, heightSolid);

	// Tire tracks — clear strips at 32% and 68%
	float u = vUv.x;
	float leftTrack  = 1.0 - smoothstep(0.05, 0.10, abs(u - 0.32));
	float rightTrack = 1.0 - smoothstep(0.05, 0.10, abs(u - 0.68));
	float snowTrack = 1.0 - max(leftTrack, rightTrack);
	snowMask *= snowTrack;

	if (snowMask < 0.01) discard;

	// ── Proper lighting (same as terrain) ──
	vec3 N = normalize(vNormal);
	vec3 sunDir = normalize(uSunDir);

	// Diffuse (Lambert)
	float NdotL = max(dot(N, sunDir), 0.0);

	// Ambient
	vec3 ambient = uAmbientColor * uAmbientIntensity;

	// Snow diffuse — slightly boosted because snow is highly reflective
	vec3 diffuse = uSunColor * uSunIntensity * NdotL * 1.2;

	// Subtle specular on snow (sun sparkle)
	vec3 viewDir = normalize(cameraPosition - vWorldPos);
	vec3 halfDir = normalize(sunDir + viewDir);
	float spec = pow(max(dot(N, halfDir), 0.0), 64.0) * uSunIntensity * 0.3;

	vec3 lighting = ambient + diffuse + vec3(spec);

	// Snow color with slight noise variation
	float variation = vnoise(wp * 5.0) * 0.06 - 0.03;
	vec3 baseColor = uSnowColor * (1.0 + variation);

	// Dirty edges
	baseColor = mix(baseColor * 0.6, baseColor, edgeFade);

	vec3 color = baseColor * lighting;

	// Fog
	float dist = length(vWorldPos - cameraPosition);
	float fogFactor = smoothstep(uFogNear, uFogFar, dist);
	color = mix(color, uFogColor, fogFactor);

	gl_FragColor = vec4(color, snowMask * thickness * 0.9);
}
`;

let roadTextures: {
	color: THREE.Texture;
	normal: THREE.Texture;
	roughness: THREE.Texture;
} | null = null;

async function loadRoadTextures() {
	if (roadTextures) return roadTextures;
	const [color, normal, roughness] = await Promise.all([
		loadTex("/textures/road_asphalt/Road007_1K-JPG_Color.jpg"),
		loadTex("/textures/road_asphalt/Road007_1K-JPG_NormalGL.jpg", false),
		loadTex("/textures/road_asphalt/Road007_1K-JPG_Roughness.jpg", false),
	]);
	roadTextures = { color, normal, roughness };
	return roadTextures;
}

// ── Geometry helper ─────────────────────────────────────────────────────

function makeGeo(
	verts: number[],
	indices: number[],
	uvs?: number[],
	colors?: number[],
): THREE.BufferGeometry {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
	if (uvs) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
	if (colors) geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
	geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
	geo.computeVertexNormals();
	return geo;
}

// ── Build track meshes ──────────────────────────────────────────────────

export async function buildMeshes(
	data: TrackResponse,
	rng: () => number,
	biome?: BiomeConfig,
	avgRoadY?: number,
): Promise<THREE.Group> {
	const group = new THREE.Group();
	const samples = data.samples;

	const roadVerts: number[] = [];
	const roadUVs: number[] = [];
	const roadIndices: number[] = [];
	const kerbVerts: number[] = [];
	const kerbColors: number[] = [];
	const kerbIndices: number[] = [];
	const grassVerts: number[] = [];
	const grassColors: number[] = [];
	const grassIndices: number[] = [];
	const concreteVerts: number[] = [];
	const concreteUVs: number[] = [];
	const concreteIndices: number[] = [];
	const slabCfg = biome?.concreteSlab ?? {
		texture: "/textures/path/Pathway004_1K-JPG",
		tint: [0.55, 0.52, 0.48] as [number, number, number],
		earthColor: [0.38, 0.33, 0.25] as [number, number, number],
		dropMax: 0.15,
	};
	let roadDist = 0;

	const KERB_RED = [0.8, 0.2, 0.2];
	const KERB_WHITE = [0.9, 0.9, 0.9];
	const kerbStripeLen = 2.0;

	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		if (i > 0) {
			const dx = s.point.x - samples[i - 1].point.x;
			const dy = s.point.y - samples[i - 1].point.y;
			const dz = s.point.z - samples[i - 1].point.z;
			roadDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
		}

		roadVerts.push(s.left.x, s.left.y + 0.02, s.left.z, s.right.x, s.right.y + 0.02, s.right.z);
		roadUVs.push(0, roadDist / 4, 1, roadDist / 4);

		// ── Kerb (flat, same as before) ──
		kerbVerts.push(
			s.left.x,
			s.left.y + 0.03,
			s.left.z,
			s.kerbLeft.x,
			s.kerbLeft.y + 0.03,
			s.kerbLeft.z,
			s.right.x,
			s.right.y + 0.03,
			s.right.z,
			s.kerbRight.x,
			s.kerbRight.y + 0.03,
			s.kerbRight.z,
		);
		const stripe = Math.floor(roadDist / kerbStripeLen) % 2 === 0 ? KERB_RED : KERB_WHITE;
		kerbColors.push(...stripe, ...stripe, ...stripe, ...stripe);

		// ── Grass shoulder (simple 4-vertex quad, same as original) ──
		grassVerts.push(
			s.kerbLeft.x,
			s.kerbLeft.y + 0.01,
			s.kerbLeft.z,
			s.grassLeft.x,
			s.grassLeft.y + 0.01,
			s.grassLeft.z,
			s.kerbRight.x,
			s.kerbRight.y + 0.01,
			s.kerbRight.z,
			s.grassRight.x,
			s.grassRight.y + 0.01,
			s.grassRight.z,
		);
		const gv = 0.3 + Math.sin(roadDist * 0.3) * 0.04 + (rng() - 0.5) * 0.03;
		grassColors.push(0.28, gv + 0.04, 0.2, 0.28, gv, 0.2, 0.28, gv + 0.04, 0.2, 0.28, gv, 0.2);

		// ── Concrete base slab (narrow strip past grass edges) ──
		// Multi-frequency noise for organic irregular edges
		const n1L =
			Math.sin(i * 0.13 + roadDist * 0.05) * 0.4 + Math.sin(i * 0.37 + roadDist * 0.02) * 0.25;
		const n2L = Math.sin(i * 0.71 + 1.3) * 0.15 + Math.sin(i * 1.53 + roadDist * 0.08) * 0.1;
		const n3L = Math.sin(i * 3.17 + 2.7) * 0.06;
		const deformL = n1L + n2L + n3L;
		const n1R =
			Math.sin(i * 0.17 + roadDist * 0.04 + 2.0) * 0.4 +
			Math.sin(i * 0.29 + roadDist * 0.03 + 0.5) * 0.25;
		const n2R = Math.sin(i * 0.63 + 3.1) * 0.15 + Math.sin(i * 1.41 + roadDist * 0.07 + 1.2) * 0.1;
		const n3R = Math.sin(i * 2.93 + 0.8) * 0.06;
		const deformR = n1R + n2R + n3R;
		// Extend past grass edge (width varies with noise)
		const slabBase = 0.75;
		const extL = slabBase + deformL * 0.3;
		const extR = slabBase + deformR * 0.3;
		// 5 verts per side: road(0) → mid(0.25) → grass(0.5) → slope(0.75) → outer(1.0)
		const slabSteps = 5;
		const leftPts: [number, number, number][] = [];
		const rightPts: [number, number, number][] = [];
		for (let j = 0; j < slabSteps; j++) {
			const t = j / (slabSteps - 1); // 0..1 across width
			// Smooth quadratic drop: starts gentle, steepens toward outer
			const drop =
				t *
				t *
				(slabCfg.dropMax + Math.abs(t < 0.5 ? deformL : deformL + n3L) * slabCfg.dropMax * 0.5);
			const lateralNoise = deformL * t * t * 0.6; // more noise further out
			const lx = s.left.x + s.binormal.x * (-extL * t) + lateralNoise;
			const lz = s.left.z + s.binormal.z * (-extL * t) + lateralNoise * 0.5;
			leftPts.push([lx, s.left.y + 0.02 - drop, lz]);
			// Right side
			const dropR =
				t *
				t *
				(slabCfg.dropMax + Math.abs(t < 0.5 ? deformR : deformR + n3R) * slabCfg.dropMax * 0.5);
			const lateralNoiseR = deformR * t * t * 0.6;
			const rx = s.right.x + s.binormal.x * (extR * t) + lateralNoiseR;
			const rz = s.right.z + s.binormal.z * (extR * t) + lateralNoiseR * 0.5;
			rightPts.push([rx, s.right.y + 0.02 - dropR, rz]);
		}
		// Push all verts: left side then right side
		for (const p of leftPts) concreteVerts.push(p[0], p[1], p[2]);
		for (const p of rightPts) concreteVerts.push(p[0], p[1], p[2]);
		// UVs: u = 0→1 across width
		for (let j = 0; j < slabSteps; j++) concreteUVs.push(j / (slabSteps - 1), roadDist / 3);
		for (let j = 0; j < slabSteps; j++) concreteUVs.push(j / (slabSteps - 1), roadDist / 3);

		// Closed loop: build quads connecting to next row (or row 0 for last)
		const next = (i + 1) % samples.length;
		const rb = i * 2;
		const nb = next * 2;
		roadIndices.push(rb, rb + 1, nb, rb + 1, nb + 1, nb);

		const kb = i * 4;
		const nkb = next * 4;
		kerbIndices.push(kb, kb + 1, nkb, kb + 1, nkb + 1, nkb);
		kerbIndices.push(kb + 2, nkb + 2, kb + 3, kb + 3, nkb + 2, nkb + 3);

		// Grass shoulder indices (4 verts per sample, 2 per side)
		const gb = i * 4;
		const ngb = next * 4;
		grassIndices.push(gb, gb + 1, ngb, gb + 1, ngb + 1, ngb);
		grassIndices.push(gb + 2, ngb + 2, gb + 3, gb + 3, ngb + 2, ngb + 3);

		// Concrete slab indices: 10 verts per sample (5 left + 5 right)
		const slabN = 5;
		const stride = slabN * 2; // total verts per sample
		const cb = i * stride;
		const ncb = next * stride;
		// Left side: 4 quads between current and next sample (reversed winding)
		for (let j = 0; j < slabN - 1; j++) {
			concreteIndices.push(cb + j, ncb + j, cb + j + 1, ncb + j, ncb + j + 1, cb + j + 1);
		}
		// Right side: 4 quads (normal winding)
		const slabRb = cb + slabN;
		const nslabRb = ncb + slabN;
		for (let j = 0; j < slabN - 1; j++) {
			concreteIndices.push(
				slabRb + j,
				slabRb + j + 1,
				nslabRb + j,
				slabRb + j + 1,
				nslabRb + j + 1,
				nslabRb + j,
			);
		}
	}

	const tex = await loadRoadTextures();
	const roadMat = new THREE.MeshStandardMaterial({
		map: tex.color,
		normalMap: tex.normal,
		normalScale: new THREE.Vector2(1, 1),
		roughnessMap: tex.roughness,
		roughness: biome?.roadRoughnessBase ?? 0.85,
		metalness: 0.02,
	});
	if (biome) {
		roadMat.color.setRGB(...biome.roadTint);
		state.roadRoughnessBase = biome.roadRoughnessBase;
	}
	state.roadMaterial = roadMat;

	// ── Lane markings (thin quads above road surface) ─────────────
	const ROAD_WIDTH = 12;
	const DASH_LEN = 3.0;
	const GAP_LEN = 4.0;
	const LINE_HW = 0.12; // half-width of line
	const MARK_Y = 0.04;

	function buildLine(
		samples: TrackSample[],
		offset: number, // 0=center, positive=left, negative=right
		dashed: boolean,
	): THREE.Mesh | null {
		const v: number[] = [];
		const idx: number[] = [];
		const c: number[] = [];
		let dist = 0;
		let vertCount = 0;

		for (let i = 0; i < samples.length; i++) {
			const s = samples[i];
			if (i > 0) {
				const dx = s.point.x - samples[i - 1].point.x;
				const dy = s.point.y - samples[i - 1].point.y;
				const dz = s.point.z - samples[i - 1].point.z;
				dist += Math.sqrt(dx * dx + dy * dy + dz * dz);
			}

			// Skip dashes in gap region
			if (dashed && dist % (DASH_LEN + GAP_LEN) > DASH_LEN) {
				vertCount = 0; // break the strip
				continue;
			}

			// Compute position: lerp between left and right by offset fraction
			const frac = 0.5 + offset / ROAD_WIDTH;
			const px = s.left.x + (s.right.x - s.left.x) * frac;
			const py = s.left.y + (s.right.y - s.left.y) * frac + MARK_Y;
			const pz = s.left.z + (s.right.z - s.left.z) * frac;

			// Tangent direction
			const next = i < samples.length - 1 ? samples[i + 1] : samples[i - 1];
			const tdx = next.point.x - s.point.x;
			const tdz = next.point.z - s.point.z;
			const tl = Math.sqrt(tdx * tdx + tdz * tdz) || 1;
			// Normal = perpendicular to tangent
			const nx = -tdz / tl;
			const nz = tdx / tl;

			v.push(px + nx * LINE_HW, py, pz + nz * LINE_HW, px - nx * LINE_HW, py, pz - nz * LINE_HW);
			c.push(1, 1, 1, 1, 1, 1);

			if (vertCount > 0) {
				const base = v.length / 3 - 4;
				idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
			}
			vertCount += 2;
		}

		if (v.length === 0) return null;
		const mat = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: dashed ? 0.85 : 0.9,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -1,
		});
		return new THREE.Mesh(makeGeo(v, idx, undefined, c), mat);
	}

	// Edge lines at ~10% from each side
	const edgeOffset = ROAD_WIDTH * 0.4;
	const leftEdge = buildLine(samples, edgeOffset, false);
	if (leftEdge) group.add(leftEdge);
	const rightEdge = buildLine(samples, -edgeOffset, false);
	if (rightEdge) group.add(rightEdge);
	// Center dashed line
	const centerDash = buildLine(samples, 0, true);
	if (centerDash) group.add(centerDash);

	const roadMesh = new THREE.Mesh(makeGeo(roadVerts, roadIndices, roadUVs), roadMat);
	roadMesh.receiveShadow = true;
	group.add(roadMesh);

	// ── Road snow overlay (biome-dependent) ─────────────────────
	if (biome?.roadSnowOverlay) {
		const snowOverlayMat = new THREE.ShaderMaterial({
			vertexShader: snowOverlayVert,
			fragmentShader: snowOverlayFrag,
			uniforms: {
				uSnowAmount: { value: biome.roadSnowOverlay.amount },
				uSnowThreshold: { value: biome.snowThreshold },
				uAvgRoadY: { value: 0 }, // set below after terrain is built
				uSnowColor: { value: new THREE.Color(...biome.roadSnowOverlay.color) },
				uSunDir: { value: new THREE.Vector3(0, 1, 0) },
				uSunColor: { value: new THREE.Color(1, 1, 1) },
				uSunIntensity: { value: 1.0 },
				uAmbientColor: { value: new THREE.Color(0.4, 0.45, 0.5) },
				uAmbientIntensity: { value: 0.5 },
				uFogColor: { value: new THREE.Color(0.75, 0.8, 0.85) },
				uFogNear: { value: 250 },
				uFogFar: { value: 1200 },
			},
			transparent: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});
		// Slightly raised copy of road geometry
		const overlayGeo = makeGeo(
			roadVerts.map((v, i) => (i % 3 === 1 ? v + 0.03 : v)), // raise Y by 0.03
			roadIndices,
			roadUVs,
		);
		const overlayMesh = new THREE.Mesh(overlayGeo, snowOverlayMat);
		overlayMesh.receiveShadow = true;
		group.add(overlayMesh);
		state.roadSnowOverlayMaterial = snowOverlayMat;
		// Set avgRoadY so snow overlay fades with height
		if (avgRoadY !== undefined) {
			snowOverlayMat.uniforms.uAvgRoadY.value = avgRoadY;
		}
	}

	if (kerbVerts.length > 0) {
		const kerbMat = new THREE.MeshLambertMaterial({ vertexColors: true });
		group.add(new THREE.Mesh(makeGeo(kerbVerts, kerbIndices, undefined, kerbColors), kerbMat));
	}

	if (grassVerts.length > 0) {
		const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true });
		const gm = new THREE.Mesh(makeGeo(grassVerts, grassIndices, undefined, grassColors), grassMat);
		gm.receiveShadow = true;
		group.add(gm);
	}

	// ── Concrete base slab (narrow strip under road edges) ──
	if (concreteVerts.length > 0) {
		const concreteColorMap = await loadTex(`${slabCfg.texture}_Color.jpg`);
		const concreteNormalMap = await loadTex(`${slabCfg.texture}_NormalGL.jpg`, false);
		const concreteRoughMap = await loadTex(`${slabCfg.texture}_Roughness.jpg`, false);

		// Concrete slab shader: fades to transparent at outer edge (u=1) for terrain blend
		const concreteVertShader = `
			varying vec2 vUv;
			varying vec3 vNormal;
			varying vec3 vWorldPos;
			void main() {
				vUv = uv;
				vNormal = normalize(normalMatrix * normal);
				vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`;
		const concreteFragShader = `
			uniform sampler2D uColorMap;
			uniform sampler2D uNormalMap;
			uniform sampler2D uRoughMap;
			uniform vec3 uTint;
			uniform vec3 uEarthColor;
			uniform vec3 uSunDir;
			uniform vec3 uSunColor;
			uniform vec3 uAmbient;
			uniform float uFogDensity;
			uniform vec3 uFogColor;
			varying vec2 vUv;
			varying vec3 vNormal;
			varying vec3 vWorldPos;
			void main() {
				vec3 N = normalize(vNormal);
				vec3 L = normalize(uSunDir);
				float NdL = max(dot(N, L), 0.0);
				// Fade: solid at u<0.4, fade out from 0.4→1.0
				float fade = 1.0;
				if (vUv.x > 0.4) {
					fade = 1.0 - smoothstep(0.4, 1.0, vUv.x);
				}
				// Sample concrete texture
				vec4 tex = texture2D(uColorMap, vUv * 3.0);
				vec3 base = tex.rgb * uTint;
				// Mix with earth color at edges for natural transition
				vec3 earthColor = uEarthColor;
				float edgeMix = smoothstep(0.2, 1.0, vUv.x);
				base = mix(base, earthColor, edgeMix * 0.6);
				// Lighting
				vec3 diffuse = base * (NdL * uSunColor + uAmbient);
				// Fog
				float dist = length(vWorldPos - cameraPosition);
				float fog = 1.0 - exp(-dist * uFogDensity);
				diffuse = mix(diffuse, uFogColor, fog);
				gl_FragColor = vec4(diffuse, fade);
			}
		`;

		const concreteMat = new THREE.ShaderMaterial({
			vertexShader: concreteVertShader,
			fragmentShader: concreteFragShader,
			uniforms: {
				uColorMap: { value: concreteColorMap },
				uNormalMap: { value: concreteNormalMap },
				uRoughMap: { value: concreteRoughMap },
				uTint: { value: new THREE.Color(...slabCfg.tint) },
				uEarthColor: { value: new THREE.Color(...slabCfg.earthColor) },
				uSunDir: { value: new THREE.Vector3(0, 1, 0) },
				uSunColor: { value: new THREE.Color(1, 1, 1) },
				uAmbient: { value: new THREE.Color(0.3, 0.3, 0.35) },
				uFogDensity: { value: 0.003 },
				uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
			},
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		state.concreteSlabMaterial = concreteMat;
		const cm = new THREE.Mesh(makeGeo(concreteVerts, concreteIndices, concreteUVs), concreteMat);
		cm.receiveShadow = true;
		group.add(cm);
	}

	// Checkers
	const width = 12;
	const checkerVerts: number[] = [];
	const checkerIndices: number[] = [];
	const checkerSize = width / 2;
	const cellSize = 1;
	const start = samples[0];
	for (let row = 0; row < 2; row++) {
		for (let col = 0; col < Math.floor(checkerSize / cellSize); col++) {
			if ((row + col) % 2 === 0) {
				const c1 = col * cellSize - checkerSize / 2 + checkerSize;
				const c2 = (col + 1) * cellSize - checkerSize / 2 + checkerSize;
				const r1 = row * cellSize - 1;
				const r2 = (row + 1) * cellSize - 1;
				const base = checkerVerts.length / 3;
				for (const [cx, cz] of [
					[c1, r1],
					[c2, r1],
					[c1, r2],
					[c2, r2],
				]) {
					checkerVerts.push(
						start.point.x + start.binormal.x * cx + start.tangent.x * cz,
						start.point.y + 0.04,
						start.point.z + start.binormal.z * cx + start.tangent.z * cz,
					);
				}
				checkerIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
			}
		}
	}
	if (checkerVerts.length > 0) {
		const checkerMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
		group.add(new THREE.Mesh(makeGeo(checkerVerts, checkerIndices), checkerMat));
	}

	// Spline visualization (hidden in production)
	// const splinePoints = data.splinePoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
	// const splineGeo = new THREE.BufferGeometry().setFromPoints(splinePoints);
	// group.add(new THREE.Line(splineGeo, new THREE.LineBasicMaterial({ color: 0x00ff88 })));

	// Control points (hidden in production)
	// const cpMat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
	// for (const cp of data.controlPoints3D) {
	// 	const marker = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cpMat);
	// 	marker.position.set(cp.x, cp.y + 2, cp.z);
	// 	group.add(marker);
	// }

	return group;
}

// ── Guardrails ──────────────────────────────────────────────────────────

export function buildGuardrails(samples: TrackSample[], terrain: TerrainSampler): THREE.Group {
	const group = new THREE.Group();
	const postMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
	const railMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });

	const postSpacing = 10;
	const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
	const railGeo = new THREE.BoxGeometry(0.06, 0.06, 1);

	const leftPosts: THREE.Vector3[] = [];
	const rightPosts: THREE.Vector3[] = [];

	for (let i = 0; i < samples.length; i += postSpacing) {
		const s = samples[i];
		const left = new THREE.Vector3(s.grassLeft.x, s.grassLeft.y, s.grassLeft.z);
		const right = new THREE.Vector3(s.grassRight.x, s.grassRight.y, s.grassRight.z);
		leftPosts.push(left);
		rightPosts.push(right);
	}

	for (const posts of [leftPosts, rightPosts]) {
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			const next = posts[(i + 1) % posts.length];

			const postMesh = new THREE.Mesh(postGeo, postMat);
			postMesh.position.set(post.x, terrain.getHeight(post.x, post.z) + 0.6, post.z);
			group.add(postMesh);

			for (const railY of [0.4, 0.9]) {
				const dir = new THREE.Vector3().subVectors(next, post);
				const len = dir.length();
				dir.normalize();

				const rail = new THREE.Mesh(railGeo, railMat);
				rail.scale.z = len;
				rail.position.set(post.x, terrain.getHeight(post.x, post.z) + railY, post.z);
				rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
				group.add(rail);
			}
		}
	}

	return group;
}
