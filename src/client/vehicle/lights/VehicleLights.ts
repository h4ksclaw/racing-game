/**
 * VehicleLights — headlight/taillight/reverse light management.
 *
 * Extracted from VehicleRenderer to isolate light logic from model loading.
 */

import * as THREE from "three";
import type { CarConfig, CarModelSchema } from "../configs.ts";

export class VehicleLights {
	private readonly schema: CarModelSchema;
	private readonly config: CarConfig;
	headlightMeshes: THREE.Mesh[] = [];
	private taillightMeshes: THREE.Mesh[] = [];
	headlights: THREE.SpotLight[] = [];
	private _reverseLight: THREE.SpotLight | null = null;

	constructor(schema: CarModelSchema, config: CarConfig) {
		this.schema = schema;
		this.config = config;
	}

	/** Find headlight and taillight meshes in the model. */
	findLightMeshes(model: THREE.Group): void {
		this.headlightMeshes = [];
		this.taillightMeshes = [];

		model.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const mat = child.material;
			if (!mat) return;

			if (Array.isArray(mat)) {
				for (const m of mat) {
					if (m.name === this.schema.materials.headlight && !this.headlightMeshes.includes(child)) {
						this.headlightMeshes.push(child);
					}
					if (m.name === this.schema.materials.taillight && !this.taillightMeshes.includes(child)) {
						this.taillightMeshes.push(child);
					}
				}
			} else {
				if (mat.name === this.schema.materials.headlight) this.headlightMeshes.push(child);
				if (mat.name === this.schema.materials.taillight) this.taillightMeshes.push(child);
			}
		});

		console.log(
			`[VehicleLights] Found ${this.headlightMeshes.length} headlight meshes, ${this.taillightMeshes.length} taillight meshes`,
		);
	}

	applyHeadlightEmissive(intensity: number): void {
		const color = new THREE.Color(0xfff5e0);
		for (const mesh of this.headlightMeshes) {
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) {
					mat.emissive = color;
					mat.emissiveIntensity = intensity;
				}
			}
		}
	}

	applyTaillightEmissive(intensity: number, color?: THREE.Color): void {
		const c = color ?? new THREE.Color(0xff0000);
		for (const mesh of this.taillightMeshes) {
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) {
					mat.emissive = c;
					mat.emissiveIntensity = intensity;
				}
			}
		}
	}

	/** Initialize taillight base color to dark red. */
	initTaillightBase(): void {
		for (const mesh of this.taillightMeshes) {
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) mat.color.setHex(0x330000);
			}
		}
		this.applyTaillightEmissive(0.1);
	}

	setBraking(isBraking: boolean): void {
		for (const mesh of this.taillightMeshes) {
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
	}

	setReversing(isReversing: boolean): void {
		for (const mesh of this.taillightMeshes) {
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
		if (this._reverseLight) this._reverseLight.intensity = isReversing ? 5 : 0;
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

	getHeadlightData(physicsForward?: {
		x: number;
		y: number;
		z: number;
	}): { positions: THREE.Vector3[]; directions: THREE.Vector3[]; intensity: number } | null {
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
