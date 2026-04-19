/**
 * VehicleRenderer — Three.js model loading, visual sync, headlights.
 *
 * Handles all Three.js-dependent code:
 * - GLTF model loading and scaling
 * - Marker-based chassis auto-derivation
 * - Wheel loading from external GLB or procedural generation
 * - Headlight/taillight emissive effects with bloom
 * - Reverse light (back spotlight)
 * - Visual sync (position, rotation, wheel spin/steer)
 *
 * VehicleController creates this and calls sync() each frame.
 * NO physics, NO audio — pure rendering.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig } from "./configs.ts";

const WHEEL_MODEL_PATH = "/assets/new-car/car.glb";

export class VehicleRenderer {
	model: THREE.Group | null = null;
	readonly wheelMeshes: THREE.Object3D[] = [];
	headlights: THREE.SpotLight[] = [];
	private _modelGroundOffset = 0;
	private config: CarConfig;

	// Light effect refs
	private headlightMeshes: THREE.Mesh[] = [];
	private taillightMeshes: THREE.Mesh[] = [];
	private _reverseLight: THREE.SpotLight | null = null;
	private _escapeL: THREE.Object3D | null = null;
	private _escapeR: THREE.Object3D | null = null;

	constructor(config: CarConfig) {
		this.config = config;
	}

	/** Expose auto-derived config so physics can use it. */
	get derivedConfig(): CarConfig {
		return this.config;
	}

	getModelGroundOffset(): number {
		return this._modelGroundOffset;
	}

	get escapeL(): THREE.Object3D | null {
		return this._escapeL;
	}

	get escapeR(): THREE.Object3D | null {
		return this._escapeR;
	}

	/** Load GLTF model, apply scale, derive chassis, load wheels, add headlights. */
	async loadModel(onConfigChanged?: (config: CarConfig) => void): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		this.model = gltf.scene;

		// ── Apply model scale if specified ──
		const scale = this.config.modelScale && this.config.modelScale !== 1 ? this.config.modelScale : 1;
		if (scale !== 1) {
			this.model.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
				}
				if (child.position.lengthSq() > 0) {
					child.position.multiplyScalar(scale);
				}
			});
			if (this.model) this.model.updateMatrixWorld(true);
		}

		// ── Enable shadows ──
		this.model.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		// ── Find light meshes and escape pipes ──
		this.findLightMeshes();
		this.findEscapePipes();

		// ── Auto-derive chassis from markers ──
		this.autoDeriveChassis();
		if (onConfigChanged) onConfigChanged(this.config);

		// ── Load wheels from external GLB, falling back to procedural ──
		while (this.wheelMeshes.length > 0) this.wheelMeshes.pop();
		const wheelsLoaded = await this.loadWheelsFromGLB();

		if (!wheelsLoaded) {
			// Try to find existing wheel meshes by name
			for (const name of ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"]) {
				const obj = this.model.getObjectByName(name);
				if (obj) this.wheelMeshes.push(obj);
			}
		}

		// ── Generate wheels from markers if none found ──
		if (this.wheelMeshes.length === 0) {
			this.generateWheelsFromMarkers();
		}

		// ── Add headlights (spotlights for terrain shader) ──
		this.addHeadlights();

		// ── Add reverse light ──
		this.addReverseLight();

		// ── Apply initial light state ──
		this.applyHeadlightEmissive(0.8);
		this.applyTaillightEmissive(0.3);

		return this.model;
	}

	// ── Wheel loading from external GLB ──────────────────────────────────

	private async loadWheelsFromGLB(): Promise<boolean> {
		if (!this.model) return false;

		const wheelNames = ["WheelRig_FrontLeft", "WheelRig_FrontRight", "WheelRig_RearLeft", "WheelRig_RearRight"];

		// Check if markers exist on this model
		if (!this.model) return false;
		const root = this.model;
		const markers: (THREE.Object3D | null)[] = wheelNames.map((n) => this.findMarkerRecursive(root, n));
		if (markers.some((m) => !m)) return false;

		try {
			const loader = new GLTFLoader();
			const wheelGltf = await loader.loadAsync(WHEEL_MODEL_PATH);
			const wheelScene = wheelGltf.scene;

			// Find wheel_1 node
			const wheelTemplate = wheelScene.getObjectByName("wheel_1");
			if (!wheelTemplate) {
				console.warn("[VehicleRenderer] wheel_1 not found in wheel GLB");
				return false;
			}

			// Clone wheel for each WheelRig marker
			for (let i = 0; i < 4; i++) {
				const marker = markers[i];
				if (!marker) continue;
				const wheelClone = wheelTemplate.clone();
				wheelClone.name = `wheel_clone_${i}`;

				// Position at marker location
				const markerWorldPos = new THREE.Vector3();
				marker.getWorldPosition(markerWorldPos);
				wheelClone.position.copy(markerWorldPos);

				// Remove marker (it's an empty, wheels replace it visually)
				marker.parent?.remove(marker);

				// Apply wheel rotation to align axle with X axis
				// GLTF cylinders are typically Y-up; wheels need to spin around X
				wheelClone.rotation.set(0, 0, Math.PI / 2);

				this.model.add(wheelClone);
				this.wheelMeshes.push(wheelClone);
			}

			console.log("[VehicleRenderer] Loaded 4 wheels from external GLB");
			return true;
		} catch (e) {
			console.warn("[VehicleRenderer] Failed to load wheel GLB:", e);
			return false;
		}
	}

	// ── Light meshes ─────────────────────────────────────────────────────

	private findLightMeshes(): void {
		if (!this.model) return;
		this.headlightMeshes = [];
		this.taillightMeshes = [];

		this.model.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const mat = child.material;
			if (!mat) return;

			if (Array.isArray(mat)) {
				for (const m of mat) {
					if (m.name === "front_light_1" && !this.headlightMeshes.includes(child)) {
						this.headlightMeshes.push(child);
					}
					if (m.name === "back_light" && !this.taillightMeshes.includes(child)) {
						this.taillightMeshes.push(child);
					}
				}
			} else {
				if (mat.name === "front_light_1") this.headlightMeshes.push(child);
				if (mat.name === "back_light") this.taillightMeshes.push(child);
			}
		});

		console.log(
			`[VehicleRenderer] Found ${this.headlightMeshes.length} headlight meshes, ${this.taillightMeshes.length} taillight meshes`,
		);
	}

	private findEscapePipes(): void {
		if (!this.model) return;
		this._escapeL = this.findMarkerRecursive(this.model, "escape_l");
		this._escapeR = this.findMarkerRecursive(this.model, "escape_r");
		if (this._escapeL) console.log("[VehicleRenderer] Found escape_l exhaust pipe");
		if (this._escapeR) console.log("[VehicleRenderer] Found escape_r exhaust pipe");
	}

	private applyHeadlightEmissive(intensity: number): void {
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

	private applyTaillightEmissive(intensity: number, color?: THREE.Color): void {
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

	// ── Light control methods ────────────────────────────────────────────

	/** Update tail light intensity (dim vs brake). */
	setBraking(isBraking: boolean): void {
		if (isBraking) {
			this.applyTaillightEmissive(3.0); // Bright brake — above bloom threshold of 1.5
		} else {
			this.applyTaillightEmissive(0.3); // Dim tail
		}
	}

	/** Update tail light for reverse gear + activate reverse spotlight. */
	setReversing(isReversing: boolean): void {
		if (isReversing) {
			this.applyTaillightEmissive(2.0, new THREE.Color(0xffffff)); // White reverse glow
			if (this._reverseLight) this._reverseLight.intensity = 5;
		} else {
			this.applyTaillightEmissive(0.3); // Back to red tail
			if (this._reverseLight) this._reverseLight.intensity = 0;
		}
	}

	/** Update headlight brightness (for day/night cycle). */
	setHeadlightIntensity(intensity: number): void {
		for (const light of this.headlights) {
			light.intensity = intensity * 20; // Scale up for visible effect
		}
		this.applyHeadlightEmissive(intensity);
	}

	// ── Reverse light ────────────────────────────────────────────────────

	private addReverseLight(): void {
		if (!this.model) return;

		const ch = this.config.chassis;
		const rearZ = -ch.halfExtents[2];
		const y = ch.halfExtents[1] * 0.3;

		const light = new THREE.SpotLight(0xffffff, 0, 30, Math.PI / 6, 0.5, 1.5);
		light.position.set(0, y, rearZ);
		const target = new THREE.Object3D();
		target.position.set(0, y - 1, rearZ - 15);
		this.model.add(target);
		light.target = target;
		light.castShadow = false;
		this.model.add(light);
		this._reverseLight = light;
	}

	// ── Chassis auto-derivation ──────────────────────────────────────────

	private autoDeriveChassis(): void {
		if (!this.model) return;

		const physicsMarker = this.findMarkerRecursive(this.model, "PhysicsMarker");
		const wheelRigs: THREE.Object3D[] = [];
		for (const name of ["WheelRig_FrontLeft", "WheelRig_FrontRight", "WheelRig_RearLeft", "WheelRig_RearRight"]) {
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

	// ── Helpers ──────────────────────────────────────────────────────────

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

		const wheelNames = ["WheelRig_FrontLeft", "WheelRig_FrontRight", "WheelRig_RearLeft", "WheelRig_RearRight"];

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
			const light = new THREE.SpotLight(0xfff5e6, 20, 150, Math.PI / 5, 0.4, 1.5);
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

	/** Get headlight world-space positions and directions for terrain shader. */
	getHeadlightData(physicsForward?: {
		x: number;
		y: number;
		z: number;
	}): { positions: THREE.Vector3[]; directions: THREE.Vector3[]; intensity: number } | null {
		if (this.headlights.length === 0) return null;
		this.model?.updateMatrixWorld(true);

		const positions: THREE.Vector3[] = [];
		const directions: THREE.Vector3[] = [];

		let fwd: THREE.Vector3;
		if (physicsForward) {
			fwd = new THREE.Vector3(physicsForward.x, physicsForward.y, physicsForward.z);
		} else {
			fwd = new THREE.Vector3(0, 0, 1);
			fwd.applyQuaternion(this.model?.quaternion ?? new THREE.Quaternion());
		}

		for (const light of this.headlights) {
			const pos = new THREE.Vector3();
			light.getWorldPosition(pos);
			positions.push(pos);
			const dir = fwd.clone();
			dir.y = -0.1;
			dir.normalize();
			directions.push(dir);
		}

		return { positions, directions, intensity: this.headlights[0].intensity };
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
