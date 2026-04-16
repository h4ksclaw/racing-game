/**
 * VehicleRenderer — Three.js model loading, visual sync, headlights.
 *
 * Handles all Three.js-dependent code:
 * - GLTF model loading and scaling
 * - Marker-based chassis auto-derivation
 * - Procedural wheel generation
 * - Headlight management
 * - Visual sync (position, rotation, wheel spin/steer)
 *
 * VehicleController creates this and calls sync() each frame.
 * NO physics, NO audio — pure rendering.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig } from "./configs.ts";

export class VehicleRenderer {
	model: THREE.Group | null = null;
	private wheelMeshes: THREE.Object3D[] = [];
	headlights: THREE.SpotLight[] = [];
	private _modelGroundOffset = 0;
	private config: CarConfig;

	constructor(config: CarConfig) {
		this.config = config;
	}

	getModelGroundOffset(): number {
		return this._modelGroundOffset;
	}

	/** Load GLTF model, apply scale, derive chassis, generate wheels, add headlights. */
	async loadModel(onConfigChanged?: (config: CarConfig) => void): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		this.model = gltf.scene;

		// ── Apply model scale if specified ──
		const scale =
			this.config.modelScale && this.config.modelScale !== 1 ? this.config.modelScale : 1;
		if (scale !== 1) {
			this.model.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
				}
				if (child.position.lengthSq() > 0) {
					child.position.multiplyScalar(scale);
				}
			});
			this.model.updateMatrixWorld(true);
		}

		// ── Enable shadows ──
		this.model.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		// ── Headlights ──
		this.addHeadlights();

		// ── Auto-derive chassis from markers ──
		this.autoDeriveChassis();
		if (onConfigChanged) onConfigChanged(this.config);

		// ── Find wheel meshes ──
		this.wheelMeshes = [];
		for (const name of [
			"wheel-front-left",
			"wheel-front-right",
			"wheel-back-left",
			"wheel-back-right",
		]) {
			const obj = this.model.getObjectByName(name);
			if (obj) this.wheelMeshes.push(obj);
		}

		// ── Generate wheels from markers if none found ──
		if (this.wheelMeshes.length === 0) {
			this.generateWheelsFromMarkers();
		}

		return this.model;
	}

	private autoDeriveChassis(): void {
		if (!this.model) return;

		const physicsMarker = this.findMarkerRecursive(this.model, "PhysicsMarker");
		const wheelRigs: THREE.Object3D[] = [];
		for (const name of [
			"WheelRig_FrontLeft",
			"WheelRig_FrontRight",
			"WheelRig_RearLeft",
			"WheelRig_RearRight",
		]) {
			const obj = this.findMarkerRecursive(this.model, name);
			if (obj) wheelRigs.push(obj);
		}

		if (wheelRigs.length < 4 || !physicsMarker) return;

		const markerPos = new THREE.Vector3();
		physicsMarker.getWorldPosition(markerPos);
		const pmY = markerPos.y;

		const wheelWorldPositions: THREE.Vector3[] = [];
		for (const rig of wheelRigs) {
			const wp = new THREE.Vector3();
			rig.getWorldPosition(wp);
			wheelWorldPositions.push(wp);
		}

		const radii = wheelWorldPositions.map((wp) => Math.abs(wp.y - pmY));
		const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;

		const frontZ = (wheelWorldPositions[0].z + wheelWorldPositions[1].z) / 2;
		const rearZ = (wheelWorldPositions[2].z + wheelWorldPositions[3].z) / 2;
		const wheelBase = Math.abs(frontZ - rearZ);

		const bodyBox = new THREE.Box3();
		this.model.traverse((child) => {
			if (child instanceof THREE.Mesh && child.name !== "textured_mesh_BACKUP") {
				child.geometry.computeBoundingBox();
				if (child.geometry.boundingBox) {
					const box = child.geometry.boundingBox.clone();
					box.applyMatrix4(child.matrixWorld);
					bodyBox.union(box);
				}
			}
		});

		const bodySize = new THREE.Vector3();
		bodyBox.getSize(bodySize);
		const bodyBottom = bodyBox.min.y;
		const bodyTop = bodyBox.max.y;
		const cgHeight = Math.max(pmY - bodyBottom, (bodyTop - bodyBottom) * 0.4);

		this._modelGroundOffset = -pmY;

		const rootPos = new THREE.Vector3();
		this.model.getWorldPosition(rootPos);

		this.config = {
			...this.config,
			chassis: {
				...this.config.chassis,
				wheelRadius: avgRadius,
				wheelBase,
				wheelPositions: wheelWorldPositions.map((wp) => ({
					x: wp.x - rootPos.x,
					y: wp.y - rootPos.y,
					z: wp.z - rootPos.z,
				})),
				halfExtents: [bodySize.x / 2, bodySize.y / 2, bodySize.z / 2],
				cgHeight,
			},
		};
	}

	private findMarkerRecursive(parent: THREE.Object3D, name: string): THREE.Object3D | null {
		for (const child of parent.children) {
			if (child.name === name) return child;
			const found = this.findMarkerRecursive(child, name);
			if (found) return found;
		}
		return null;
	}

	private generateWheelsFromMarkers(): void {
		if (!this.model) return;

		const wheelNames = [
			"WheelRig_FrontLeft",
			"WheelRig_FrontRight",
			"WheelRig_RearLeft",
			"WheelRig_RearRight",
		];

		const radius = this.config.chassis.wheelRadius;
		const width = radius * 0.8;

		for (const name of wheelNames) {
			const marker = this.findMarkerRecursive(this.model, name);
			if (!marker) continue;

			const tireGeom = new THREE.CylinderGeometry(radius, radius, width, 16);
			tireGeom.rotateZ(Math.PI / 2);
			const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
			const tireMesh = new THREE.Mesh(tireGeom, tireMat);

			const rimGeom = new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, width * 0.85, 8);
			rimGeom.rotateZ(Math.PI / 2);
			const rimMat = new THREE.MeshStandardMaterial({
				color: 0x888888,
				metalness: 0.8,
				roughness: 0.3,
			});
			const rimMesh = new THREE.Mesh(rimGeom, rimMat);
			tireMesh.add(rimMesh);

			tireMesh.position.copy(marker.position);
			this.model.add(tireMesh);
			this.wheelMeshes.push(tireMesh);
		}
	}

	private addHeadlights(): void {
		if (!this.model) return;

		const ch = this.config.chassis;
		const frontZ = ch.halfExtents[2];
		const halfW = ch.halfExtents[0];
		const y = ch.halfExtents[1] * 0.6;

		for (const side of [-1, 1] as const) {
			const light = new THREE.SpotLight(0xfff5e6, 0, 150, Math.PI / 5, 0.4, 1.5);
			light.position.set(side * halfW * 0.65, y, frontZ);
			const target = new THREE.Object3D();
			target.position.set(side * halfW * 0.3, -2, frontZ + 20);
			this.model.add(target);
			light.target = target;
			light.castShadow = false;
			this.model.add(light);
			this.headlights.push(light);
		}
	}

	/** Sync visual position, rotation, and wheel animation from physics state. */
	sync(
		pos: { x: number; y: number; z: number },
		heading: number,
		pitch: number,
		roll: number,
		steerAngle: number,
		speed: number,
		modelGroundOffset: number,
		wheelRadius: number,
	): void {
		if (!this.model) return;

		this.model.position.set(pos.x, pos.y + modelGroundOffset, pos.z);
		this.model.rotation.set(pitch, heading, roll);

		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			if (i < 2) {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, steerAngle, 0));
			} else {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			}

			const spinAngle = (speed / wheelRadius) * 0.016;
			const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spinAngle);
			mesh.quaternion.multiply(spinQ);
		}
	}
}
