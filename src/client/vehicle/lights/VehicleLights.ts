/**
 * VehicleLights — headlight/taillight/reverse light management.
 *
 * Extracted from VehicleRenderer to isolate light logic from model loading.
 */

import * as THREE from "three";
import type { CarConfig, CarModelSchema } from "../configs.ts";

/** Runtime overlay mesh for face-level light emissive (virtual groups). */
interface LightOverlay {
	mesh: THREE.Mesh;
	material: THREE.MeshStandardMaterial;
	/** Which virtual group faces this overlay represents */
	groupKey: string;
	markedAs: string;
	/** Direct reference to the source mesh for transform sync */
	source: THREE.Mesh;
}

export class VehicleLights {
	private readonly schema: CarModelSchema;
	private readonly config: CarConfig;
	headlightMeshes: THREE.Mesh[] = [];
	private taillightMeshes: THREE.Mesh[] = [];
	headlights: THREE.SpotLight[] = [];
	private _reverseLight: THREE.SpotLight | null = null;

	/** Face-level overlays for meshes with virtual groups (not whole-mesh). */
	private overlays: LightOverlay[] = [];
	/** Set of mesh UUIDs that use overlays instead of whole-mesh emissive. */
	private overlayMeshes = new Set<string>();

	constructor(schema: CarModelSchema, config: CarConfig) {
		this.schema = schema;
		this.config = config;
	}

	/** Find headlight and taillight meshes in the model.
	 *  Looks for meshes with userData.markedAs containing "headlight" or "taillight",
	 *  falling back to material name matching for legacy (non-editor) models.
	 *  Also creates face-level overlay meshes for virtual groups. */
	findLightMeshes(model: THREE.Group): void {
		this.headlightMeshes = [];
		this.taillightMeshes = [];
		this.dispose();

		model.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const marked = child.userData.markedAs as string | undefined;

			// Primary: use userData.markedAs (set by editor + baked into GLB)
			if (marked?.includes("headlight")) {
				this.headlightMeshes.push(child);
				return;
			}
			if (marked?.includes("taillight")) {
				this.taillightMeshes.push(child);
				return;
			}

			// Fallback: material name matching (for non-editor models)
			const mat = child.material;
			if (!mat) return;
			const mats = Array.isArray(mat) ? mat : [mat];
			for (const m of mats) {
				if (m.name === this.schema.materials.headlight && !this.headlightMeshes.includes(child)) {
					this.headlightMeshes.push(child);
				}
				if (m.name === this.schema.materials.taillight && !this.taillightMeshes.includes(child)) {
					this.taillightMeshes.push(child);
				}
			}
		});

		// ── Create face-level overlays for meshes with virtual groups ──
		model.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const vg = child.userData.virtualGroups as
				| Record<string, { markedAs?: string; faces: number[] }>
				| undefined;
			if (!vg) return;

			const geo = child.geometry;
			const posAttr = geo.getAttribute("position");
			const normAttr = geo.getAttribute("normal");
			const uvAttr = geo.getAttribute("uv");
			const idxAttr = geo.getIndex();
			if (!posAttr || !normAttr || !idxAttr) return;

			for (const [key, group] of Object.entries(vg)) {
				const mark = (group.markedAs ?? "").toLowerCase();
				if (!mark.includes("taillight") && !mark.includes("headlight")) continue;

				// Build index buffer for just these faces
				const faceIdx: number[] = [];
				for (const fi of group.faces) {
					faceIdx.push(
						idxAttr.getX(fi * 3),
						idxAttr.getX(fi * 3 + 1),
						idxAttr.getX(fi * 3 + 2),
					);
				}
				if (faceIdx.length === 0) continue;

				const overlayGeo = new THREE.BufferGeometry();
				overlayGeo.setAttribute("position", posAttr.clone());
				overlayGeo.setAttribute("normal", normAttr.clone());
				if (uvAttr) overlayGeo.setAttribute("uv", uvAttr.clone());
				overlayGeo.setIndex(faceIdx);

				// Clone material from source (so we can set emissive independently)
				const srcMat = Array.isArray(child.material)
					? child.material[0]
					: child.material;
				const overlayMat = (srcMat instanceof THREE.MeshStandardMaterial
					? srcMat.clone()
					: new THREE.MeshStandardMaterial()).clone();
				overlayMat.transparent = true;
				overlayMat.depthWrite = false;
				overlayMat.polygonOffset = true;
				overlayMat.polygonOffsetFactor = -1;
				overlayMat.polygonOffsetUnits = -1;
				overlayMat.side = THREE.FrontSide;

				const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
				overlayMesh.name = `__light_overlay_${key}`;
				overlayMesh.matrixAutoUpdate = false;
				overlayMesh.matrixWorld.copy(child.matrixWorld);
				overlayMesh.raycast = () => {}; // no picking

				model.add(overlayMesh);
				this.overlays.push({ mesh: overlayMesh, material: overlayMat, groupKey: key, markedAs: mark, source: child });
				this.overlayMeshes.add(child.uuid);

				// Add to light arrays so existing emissive logic knows about them
				if (mark.includes("taillight") && !this.taillightMeshes.includes(child)) {
					this.taillightMeshes.push(child);
				}
				if (mark.includes("headlight") && !this.headlightMeshes.includes(child)) {
					this.headlightMeshes.push(child);
				}

				console.log(`[VehicleLights] Created ${mark} overlay "${key}" on "${child.name}" with ${group.faces.length} faces`);
			}
		});

		// Debug: log what was found
		for (const h of this.headlightMeshes) {
			const mat = Array.isArray(h.material) ? h.material[0] : h.material;
			console.log(`[VehicleLights]   headlight: "${h.name}" markedAs=${h.userData.markedAs} mat.name="${mat?.name}" emissive=${mat instanceof THREE.MeshStandardMaterial ? `${mat.emissive.getHex().toString(16)}@${mat.emissiveIntensity}` : '?'}`);
		}
		for (const t of this.taillightMeshes) {
			const mat = Array.isArray(t.material) ? t.material[0] : t.material;
			console.log(`[VehicleLights]   taillight: "${t.name}" markedAs=${t.userData.markedAs} mat.name="${mat?.name}" emissive=${mat instanceof THREE.MeshStandardMaterial ? `${mat.emissive.getHex().toString(16)}@${mat.emissiveIntensity}` : '?'}`);
		}
		model.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const marked = child.userData.markedAs as string | undefined;
			if (marked) {
				console.log(`[VehicleLights]   marked mesh: "${child.name}" markedAs=${marked}`);
			}
		});
	}

	applyHeadlightEmissive(intensity: number): void {
		const color = new THREE.Color(0xfff5e0);
		for (const mesh of this.headlightMeshes) {
			if (this.overlayMeshes.has(mesh.uuid)) continue;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) {
					mat.emissive = color;
					mat.emissiveIntensity = intensity;
				}
			}
		}
		for (const ov of this.overlays) {
			if (!ov.markedAs.includes("headlight")) continue;
			ov.material.emissive = color;
			ov.material.emissiveIntensity = intensity;
		}
	}

	applyTaillightEmissive(intensity: number, color?: THREE.Color): void {
		const c = color ?? new THREE.Color(0xff0000);
		for (const mesh of this.taillightMeshes) {
			if (this.overlayMeshes.has(mesh.uuid)) continue;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) {
					mat.emissive = c;
					mat.emissiveIntensity = intensity;
				}
			}
		}
		for (const ov of this.overlays) {
			if (!ov.markedAs.includes("taillight")) continue;
			ov.material.emissive = c;
			ov.material.emissiveIntensity = intensity;
		}
	}

	/** Initialize taillight base color to dark red. */
	initTaillightBase(): void {
		for (const mesh of this.taillightMeshes) {
			if (this.overlayMeshes.has(mesh.uuid)) continue;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) mat.color.setHex(0x330000);
			}
		}
		this.applyTaillightEmissive(0.1);
	}

	setBraking(isBraking: boolean): void {
		for (const mesh of this.taillightMeshes) {
			if (this.overlayMeshes.has(mesh.uuid)) continue;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				if (isBraking) {
					mat.emissive.setHex(0xff0000);
					mat.emissiveIntensity = 3.0;
					mat.color.setHex(0xff0000);
				} else {
					mat.emissive.setHex(0xff0000);
					mat.emissiveIntensity = 0.1;
					mat.color.setHex(0x330000);
				}
			}
		}
		for (const ov of this.overlays) {
			if (!ov.markedAs.includes("taillight")) continue;
			if (isBraking) {
				ov.material.emissive.setHex(0xff0000);
				ov.material.emissiveIntensity = 3.0;
				ov.material.color.setHex(0xff0000);
			} else {
				ov.material.emissive.setHex(0xff0000);
				ov.material.emissiveIntensity = 0.1;
				ov.material.color.setHex(0x330000);
			}
		}
	}

	setReversing(isReversing: boolean): void {
		for (const mesh of this.taillightMeshes) {
			if (this.overlayMeshes.has(mesh.uuid)) continue;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				if (isReversing) {
					mat.emissive.setHex(0xffffff);
					mat.emissiveIntensity = 2.0;
					mat.color.setHex(0xffffff);
				} else {
					mat.emissive.setHex(0xff0000);
					mat.emissiveIntensity = 0.1;
					mat.color.setHex(0x330000);
				}
			}
		}
		for (const ov of this.overlays) {
			if (!ov.markedAs.includes("taillight")) continue;
			if (isReversing) {
				ov.material.emissive.setHex(0xffffff);
				ov.material.emissiveIntensity = 2.0;
				ov.material.color.setHex(0xffffff);
			} else {
				ov.material.emissive.setHex(0xff0000);
				ov.material.emissiveIntensity = 0.1;
				ov.material.color.setHex(0x330000);
			}
		}
		if (this._reverseLight) this._reverseLight.intensity = isReversing ? 5 : 0;
	}

	/** Sync overlay transforms with their source meshes (call each frame). */
	updateOverlays(): void {
		for (const ov of this.overlays) {
			ov.source.updateMatrixWorld(true);
			ov.mesh.matrixWorld.copy(ov.source.matrixWorld);
		}
	}

	/** Clean up overlay meshes. */
	dispose(): void {
		for (const ov of this.overlays) {
			ov.mesh.geometry.dispose();
			ov.material.dispose();
			ov.mesh.parent?.remove(ov.mesh);
		}
		this.overlays = [];
		this.overlayMeshes.clear();
	}

	setHeadlightIntensity(intensity: number): void {
		this.applyHeadlightEmissive(intensity * 2.0);
	}

	addReverseLight(model: THREE.Group): void {
		const ch = this.config.chassis;
		const rearZ = -ch.halfExtents[2];
		const y = ch.halfExtents[1] * 0.3;

		const light = new THREE.SpotLight(0xffffff, 0, 30, Math.PI / 6, 0.5, 1.5);
		light.position.set(0, y, rearZ);
		const target = new THREE.Object3D();
		target.position.set(0, y - 1, rearZ - 15);
		model.add(target);
		light.target = target;
		light.castShadow = false;
		model.add(light);
		this._reverseLight = light;
	}

	addHeadlights(model: THREE.Group): void {
		const ch = this.config.chassis;
		const frontZ = ch.halfExtents[2];
		const halfW = ch.halfExtents[0];
		const y = ch.halfExtents[1] * 0.6;

		for (const side of [-1, 1] as const) {
			const light = new THREE.SpotLight(0xfff5e6, 0, 150, Math.PI / 5, 0.4, 1.5);
			light.position.set(side * halfW * 0.65, y, frontZ);
			const target = new THREE.Object3D();
			target.position.set(side * halfW * 0.3, -2, frontZ + 20);
			model.add(target);
			light.target = target;
			light.castShadow = false;
			model.add(light);
			this.headlights.push(light);
		}
	}

	getHeadlightData(physicsForward?: { x: number; y: number; z: number }): {
		positions: THREE.Vector3[];
		directions: THREE.Vector3[];
		intensity: number;
	} | null {
		if (this.headlights.length === 0) return null;

		const positions: THREE.Vector3[] = [];
		const directions: THREE.Vector3[] = [];

		// Note: model needs updateMatrixWorld called by caller before this
		for (const light of this.headlights) {
			const pos = new THREE.Vector3();
			light.getWorldPosition(pos);
			positions.push(pos);
			const dir = (
				physicsForward
					? new THREE.Vector3(physicsForward.x, physicsForward.y, physicsForward.z)
					: new THREE.Vector3(0, 0, 1)
			).clone();
			dir.y = -0.1;
			dir.normalize();
			directions.push(dir);
		}

		return { positions, directions, intensity: this.headlights[0].intensity };
	}
}
