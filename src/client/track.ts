import type { SceneryItem, TrackSample } from "@shared/track.ts";
import { generateScenery, generateTrack, mulberry32 } from "@shared/track.ts";
import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Sky } from "three/addons/objects/Sky.js";

// ── Types ────────────────────────────────────────────────────────────────

interface V3 {
	x: number;
	y: number;
	z: number;
}

interface TrackResponse {
	controlPoints3D: V3[];
	samples: TrackSample[];
	splinePoints: V3[];
	length: number;
	numControlPoints: number;
	numSamples: number;
	elevationRange: { min: number; max: number };
	seed: number;
}

// ── Day/Night Cycle ──────────────────────────────────────────────────

interface TimeKeyframe {
	hour: number;
	sunColor: [number, number, number];
	sunIntensity: number;
	sunElevation: number; // degrees
	ambientColor: [number, number, number];
	ambientIntensity: number;
	fogColor: [number, number, number];
	fogNear: number;
	fogFar: number;
	turbidity: number;
	rayleigh: number;
	starsOpacity: number;
}

const timeKeyframes: TimeKeyframe[] = [
	{
		hour: 0,
		sunColor: [0.15, 0.15, 0.3],
		sunIntensity: 0.02,
		sunElevation: -30,
		ambientColor: [0.04, 0.04, 0.08],
		ambientIntensity: 0.08,
		fogColor: [0.02, 0.02, 0.06],
		fogNear: 50,
		fogFar: 400,
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
		fogFar: 500,
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
		fogFar: 800,
		turbidity: 8,
		rayleigh: 2,
		starsOpacity: 0.1,
	},
	{
		hour: 8,
		sunColor: [1.0, 0.9, 0.7],
		sunIntensity: 1.0,
		sunElevation: 25,
		ambientColor: [0.5, 0.55, 0.6],
		ambientIntensity: 0.5,
		fogColor: [0.7, 0.75, 0.8],
		fogNear: 400,
		fogFar: 1400,
		turbidity: 4,
		rayleigh: 2,
		starsOpacity: 0,
	},
	{
		hour: 12,
		sunColor: [1.0, 1.0, 0.95],
		sunIntensity: 1.5,
		sunElevation: 65,
		ambientColor: [0.6, 0.65, 0.7],
		ambientIntensity: 0.6,
		fogColor: [0.75, 0.8, 0.85],
		fogNear: 500,
		fogFar: 1500,
		turbidity: 3,
		rayleigh: 2,
		starsOpacity: 0,
	},
	{
		hour: 16,
		sunColor: [1.0, 0.9, 0.7],
		sunIntensity: 1.1,
		sunElevation: 30,
		ambientColor: [0.5, 0.5, 0.55],
		ambientIntensity: 0.5,
		fogColor: [0.7, 0.72, 0.78],
		fogNear: 400,
		fogFar: 1300,
		turbidity: 4,
		rayleigh: 2,
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
		fogNear: 300,
		fogFar: 900,
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
		fogNear: 150,
		fogFar: 600,
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
		fogNear: 80,
		fogFar: 450,
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
		fogFar: 400,
		turbidity: 0.5,
		rayleigh: 0.5,
		starsOpacity: 1.0,
	},
];

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

function getTimeState(hour: number): TimeKeyframe {
	// Wrap to 0-24
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

function buildStars(): THREE.Points {
	const count = 3000;
	const positions = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		// Random positions on a sphere
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		const r = 4000;
		positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)); // only upper hemisphere
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

// ── Procedural textures ──────────────────────────────────────────────────

function makeAsphaltTexture(): THREE.CanvasTexture {
	const W = 512;
	const H = 1024;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D not available");

	// Asphalt base for full texture
	ctx.fillStyle = "#3a3a3a";
	ctx.fillRect(0, 0, W, H);

	// Grain noise
	const imgData = ctx.getImageData(0, 0, W, H);
	for (let i = 0; i < imgData.data.length; i += 4) {
		const n = (Math.random() - 0.5) * 35;
		imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + n));
		imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + n));
		imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + n));
	}
	ctx.putImageData(imgData, 0, 0);

	// Aggregate stones
	ctx.fillStyle = "rgba(90,90,90,0.3)";
	for (let i = 0; i < 600; i++) {
		ctx.beginPath();
		ctx.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5, 0, Math.PI * 2);
		ctx.fill();
	}

	// Tar patches
	ctx.fillStyle = "rgba(20,20,20,0.4)";
	for (let i = 0; i < 120; i++) {
		ctx.beginPath();
		ctx.arc(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 0, Math.PI * 2);
		ctx.fill();
	}

	// Subtle streaks
	ctx.strokeStyle = "rgba(255,255,255,0.04)";
	for (let y = 0; y < H; y += 1 + Math.random() * 2) {
		ctx.lineWidth = 0.5 + Math.random();
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
		ctx.stroke();
	}

	// ── Painted lane markings (top half of texture = painted section) ──────
	// UV tiles every 4m. Top half (V 0.5-1.0) = 2m paint, bottom half (V 0.0-0.5) = 2m gap
	// This creates dashed center line. Edge lines are continuous since they're in both halves.

	const paintY = H * 0.5; // markings start at halfway (top half = painted zone)
	const edgeU_L = W * 0.06; // left edge line position (6% from left)
	const edgeU_R = W * 0.94; // right edge line position
	const centerU = W * 0.5; // center line
	const lineW = 4; // line thickness in pixels (~0.8m at 512px/12m road width)

	// Edge lines - solid, drawn full height (both halves)
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(edgeU_L - lineW / 2, 0, lineW, H);
	ctx.fillRect(edgeU_R - lineW / 2, 0, lineW, H);

	// Center dashes - only in top half (painted zone)
	ctx.fillRect(centerU - lineW / 2, paintY, lineW, H - paintY);

	// Slight glow/feather on markings for realism
	ctx.filter = "blur(1px)";
	ctx.fillStyle = "rgba(255,255,255,0.15)";
	ctx.fillRect(edgeU_L - lineW / 2 - 1, 0, lineW + 2, H);
	ctx.fillRect(edgeU_R - lineW / 2 - 1, 0, lineW + 2, H);
	ctx.fillRect(centerU - lineW / 2 - 1, paintY, lineW + 2, H - paintY);
	ctx.filter = "none";

	const tex = new THREE.CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 16;
	return tex;
}

// ── Geometry helper ──────────────────────────────────────────────────────

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

// ── Build meshes from samples ────────────────────────────────────────────

function buildMeshes(data: TrackResponse, rng: () => number): THREE.Group {
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

	// Road — PBR material so PointLights create visible reflections
	const asphaltTex = makeAsphaltTexture();
	asphaltTex.anisotropy = 16;
	const roadMat = new THREE.MeshStandardMaterial({
		map: asphaltTex,
		roughness: 0.7,
		metalness: 0.05,
	});
	const roadMesh = new THREE.Mesh(makeGeo(roadVerts, roadIndices, roadUVs), roadMat);
	roadMesh.receiveShadow = true;
	group.add(roadMesh);

	// Kerbs
	if (kerbVerts.length > 0) {
		const kerbMat = new THREE.MeshLambertMaterial({ vertexColors: true });
		group.add(new THREE.Mesh(makeGeo(kerbVerts, kerbIndices, undefined, kerbColors), kerbMat));
	}

	// Grass
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

// ── Decoration model cache ─────────────────────────────────────────────

const decorationCache = new Map<string, THREE.Group>();
let decorationsLoaded = false;

async function loadDecorations(): Promise<void> {
	if (decorationsLoaded) return;
	decorationsLoaded = true;

	const loader = new GLTFLoader();
	let pending = 2;
	const done = () => {
		if (--pending === 0) {
			console.log(`Loaded ${decorationCache.size} decoration models`);
			resolveAll();
		}
	};
	let resolveAll: () => void;
	const promise = new Promise<void>((r) => {
		resolveAll = r;
	});

	function loadGLB(url: string) {
		loader.load(
			url,
			(gltf) => {
				gltf.scene.traverse((node) => {
					if (!node.name || !(node instanceof THREE.Object3D)) return;
					const baseName = node.name.replace(/\.\d+$/, "");
					if (!decorationCache.has(baseName)) {
						const clone = node.clone() as THREE.Group;
						clone.name = baseName;
						decorationCache.set(baseName, clone);
					}
				});
				done();
			},
			undefined,
			(error) => {
				console.error(`Failed to load ${url}:`, error);
				done();
			},
		);
	}

	loadGLB("/models/maps/map1/decorations.glb");
	loadGLB("/models/maps/map1/gates.glb");

	return promise;
}

const GLB_SCALE = 8;

function buildInstancedScenery(scenery: SceneryItem[], terrain: TerrainSampler): THREE.Group {
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();

	// Group items by type
	const byType = new Map<string, SceneryItem[]>();
	for (const item of scenery) {
		if (item.type === "barrier") continue;
		let arr = byType.get(item.type);
		if (!arr) {
			arr = [];
			byType.set(item.type, arr);
		}
		arr.push(item);
	}

	// For each type, either instance from GLB cache or create instanced mesh
	for (const [type, items] of byType) {
		// Low-count types: just use individual objects (simpler)
		if (items.length < 3) {
			for (const item of items) {
				const obj = createSceneryObject(item, terrain);
				if (obj) group.add(obj);
			}
			continue;
		}

		const cached = decorationCache.get(type);
		if (cached) {
			// Extract ALL mesh children (trees have trunk + foliage as separate sub-meshes)
			const meshEntries: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] =
				[];
			cached.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					meshEntries.push({ geo: child.geometry, mat: child.material });
				}
			});

			if (meshEntries.length === 0) {
				// Fallback to individual objects
				for (const item of items) {
					const obj = createSceneryObject(item, terrain);
					if (obj) group.add(obj);
				}
				continue;
			}

			// Create one InstancedMesh per sub-mesh (e.g., trunk + foliage)
			for (const entry of meshEntries) {
				const instanced = new THREE.InstancedMesh(entry.geo, entry.mat, items.length);
				instanced.castShadow = true;
				instanced.receiveShadow = true;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const scale = GLB_SCALE * (item.scale ?? 1);
					const tY = terrain.getHeight(item.position.x, item.position.z);
					dummy.position.set(item.position.x, tY, item.position.z);
					dummy.rotation.set(0, item.rotation ?? 0, 0);
					dummy.scale.setScalar(scale);
					dummy.updateMatrix();
					instanced.setMatrixAt(i, dummy.matrix);
				}
				instanced.instanceMatrix.needsUpdate = true;
				group.add(instanced);
			}
		} else {
			// Not in GLB (light, barrier, etc.) - use individual objects
			for (const item of items) {
				const obj = createSceneryObject(item, terrain);
				if (obj) group.add(obj);
			}
		}
	}

	return group;
}

function createSceneryObject(item: SceneryItem, terrain: TerrainSampler): THREE.Group | null {
	const cached = decorationCache.get(item.type);
	if (cached) {
		const obj = cached.clone();
		obj.scale.setScalar(GLB_SCALE * (item.scale ?? 1));
		const tY = terrain.getHeight(item.position.x, item.position.z);
		obj.position.set(item.position.x, tY, item.position.z);
		obj.rotation.y = item.rotation ?? 0;
		return obj;
	}

	// Fallback for types not in GLB (barrier, light)
	const group = new THREE.Group();
	const tY = terrain.getHeight(item.position.x, item.position.z);
	group.position.set(item.position.x, tY, item.position.z);

	switch (item.type) {
		case "barrier": {
			const barrier = new THREE.Mesh(
				new THREE.BoxGeometry(0.5, 1.5, 3),
				new THREE.MeshLambertMaterial({ color: 0xcc3333 }),
			);
			barrier.position.y = 0.75;
			group.add(barrier);
			break;
		}
		case "light": {
			const post = new THREE.Mesh(
				new THREE.CylinderGeometry(0.15, 0.15, 5),
				new THREE.MeshLambertMaterial({ color: 0x888888 }),
			);
			post.position.y = 2.5;
			group.add(post);
			const fixture = new THREE.Mesh(
				new THREE.BoxGeometry(1, 0.3, 0.5),
				new THREE.MeshLambertMaterial({
					color: 0xffffcc,
					emissive: 0xffffaa,
					emissiveIntensity: 0.5,
				}),
			);
			fixture.position.y = 5.5;
			group.add(fixture);
			// Track for day/night glow control
			lightFixtures.push(fixture);
			// Add point light (off during day, on at night) — no shadows for performance
			const pointLight = new THREE.PointLight(0xffeeaa, 0, 30, 2);
			pointLight.position.y = 5;
			group.add(pointLight);
			streetLights.push(pointLight);
			break;
		}
		default:
			return null;
	}
	return group;
}

// ── Scene setup ──────────────────────────────────────────────────────────

const infoEl = document.getElementById("info");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let dispose: () => void = () => {};
let sun: THREE.DirectionalLight | null = null;
let ambient: THREE.HemisphereLight | null = null;
let skyUniforms: Record<string, THREE.IUniform> | null = null;
let stars: THREE.Points | null = null;
let streetLights: THREE.PointLight[] = [];
let lightFixtures: THREE.Mesh[] = []; // for emissive glow control
let currentTime = 12; // default noon
let pmremGenerator: THREE.PMREMGenerator | null = null;

function clearScene() {
	dispose();
	if (controls) controls.dispose();
	sun = null;
	ambient = null;
	skyUniforms = null;
	stars = null;
	streetLights = [];
	lightFixtures = [];
	if (pmremGenerator) {
		pmremGenerator.dispose();
		pmremGenerator = null;
	}
}

async function buildScene(data: TrackResponse) {
	clearScene();

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x87ceeb); // fallback, Sky shader overrides
	scene.fog = new THREE.Fog(0x88aacc, 500, 1500);

	// Procedural sky
	const sky = new Sky();
	sky.scale.setScalar(10000);
	scene.add(sky);
	skyUniforms = sky.material.uniforms;
	skyUniforms.turbidity.value = 4;
	skyUniforms.rayleigh.value = 2;
	skyUniforms.mieCoefficient.value = 0.005;
	skyUniforms.mieDirectionalG.value = 0.8;
	const sunPos = new THREE.Vector3();
	const phi = THREE.MathUtils.degToRad(90 - 45); // 45° elevation
	const theta = THREE.MathUtils.degToRad(180);
	sunPos.setFromSphericalCoords(1, phi, theta);
	skyUniforms.sunPosition.value.copy(sunPos);

	// Generate environment map from sky for PBR reflections
	pmremGenerator = new THREE.PMREMGenerator(renderer);
	pmremGenerator.compileEquirectangularShader();
	const skyScene = new THREE.Scene();
	const skyClone = sky.clone();
	skyClone.material = sky.material.clone();
	skyScene.add(skyClone);
	const envMap = pmremGenerator.fromScene(skyScene, 0, 0.1, 100).texture;
	scene.environment = envMap;
	skyScene.clear();

	scene.add(new THREE.HemisphereLight(0x88bbff, 0x445511, 0.6));
	ambient = scene.children[scene.children.length - 1] as THREE.HemisphereLight;

	sun = new THREE.DirectionalLight(0xffffcc, 1.2);
	sun.position.set(200, 300, 100); // roughly matches sky sun at 45° elevation
	sun.castShadow = true;
	sun.shadow.mapSize.width = 1024;
	sun.shadow.mapSize.height = 1024;
	sun.shadow.camera.near = 10;
	sun.shadow.camera.far = 500;
	sun.shadow.camera.left = -200;
	sun.shadow.camera.right = 200;
	sun.shadow.camera.top = 200;
	sun.shadow.camera.bottom = -200;
	scene.add(sun);

	// Stars (visible at night, hidden during day)
	stars = buildStars();
	scene.add(stars);

	// Terrain sampler (shared for terrain mesh + scenery placement)
	const terrain = new TerrainSampler(data.seed, data.samples);
	scene.add(buildTerrain(data, terrain));

	// Track meshes - use same seed so RNG is deterministic
	const rng = mulberry32(data.seed);
	const trackMeshes = buildMeshes(data, rng);
	scene.add(trackMeshes);

	// Scenery - generate deterministically from seed, load GLB models, place as instanced meshes
	const scenery = generateScenery(data.seed, data.samples);
	await loadDecorations();
	const instancedGroup = buildInstancedScenery(scenery, terrain);
	scene.add(instancedGroup);

	// Procedural guardrails - continuous fence along both sides of road
	scene.add(buildGuardrails(data.samples, terrain));

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1200);
	camera.position.set(
		data.samples[0].point.x + 50,
		data.samples[0].point.y + 80,
		data.samples[0].point.z + 50,
	);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.target.set(data.samples[0].point.x, data.samples[0].point.y, data.samples[0].point.z);

	dispose = () => {
		scene.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					for (const m of child.material) m.dispose();
				} else {
					child.material.dispose();
				}
			}
		});
	};

	if (infoEl) {
		infoEl.textContent = `Seed: ${data.seed} | Length: ${data.length.toFixed(0)}m | Samples: ${data.numSamples} | Elev: ${data.elevationRange.min.toFixed(1)}...${data.elevationRange.max.toFixed(1)} | Scenery: ${scenery.length}`;
	}

	// Apply initial time
	applyTimeOfDay(currentTime);
}

function applyTimeOfDay(hour: number) {
	if (!scene || !sun || !ambient) return;
	const state = getTimeState(hour);

	// Sun
	sun.color.setRGB(...state.sunColor);
	sun.intensity = state.sunIntensity;
	const sunElev = THREE.MathUtils.degToRad(state.sunElevation);
	sun.position.set(Math.cos(sunElev) * 300, Math.sin(sunElev) * 300, 100);

	// Ambient
	ambient.color.setRGB(...state.ambientColor);
	ambient.intensity = state.ambientIntensity;

	// Fog
	const fog = scene.fog as THREE.Fog;
	fog.color.setRGB(...state.fogColor);
	fog.near = state.fogNear;
	fog.far = state.fogFar;

	// Sky
	if (skyUniforms) {
		skyUniforms.turbidity.value = state.turbidity;
		skyUniforms.rayleigh.value = state.rayleigh;
		const phi = THREE.MathUtils.degToRad(90 - state.sunElevation);
		const theta = THREE.MathUtils.degToRad(180);
		const sunPos = new THREE.Vector3();
		sunPos.setFromSphericalCoords(1, phi, theta);
		skyUniforms.sunPosition.value.copy(sunPos);
	}

	// Stars
	if (stars) {
		(stars.material as THREE.PointsMaterial).opacity = state.starsOpacity;
	}

	// Street lights — glow at night, dim during day
	const nightFactor = Math.max(0, 1 - state.sunIntensity / 0.3);
	for (const light of streetLights) {
		light.intensity = nightFactor * 0.6;
	}
	for (const fixture of lightFixtures) {
		const mat = fixture.material as THREE.MeshLambertMaterial;
		mat.emissiveIntensity = 0.15 + nightFactor * 0.5;
	}

	// Renderer exposure (darker at night)
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.3 + state.sunIntensity * 0.7;
}

class TerrainSampler {
	private noise2D: (x: number, z: number) => number;
	private grid: Map<string, TrackSample[]>;
	private samples: TrackSample[];
	avgRoadY: number;
	private readonly cellSize = 10;
	private readonly noiseScale = 0.003;
	private readonly noiseAmp = 60;
	private readonly roadInfluence = 40;
	private readonly blendStart = 15;

	constructor(seed: number, samples: TrackSample[]) {
		const rng = mulberry32(seed + 99999);
		this.noise2D = createNoise2D(rng);
		this.samples = samples;

		// Compute average road Y so far-from-road terrain centers around it
		let sumY = 0;
		for (const s of samples) sumY += s.point.y;
		this.avgRoadY = sumY / samples.length;
		this.grid = new Map();
		for (const s of samples) {
			const cx = Math.floor(s.point.x / this.cellSize);
			const cz = Math.floor(s.point.z / this.cellSize);
			const key = `${cx},${cz}`;
			let arr = this.grid.get(key);
			if (!arr) {
				arr = [];
				this.grid.set(key, arr);
			}
			arr.push(s);
		}
	}

	private fbm(x: number, z: number): number {
		let value = 0;
		let amplitude = 1;
		let frequency = 1;
		let maxVal = 0;
		for (let i = 0; i < 6; i++) {
			value += amplitude * this.noise2D(x * frequency, z * frequency);
			maxVal += amplitude;
			amplitude *= 0.5;
			frequency *= 2.03;
		}
		return value / maxVal;
	}

	nearestRoad(x: number, z: number): { dist: number; sample: TrackSample } {
		const cx = Math.floor(x / this.cellSize);
		const cz = Math.floor(z / this.cellSize);
		let best = { dist: Infinity, sample: this.samples[0] };
		for (let dx = -2; dx <= 2; dx++) {
			for (let dz = -2; dz <= 2; dz++) {
				const arr = this.grid.get(`${cx + dx},${cz + dz}`);
				if (!arr) continue;
				for (const s of arr) {
					const ddx = x - s.point.x;
					const ddz = z - s.point.z;
					const d = Math.sqrt(ddx * ddx + ddz * ddz);
					if (d < best.dist) best = { dist: d, sample: s };
				}
			}
		}
		return best;
	}

	getHeight(x: number, z: number): number {
		const { dist, sample } = this.nearestRoad(x, z);
		const centerDist = Math.sqrt(x * x + z * z);
		// Mountains rise quickly with distance from center
		const mountainFactor = 1 + smoothstep(600, 900, centerDist) * 3;
		const noiseH =
			this.fbm(x * this.noiseScale, z * this.noiseScale) * this.noiseAmp * mountainFactor;
		const blend = smoothstep(this.blendStart, this.roadInfluence, dist);
		// Near road: match road height. Far: noise centered on avg road Y with mountain amplification.
		return sample.point.y * (1 - blend) + (this.avgRoadY + noiseH) * blend - 0.3;
	}
}

function buildTerrain(_data: TrackResponse, terrain: TerrainSampler): THREE.Group {
	const group = new THREE.Group();

	// ── Generate terrain mesh ────────────────────────────────────────
	const worldSize = 1600;
	const segments = 128;

	const geometry = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
	geometry.rotateX(-Math.PI / 2);
	const pos = geometry.attributes.position;
	const colors = new Float32Array(pos.count * 3);

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);

		const terrainY = terrain.getHeight(x, z);
		pos.setY(i, terrainY);

		// Distance-based coloring with more green variation
		const { dist } = terrain.nearestRoad(x, z);
		const _centerDist = Math.sqrt(x * x + z * z);
		const _height = terrainY;
		const blend = smoothstep(15, 40, dist);

		// Slope: use absolute height relative to road, not raw height
		const slope = blend > 0.5 ? Math.abs(terrainY - terrain.avgRoadY) / 80 : 0;

		// Height above road (for snow/rock at high elevation)
		const aboveRoad = terrainY - terrain.avgRoadY;

		let r: number, g: number, b: number;
		if (slope > 0.6) {
			// Rocky outcrops
			r = 0.42;
			g = 0.38;
			b = 0.32;
		} else if (aboveRoad > 80) {
			// Snow-capped peaks
			r = 0.88;
			g = 0.9;
			b = 0.93;
		} else if (aboveRoad > 50) {
			// High mountain - brownish green
			r = 0.3;
			g = 0.35;
			b = 0.22;
		} else if (dist < 15) {
			// Near track - brighter grass
			r = 0.32;
			g = 0.58;
			b = 0.22;
		} else {
			// Default - varied greens with noise
			const greenVar = Math.sin(x * 0.05 + z * 0.07) * 0.5 + 0.5;
			r = 0.18 + greenVar * 0.1;
			g = 0.42 + greenVar * 0.15;
			b = 0.15 + greenVar * 0.05;
		}

		const colorNoise = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.04;
		colors[i * 3] = r + colorNoise;
		colors[i * 3 + 1] = g + colorNoise;
		colors[i * 3 + 2] = b + colorNoise;
	}

	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();

	const material = new THREE.MeshLambertMaterial({ vertexColors: true });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	group.add(mesh);

	return group;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function buildGuardrails(samples: TrackSample[], terrain: TerrainSampler): THREE.Group {
	const group = new THREE.Group();
	const postMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
	const railMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });

	// Place posts every ~10 samples
	const postSpacing = 10;
	const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
	const railGeo = new THREE.BoxGeometry(0.06, 0.06, 1); // length set per segment

	// Collect post positions for each side
	const leftPosts: THREE.Vector3[] = [];
	const rightPosts: THREE.Vector3[] = [];

	for (let i = 0; i < samples.length; i += postSpacing) {
		const s = samples[i];
		const left = new THREE.Vector3(s.grassLeft.x, s.grassLeft.y, s.grassLeft.z);
		const right = new THREE.Vector3(s.grassRight.x, s.grassRight.y, s.grassRight.z);
		leftPosts.push(left);
		rightPosts.push(right);
	}

	// Build rails for each side
	for (const posts of [leftPosts, rightPosts]) {
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			const next = posts[(i + 1) % posts.length];

			// Post
			const postMesh = new THREE.Mesh(postGeo, postMat);
			postMesh.position.set(post.x, terrain.getHeight(post.x, post.z) + 0.6, post.z);
			group.add(postMesh);

			// Two horizontal rails connecting to next post
			for (const railY of [0.4, 0.9]) {
				const dir = new THREE.Vector3().subVectors(next, post);
				const len = dir.length();
				dir.normalize();

				const rail = new THREE.Mesh(railGeo, railMat);
				rail.scale.z = len;
				rail.position.set(post.x, terrain.getHeight(post.x, post.z) + railY, post.z);
				// Orient rail to point toward next post
				rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
				group.add(rail);
			}
		}
	}

	return group;
}

type WeatherType = "clear" | "cloudy" | "rain" | "heavy_rain" | "fog" | "snow";

async function generate() {
	// Read params from URL
	const urlParams = new URLSearchParams(window.location.search);
	const seed = Number(urlParams.get("seed")) || 42;
	const hour = Number(urlParams.get("hour")) || 12;
	const weather = (urlParams.get("weather") as WeatherType) || "clear";

	// Sync UI elements from URL params
	const seedDisplay = document.getElementById("seedDisplay") as HTMLElement | null;
	if (seedDisplay) seedDisplay.textContent = String(seed);
	const timeSliderEl = document.getElementById("timeSlider") as HTMLInputElement | null;
	if (timeSliderEl) timeSliderEl.value = String(hour);
	updateTimeLabel(hour);
	const weatherEl = document.getElementById("weatherSelect") as HTMLSelectElement | null;
	if (weatherEl) weatherEl.value = weather;

	currentTime = hour;

	const params = new URLSearchParams({ seed: String(seed) });

	try {
		const resp = await fetch(`/api/track?${params}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data: TrackResponse = await resp.json();
		await buildScene(data);
	} catch (_err) {
		// Fallback: generate client-side if API unavailable (dev mode)
		const data = generateTrack(seed);
		await buildScene({ ...data, seed });
	}
}

function setURLParam(key: string, value: string) {
	const url = new URL(window.location.href);
	url.searchParams.set(key, value);
	history.replaceState(null, "", url);
}

function updateTimeLabel(hour: number) {
	const timeLabel = document.getElementById("timeLabel") as HTMLElement | null;
	if (timeLabel) {
		const h = Math.floor(hour);
		const m = Math.floor((hour % 1) * 60);
		timeLabel.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}
}

// ── UI ───────────────────────────────────────────────────────────────────

document.getElementById("generateBtn")?.addEventListener("click", () => {
	const seed = Math.floor(Math.random() * 100000);
	setURLParam("seed", String(seed));
	generate();
});
document.getElementById("randomBtn")?.addEventListener("click", () => {
	const seed = Math.floor(Math.random() * 100000);
	setURLParam("seed", String(seed));
	generate();
});

const timeSlider = document.getElementById("timeSlider") as HTMLInputElement | null;
if (timeSlider) {
	timeSlider.addEventListener("input", () => {
		const hour = Number.parseFloat(timeSlider.value);
		currentTime = hour;
		setURLParam("hour", String(hour));
		applyTimeOfDay(hour);
		updateTimeLabel(hour);
	});
}

const weatherSelect = document.getElementById("weatherSelect") as HTMLSelectElement | null;
if (weatherSelect) {
	weatherSelect.addEventListener("change", () => {
		setURLParam("weather", weatherSelect.value);
	});
}

// ── Render loop ──────────────────────────────────────────────────────────

function animate() {
	requestAnimationFrame(animate);
	if (controls) controls.update();
	if (scene && camera) renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
	if (camera) {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
	}
	renderer.setSize(window.innerWidth, window.innerHeight);
});

generate();
animate();
