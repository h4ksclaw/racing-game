/**
 * Build a Three.js scene from ProceduralTrack output.
 * Handles materials, meshes, scenery objects, lighting, and camera.
 */

import {
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Color,
	DirectionalLight,
	Fog,
	Group,
	HemisphereLight,
	Line,
	LineBasicMaterial,
	Mesh,
	MeshLambertMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	RepeatWrapping,
	Scene,
	Vector3,
} from "three";

import type { TrackData } from "./ProceduralTrack";

// ── Procedural textures ──────────────────────────────────────────────────

export function makeAsphaltTexture(): CanvasTexture {
	const size = 512;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context not available");

	// Base dark asphalt
	ctx.fillStyle = "#3a3a3a";
	ctx.fillRect(0, 0, size, size);

	// Noise grain
	const imgData = ctx.getImageData(0, 0, size, size);
	for (let i = 0; i < imgData.data.length; i += 4) {
		const n = (Math.random() - 0.5) * 35;
		imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + n));
		imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + n));
		imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + n));
	}
	ctx.putImageData(imgData, 0, 0);

	// Aggregate stones
	ctx.fillStyle = "rgba(90,90,90,0.3)";
	for (let i = 0; i < 300; i++) {
		const x = Math.random() * size;
		const y = Math.random() * size;
		const r = 1 + Math.random() * 2.5;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}

	// Dark tar patches
	ctx.fillStyle = "rgba(20,20,20,0.4)";
	for (let i = 0; i < 60; i++) {
		const x = Math.random() * size;
		const y = Math.random() * size;
		const r = 2 + Math.random() * 5;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}

	// Longitudinal streaks
	ctx.strokeStyle = "rgba(255,255,255,0.04)";
	for (let y = 0; y < size; y += 1 + Math.random() * 2) {
		ctx.lineWidth = 0.5 + Math.random();
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(size, y);
		ctx.stroke();
	}

	const tex = new CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = RepeatWrapping;
	return tex;
}

// ── Geometry helper ──────────────────────────────────────────────────────

function makeGeo(
	verts: Float32Array,
	indices: Uint32Array,
	uvs?: Float32Array,
	colors?: Float32Array,
): BufferGeometry {
	const geo = new BufferGeometry();
	geo.setAttribute("position", new BufferAttribute(verts, 3));
	if (uvs) geo.setAttribute("uv", new BufferAttribute(uvs, 2));
	if (colors) geo.setAttribute("color", new BufferAttribute(colors, 3));
	geo.setIndex(new BufferAttribute(indices, 1));
	geo.computeVertexNormals();
	return geo;
}

// ── Scene builder ────────────────────────────────────────────────────────

export interface TrackSceneOptions {
	/** Override seed shown in UI */
	seed?: number;
	/** Track generation options */
	trackOpts?: Record<string, unknown>;
}

export interface TrackSceneResult {
	scene: Scene;
	camera: PerspectiveCamera;
	trackGroup: Group;
	dispose: () => void;
}

export function buildTrackScene(data: TrackData): TrackSceneResult {
	const scene = new Scene();
	scene.background = new Color(0.55, 0.75, 0.95);
	scene.fog = new Fog(0x88aacc, 500, 1500);

	// Lighting
	const hemiLight = new HemisphereLight(0x88bbff, 0x445511, 0.6);
	scene.add(hemiLight);

	const sun = new DirectionalLight(0xffffcc, 1.2);
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

	const trackGroup = new Group();
	scene.add(trackGroup);

	// ── Ground ────────────────────────────────────────────────────────────
	const groundY = Math.min(data.elevationRange.min - 5, -3);
	const groundMat = new MeshLambertMaterial({ color: 0x4d8f6e });
	const ground = new Mesh(new PlaneGeometry(2000, 2000), groundMat);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = groundY;
	ground.receiveShadow = true;
	trackGroup.add(ground);

	// ── Road ──────────────────────────────────────────────────────────────
	const asphaltTex = makeAsphaltTexture();
	const roadMat = new MeshLambertMaterial({ map: asphaltTex });
	const roadMesh = new Mesh(makeGeo(data.roadVerts, data.roadIndices, data.roadUVs), roadMat);
	roadMesh.receiveShadow = true;
	trackGroup.add(roadMesh);

	// ── Kerbs ─────────────────────────────────────────────────────────────
	if (data.kerbVerts.length > 0) {
		const kerbMat = new MeshLambertMaterial({ vertexColors: true });
		trackGroup.add(
			new Mesh(makeGeo(data.kerbVerts, data.kerbIndices, undefined, data.kerbColors), kerbMat),
		);
	}

	// ── Grass ─────────────────────────────────────────────────────────────
	if (data.grassVerts.length > 0) {
		const grassMat = new MeshLambertMaterial({ vertexColors: true });
		const gm = new Mesh(
			makeGeo(data.grassVerts, data.grassIndices, undefined, data.grassColors),
			grassMat,
		);
		gm.receiveShadow = true;
		trackGroup.add(gm);
	}

	// ── Center line ───────────────────────────────────────────────────────
	if (data.centerVerts.length > 0) {
		const centerMat = new MeshLambertMaterial({ color: 0xffffff });
		trackGroup.add(new Mesh(makeGeo(data.centerVerts, data.centerIndices), centerMat));
	}

	// ── Checker start/finish ──────────────────────────────────────────────
	if (data.checkerVerts.length > 0) {
		const checkerMat = new MeshLambertMaterial({ color: 0x111111 });
		trackGroup.add(new Mesh(makeGeo(data.checkerVerts, data.checkerIndices), checkerMat));
	}

	// ── Spline visualization ──────────────────────────────────────────────
	const splineMat = new LineBasicMaterial({ color: 0x00ff88 });
	const splinePoints = data.curve.getPoints(200);
	const splineGeo = new BufferGeometry().setFromPoints(splinePoints);
	trackGroup.add(new Line(splineGeo, splineMat));

	// ── Control points ───────────────────────────────────────────────────
	const controlPointMat = new MeshLambertMaterial({ color: 0xff6600 });
	for (const cp of data.controlPoints3D) {
		const marker = new Mesh(new PlaneGeometry(2, 2), controlPointMat);
		marker.position.copy(cp);
		marker.position.y += 2;
		marker.lookAt(new Vector3(cp.x + 1, cp.y + 2, cp.z));
		trackGroup.add(marker);
	}

	// ── Scenery ───────────────────────────────────────────────────────────
	for (const item of data.scenery) {
		const obj = createSceneryObject(item.type, item.position);
		if (obj) trackGroup.add(obj);
	}

	// ── Camera ────────────────────────────────────────────────────────────
	const first = data.samples[0];
	const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2000);
	camera.position.set(first.point.x + 50, first.point.y + 80, first.point.z + 50);
	camera.lookAt(first.point);

	return {
		scene,
		camera,
		trackGroup,
		dispose: () => {
			asphaltTex.dispose();
			roadMat.dispose();
			trackGroup.traverse((child) => {
				if (child instanceof Mesh) {
					child.geometry.dispose();
					if (Array.isArray(child.material)) for (const m of child.material) m.dispose();
					else child.material.dispose();
				}
			});
		},
	};
}

// ── Scenery factories ────────────────────────────────────────────────────

function createSceneryObject(type: string, position: Vector3): Group | null {
	const group = new Group();
	group.position.copy(position);

	switch (type) {
		case "tree": {
			// Trunk
			const trunk = new Mesh(
				new PlaneGeometry(1.5, 8),
				new MeshLambertMaterial({ color: 0x6b4226 }),
			);
			trunk.position.y = 4;
			group.add(trunk);
			// Foliage
			const foliage = new Mesh(
				new PlaneGeometry(6, 8),
				new MeshLambertMaterial({ color: 0x2d5a27 }),
			);
			foliage.position.y = 10;
			group.add(foliage);
			break;
		}
		case "barrier": {
			const barrier = new Mesh(
				new PlaneGeometry(0.5, 1.5),
				new MeshLambertMaterial({ color: 0xcc3333 }),
			);
			barrier.position.y = 0.75;
			group.add(barrier);
			break;
		}
		case "light": {
			// Post
			const post = new Mesh(
				new PlaneGeometry(0.3, 5),
				new MeshLambertMaterial({ color: 0x888888 }),
			);
			post.position.y = 2.5;
			group.add(post);
			// Light fixture
			const light = new Mesh(
				new PlaneGeometry(1, 0.5),
				new MeshLambertMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.5 }),
			);
			light.position.y = 5.5;
			group.add(light);
			break;
		}
		default:
			return null;
	}

	return group;
}
