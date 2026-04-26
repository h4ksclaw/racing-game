import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { state } from "./scene.ts";

let composer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;

// Selective bloom: black material applied to non-bloom objects during bloom pass
const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const bloomMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

// Temp meshes for virtual-group bloom faces (added/removed each frame)
const tempBloomMeshes: THREE.Mesh[] = [];

export function initBloom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
	composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));

	bloomPass = new UnrealBloomPass(
		new THREE.Vector2(window.innerWidth, window.innerHeight),
		0.4, // strength
		0.6, // radius
		1.5, // threshold — only street lights and emissives bloom, not sky
	);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());

	state.composer = composer;
}

export function getComposer(): EffectComposer | null {
	return composer;
}

export function updateBloomSize(): void {
	if (!composer) return;
	composer.setSize(window.innerWidth, window.innerHeight);
}

export function setBloomStrength(strength: number): void {
	if (bloomPass) bloomPass.strength = strength;
}

export function setBloomThreshold(threshold: number): void {
	if (bloomPass) bloomPass.threshold = threshold;
}

/** Called each frame before composer.render().
 *  When `selective=true`, swaps non-bloom materials to black (editor preview).
 *  When `selective=false` (gameplay), does nothing — bloom threshold handles it naturally. */
export function prepareBloomPass(scene: THREE.Scene, selective = false): void {
	if (!composer || !selective) return;
	bloomMaterials.clear();
	removeTempBloomMeshes();

	// Quick check: does anything in the scene have bloom data?
	let hasBloomSource = false;
	scene.traverse((child) => {
		if (hasBloomSource) return;
		if (!(child instanceof THREE.Mesh)) return;
		if (child.userData.bloom) { hasBloomSource = true; return; }
		const vg = child.userData.virtualGroups as Record<string, { markedAs?: string; faces: number[] }> | undefined;
		if (vg && collectBloomFaces(vg)?.size) hasBloomSource = true;
	});
	if (!hasBloomSource) return; // nothing to selectively bloom — render normally

	scene.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		if (child.userData.bloom) return; // whole-mesh bloom tag

		const mat = child.material;
		const isStandard = Array.isArray(mat)
			? mat.some((m) => m instanceof THREE.MeshStandardMaterial)
			: mat instanceof THREE.MeshStandardMaterial;
		if (!isStandard) return;

		// Check for virtual groups with bloom-worthy marks
		const vg = child.userData.virtualGroups as Record<string, { markedAs?: string; faces: number[] }> | undefined;
		const bloomFaces = vg ? collectBloomFaces(vg) : null;
		if (bloomFaces && bloomFaces.size > 0) {
			// This mesh has some bloom faces — black out non-bloom faces
			// by creating a temp mesh with only the bloom faces
			const tempMesh = createBloomFaceMesh(child, bloomFaces);
			if (tempMesh) {
				scene.add(tempMesh);
				tempBloomMeshes.push(tempMesh);
			}
			// Black out the whole mesh (temp mesh provides the bloom faces)
			bloomMaterials.set(child, child.material);
			child.material = blackMaterial;
			return;
		}

		bloomMaterials.set(child, child.material);
		child.material = blackMaterial;
	});
}

/** Called each frame after composer.render() — restore original materials. */
export function restoreBloomMaterials(): void {
	for (const [mesh, mat] of bloomMaterials) {
		mesh.material = mat;
	}
	bloomMaterials.clear();
	removeTempBloomMeshes();
}

// ── Virtual group bloom helpers ──

/** Collect face indices from virtual groups that should bloom. */
function collectBloomFaces(
	vg: Record<string, { markedAs?: string; faces: number[] }>,
): Set<number> | null {
	let faces: Set<number> | null = null;
	for (const group of Object.values(vg)) {
		if (!group.markedAs) continue;
		// Bloom-worthy marks: bloom, headlight, taillight (anything emissive)
		const isBloom = group.markedAs === "bloom"
			|| group.markedAs.includes("headlight")
			|| group.markedAs.includes("taillight")
			|| group.markedAs.includes("emissive");
		if (!isBloom) continue;
		if (!faces) faces = new Set();
		for (const f of group.faces) faces.add(f);
	}
	return faces;
}

/** Create a temp mesh containing only the bloom-worthy faces from a source mesh. */
function createBloomFaceMesh(source: THREE.Mesh, faceIndices: Set<number>): THREE.Mesh | null {
	const geo = source.geometry;
	if (!geo.attributes.position) return null;

	const index = geo.index;
	const posAttr = geo.attributes.position;
	const normAttr = geo.attributes.normal;
	const uvAttr = geo.attributes.uv;

	// Collect unique vertex indices used by bloom faces
	const vertSet = new Set<number>();
	const newIndices: number[] = [];
	for (const faceIdx of faceIndices) {
		if (index) {
			const i0 = index.getX(faceIdx * 3);
			const i1 = index.getX(faceIdx * 3 + 1);
			const i2 = index.getX(faceIdx * 3 + 2);
			newIndices.push(i0, i1, i2);
			vertSet.add(i0); vertSet.add(i1); vertSet.add(i2);
		} else {
			const base = faceIdx * 3;
			newIndices.push(base, base + 1, base + 2);
			vertSet.add(base); vertSet.add(base + 1); vertSet.add(base + 2);
		}
	}

	const sortedVerts = [...vertSet].sort((a, b) => a - b);
	const oldToNew = new Map<number, number>();
	for (let i = 0; i < sortedVerts.length; i++) oldToNew.set(sortedVerts[i], i);

	const newPos = new Float32Array(sortedVerts.length * 3);
	for (let i = 0; i < sortedVerts.length; i++) {
		newPos[i * 3] = posAttr.getX(sortedVerts[i]);
		newPos[i * 3 + 1] = posAttr.getY(sortedVerts[i]);
		newPos[i * 3 + 2] = posAttr.getZ(sortedVerts[i]);
	}

	const newGeo = new THREE.BufferGeometry();
	newGeo.setAttribute("position", new THREE.BufferAttribute(newPos, 3));

	if (normAttr) {
		const newNorm = new Float32Array(sortedVerts.length * 3);
		for (let i = 0; i < sortedVerts.length; i++) {
			newNorm[i * 3] = normAttr.getX(sortedVerts[i]);
			newNorm[i * 3 + 1] = normAttr.getY(sortedVerts[i]);
			newNorm[i * 3 + 2] = normAttr.getZ(sortedVerts[i]);
		}
		newGeo.setAttribute("normal", new THREE.BufferAttribute(newNorm, 3));
	}

	if (uvAttr) {
		const newUv = new Float32Array(sortedVerts.length * 2);
		for (let i = 0; i < sortedVerts.length; i++) {
			newUv[i * 2] = uvAttr.getX(sortedVerts[i]);
			newUv[i * 2 + 1] = uvAttr.getY(sortedVerts[i]);
		}
		newGeo.setAttribute("uv", new THREE.BufferAttribute(newUv, 2));
	}

	newGeo.setIndex(newIndices.map((idx) => oldToNew.get(idx)!));
	newGeo.computeBoundingSphere();

	// Clone material so bloom pass can use it independently
	const mat = source.material;
	const newMat = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();

	const mesh = new THREE.Mesh(newGeo, newMat);
	mesh.matrixAutoUpdate = false;
	source.updateMatrixWorld(true);
	mesh.matrixWorld.copy(source.matrixWorld);
	mesh.name = "__bloom_temp";
	return mesh;
}

function removeTempBloomMeshes(): void {
	for (const m of tempBloomMeshes) {
		m.geometry.dispose();
		const mat = m.material;
		if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
		else mat.dispose();
		m.parent?.remove(m);
	}
	tempBloomMeshes.length = 0;
}
