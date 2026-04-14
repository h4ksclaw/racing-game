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

	// Snow patch mask
	float threshold = 1.0 - uSnowAmount * 0.8;
	float snowMask = smoothstep(threshold - 0.05, threshold + 0.05, snowPatch);
	float edgeFade = smoothstep(threshold, threshold + 0.15, snowPatch);
	float thickness = mix(0.3, 0.85, edgeFade);

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

		if (i >= samples.length - 1) break;

		const rb = i * 2;
		roadIndices.push(rb, rb + 1, rb + 2, rb + 1, rb + 3, rb + 2);

		const kb = i * 4;
		kerbIndices.push(kb, kb + 1, kb + 4, kb + 1, kb + 5, kb + 4);
		kerbIndices.push(kb + 2, kb + 6, kb + 3, kb + 3, kb + 6, kb + 7);

		const gb = i * 4;
		grassIndices.push(gb, gb + 1, gb + 4, gb + 1, gb + 5, gb + 4);
		grassIndices.push(gb + 2, gb + 6, gb + 3, gb + 3, gb + 6, gb + 7);
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

	// Spline visualization
	const splinePoints = data.splinePoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
	const splineGeo = new THREE.BufferGeometry().setFromPoints(splinePoints);
	group.add(new THREE.Line(splineGeo, new THREE.LineBasicMaterial({ color: 0x00ff88 })));

	// Control points
	const cpMat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
	for (const cp of data.controlPoints3D) {
		const marker = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cpMat);
		marker.position.set(cp.x, cp.y + 2, cp.z);
		group.add(marker);
	}

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
