import type { TrackSample } from "@shared/track.ts";
import * as THREE from "three";
import type { TerrainSampler } from "./terrain.ts";
import type { TrackResponse } from "./utils.ts";

// ── Procedural textures ─────────────────────────────────────────────────

function makeAsphaltTexture(): THREE.CanvasTexture {
	const W = 512;
	const H = 1024;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D not available");

	ctx.fillStyle = "#3a3a3a";
	ctx.fillRect(0, 0, W, H);

	const imgData = ctx.getImageData(0, 0, W, H);
	for (let i = 0; i < imgData.data.length; i += 4) {
		const n = (Math.random() - 0.5) * 35;
		imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + n));
		imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + n));
		imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + n));
	}
	ctx.putImageData(imgData, 0, 0);

	ctx.fillStyle = "rgba(90,90,90,0.3)";
	for (let i = 0; i < 600; i++) {
		ctx.beginPath();
		ctx.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.fillStyle = "rgba(20,20,20,0.4)";
	for (let i = 0; i < 120; i++) {
		ctx.beginPath();
		ctx.arc(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.strokeStyle = "rgba(255,255,255,0.04)";
	for (let y = 0; y < H; y += 1 + Math.random() * 2) {
		ctx.lineWidth = 0.5 + Math.random();
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
		ctx.stroke();
	}

	const paintY = H * 0.5;
	const edgeU_L = W * 0.06;
	const edgeU_R = W * 0.94;
	const centerU = W * 0.5;
	const lineW = 4;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(edgeU_L - lineW / 2, 0, lineW, H);
	ctx.fillRect(edgeU_R - lineW / 2, 0, lineW, H);
	ctx.fillRect(centerU - lineW / 2, paintY, lineW, H - paintY);

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

export function buildMeshes(data: TrackResponse, rng: () => number): THREE.Group {
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
