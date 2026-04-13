import type { SceneryItem } from "@shared/track.ts";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { state } from "./scene.ts";
import type { TerrainSampler } from "./terrain.ts";

// ── Decoration model cache ──────────────────────────────────────────────

const decorationCache = new Map<string, THREE.Group>();
let decorationsLoaded = false;

export async function loadDecorations(): Promise<void> {
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

export function buildInstancedScenery(
	scenery: SceneryItem[],
	terrain: TerrainSampler,
): THREE.Group {
	const group = new THREE.Group();
	const dummy = new THREE.Object3D();

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

	for (const [type, items] of byType) {
		if (items.length < 3) {
			for (const item of items) {
				const obj = createSceneryObject(item, terrain);
				if (obj) group.add(obj);
			}
			continue;
		}

		const cached = decorationCache.get(type);
		if (cached) {
			const meshEntries: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] =
				[];
			cached.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					meshEntries.push({ geo: child.geometry, mat: child.material });
				}
			});

			if (meshEntries.length === 0) {
				for (const item of items) {
					const obj = createSceneryObject(item, terrain);
					if (obj) group.add(obj);
				}
				continue;
			}

			for (const entry of meshEntries) {
				const instanced = new THREE.InstancedMesh(entry.geo, entry.mat, items.length);
				instanced.castShadow = true;
				instanced.receiveShadow = false;

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
			state.lightFixtures.push(fixture);
			const pointLight = new THREE.PointLight(0xffeeaa, 0, 60, 2);
			pointLight.position.y = 5;
			group.add(pointLight);
			state.streetLights.push(pointLight);
			break;
		}
		default:
			return null;
	}
	return group;
}
