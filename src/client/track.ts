import type { SceneryItem, TrackSample } from "@shared/track.ts";
import { generateScenery, generateTrack, mulberry32 } from "@shared/track.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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

	// Edge lines — solid, drawn full height (both halves)
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(edgeU_L - lineW / 2, 0, lineW, H);
	ctx.fillRect(edgeU_R - lineW / 2, 0, lineW, H);

	// Center dashes — only in top half (painted zone)
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

	// Road
	const asphaltTex = makeAsphaltTexture();
	const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex });
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

	return new Promise((resolve, _reject) => {
		const loader = new GLTFLoader();
		loader.load(
			"/models/maps/map1/decorations.glb",
			(gltf) => {
				gltf.scene.traverse((node) => {
					if (!node.name || !(node instanceof THREE.Object3D)) return;
					// Strip numeric suffixes: "rock_tallH.002" → "rock_tallH"
					const baseName = node.name.replace(/\.\d+$/, "");
					if (!decorationCache.has(baseName)) {
						const clone = node.clone() as THREE.Group;
						clone.name = baseName;
						decorationCache.set(baseName, clone);
					}
				});
				console.log(`Loaded ${decorationCache.size} decoration models`);
				resolve();
			},
			undefined,
			(error) => {
				console.error("Failed to load decorations.glb:", error);
				resolve(); // Don't block, fall back to procedural
			},
		);
	});
}

const GLB_SCALE = 8;

function createSceneryObject(item: SceneryItem): THREE.Group | null {
	const cached = decorationCache.get(item.type);
	if (cached) {
		const obj = cached.clone();
		obj.scale.setScalar(GLB_SCALE * (item.scale ?? 1));
		obj.position.set(item.position.x, item.position.y, item.position.z);
		obj.rotation.y = item.rotation ?? 0;
		return obj;
	}

	// Fallback for types not in GLB (barrier, light)
	const group = new THREE.Group();
	group.position.set(item.position.x, item.position.y, item.position.z);

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let dispose: () => void = () => {};

function clearScene() {
	dispose();
	if (controls) controls.dispose();
}

async function buildScene(data: TrackResponse) {
	clearScene();

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0.55, 0.75, 0.95);
	scene.fog = new THREE.Fog(0x88aacc, 500, 1500);

	scene.add(new THREE.HemisphereLight(0x88bbff, 0x445511, 0.6));

	const sun = new THREE.DirectionalLight(0xffffcc, 1.2);
	sun.position.set(200, 300, 100);
	sun.castShadow = true;
	sun.shadow.mapSize.width = 2048;
	sun.shadow.mapSize.height = 2048;
	sun.shadow.camera.near = 10;
	sun.shadow.camera.far = 800;
	sun.shadow.camera.left = -400;
	sun.shadow.camera.right = 400;
	sun.shadow.camera.top = 400;
	sun.shadow.camera.bottom = -400;
	scene.add(sun);

	// Ground
	const groundY = Math.min(data.elevationRange.min - 5, -3);
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(2000, 2000),
		new THREE.MeshLambertMaterial({ color: 0x4d8f6e }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = groundY;
	ground.receiveShadow = true;
	scene.add(ground);

	// Track meshes — use same seed so RNG is deterministic
	const rng = mulberry32(data.seed);
	const trackMeshes = buildMeshes(data, rng);
	scene.add(trackMeshes);

	// Scenery — generate deterministically from seed, load GLB models and place
	const scenery = generateScenery(data.seed, data.samples);
	await loadDecorations();
	for (const item of scenery) {
		if (item.type === "barrier") continue; // handled by procedural guardrails
		const obj = createSceneryObject(item);
		if (obj) scene.add(obj);
	}

	// Procedural guardrails — continuous fence along both sides of road
	scene.add(buildGuardrails(data.samples));

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2000);
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
		infoEl.textContent = `Seed: ${data.seed} | Length: ${data.length.toFixed(0)}m | Samples: ${data.numSamples} | Elev: ${data.elevationRange.min.toFixed(1)}…${data.elevationRange.max.toFixed(1)} | Scenery: ${scenery.length}`;
	}
}

function buildGuardrails(samples: TrackSample[]): THREE.Group {
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
			postMesh.position.copy(post);
			postMesh.position.y += 0.6; // half height
			group.add(postMesh);

			// Two horizontal rails connecting to next post
			for (const railY of [0.4, 0.9]) {
				const dir = new THREE.Vector3().subVectors(next, post);
				const len = dir.length();
				dir.normalize();

				const rail = new THREE.Mesh(railGeo, railMat);
				rail.scale.z = len;
				rail.position.copy(post);
				rail.position.y += railY;
				// Orient rail to point toward next post
				rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
				group.add(rail);
			}
		}
	}

	return group;
}

async function generate() {
	const seed = Number((document.getElementById("seed") as HTMLInputElement)?.value) || 42;
	const params = new URLSearchParams({ seed: String(seed) });

	try {
		const resp = await fetch(`/api/track?${params}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data: TrackResponse = await resp.json();
		buildScene(data);
	} catch (_err) {
		// Fallback: generate client-side if API unavailable (dev mode)
		const data = generateTrack(seed, {});
		buildScene({ ...data, seed });
	}
}

// ── UI ───────────────────────────────────────────────────────────────────

document.getElementById("generateBtn")?.addEventListener("click", generate);
document.getElementById("randomBtn")?.addEventListener("click", () => {
	const el = document.getElementById("seed") as HTMLInputElement | null;
	if (el) el.value = String(Math.floor(Math.random() * 100000));
	generate();
});

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
