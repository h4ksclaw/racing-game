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

	/** Debug: return wheel state for inspection. */
	debugWheelState(): unknown[] {
		const result = [];
		for (let i = 0; i < this.wheelMeshes.length; i++) {
			const pivot = this.wheelMeshes[i];
			pivot.updateMatrixWorld(true);
			const wp = new THREE.Vector3();
			pivot.getWorldPosition(wp);

			const children: unknown[] = [];
			for (const child of pivot.children) {
				const childInfo: Record<string, unknown> = {
					name: child.name,
					type: child.type,
					rot: `(${child.rotation.x.toFixed(3)}, ${child.rotation.y.toFixed(3)}, ${child.rotation.z.toFixed(3)})`,
				};
				for (const mesh of child.children) {
					if (
						(mesh as THREE.Mesh).geometry &&
						typeof (mesh as THREE.Mesh).geometry!.computeBoundingBox === "function"
					) {
						(mesh as THREE.Mesh).geometry.computeBoundingBox();
						const bb = (mesh as THREE.Mesh).geometry.boundingBox!;
						childInfo.geoSize = {
							x: +(bb.max.x - bb.min.x).toFixed(3),
							y: +(bb.max.y - bb.min.y).toFixed(3),
							z: +(bb.max.z - bb.min.z).toFixed(3),
						};
					}
				}
				children.push(childInfo);
			}

			// World-space bbox
			const box = new THREE.Box3().setFromObject(pivot);
			const size = new THREE.Vector3();
			box.getSize(size);

			result.push({
				name: pivot.name,
				worldPos: { x: +wp.x.toFixed(3), y: +wp.y.toFixed(3), z: +wp.z.toFixed(3) },
				pivotRot: { x: +pivot.rotation.x.toFixed(3), y: +pivot.rotation.y.toFixed(3), z: +pivot.rotation.z.toFixed(3) },
				worldBBox: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
				children,
			});
		}
		return result;
	}
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

		// ── Apply model scale on root — scales everything proportionally ──
		const scale = this.config.modelScale && this.config.modelScale !== 1 ? this.config.modelScale : 1;
		if (scale !== 1) {
			this.model.scale.set(scale, scale, scale);
			this.model.updateMatrixWorld(true);
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

		// ── Initial light state: emissive OFF, let sky.ts control via setHeadlightIntensity ──
		this.applyHeadlightEmissive(0);
		// Set tail light base color to dark red so lighting alone doesn't trigger bloom
		for (const mesh of this.taillightMeshes) {
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				if (mat instanceof THREE.MeshStandardMaterial) mat.color.setHex(0x330000);
			}
		}
		this.applyTaillightEmissive(0.1);

		return this.model;
	}

	// ── Wheel loading from external GLB ──────────────────────────────────

	private async loadWheelsFromGLB(): Promise<boolean> {
		if (!this.model) return false;

		const wheelNames = ["WheelRig_FrontLeft", "WheelRig_FrontRight", "WheelRig_RearLeft", "WheelRig_RearRight"];
		const root = this.model;
		const markers: (THREE.Object3D | null)[] = wheelNames.map((n) => this.findMarkerRecursive(root, n));
		if (markers.some((m) => !m)) {
			console.warn("[VehicleRenderer] WheelRig markers not found on car model");
			return false;
		}

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

			// Place wheels at each marker's world position (model.scale handles scaling)
			for (let i = 0; i < 4; i++) {
				const marker = markers[i];
				if (!marker) continue;

				// Deep clone the wheel template
				const wheelClone = wheelTemplate.clone(true);
				wheelClone.name = `wheel_clone_${i}`;

				// Reset position/scale from wheel_1 in source GLB, but KEEP the GLB rotation
				// because children are oriented relative to it.
				// The GLB quaternion on wheel_1 already orients the wheel (axle points up/Y).
				// We need to compose: GLB rotation + additional Y rotation to align axle with X.
				wheelClone.position.set(0, 0, 0);
				wheelClone.scale.set(1, 1, 1);

				// Add Y rotation to map axle from Y (GLB's orientation) to X
				// Left wheels: -PI/2 around Y, Right wheels: +PI/2 around Y
				// Left wheels also get 180° around Z to flip the exterior face outward
				const isRight = i === 1 || i === 3;
				const additionalRot = new THREE.Quaternion().setFromEuler(
					new THREE.Euler(0, isRight ? Math.PI / 2 : -Math.PI / 2, isRight ? 0 : Math.PI),
				);
				// Compose: GLB rotation first, then our additional Y rotation (world space)
				wheelClone.quaternion.multiply(additionalRot);

				// Get marker's world position (includes parent chain + model.scale)
				const markerWorld = new THREE.Vector3();
				marker.getWorldPosition(markerWorld);
				this.model.worldToLocal(markerWorld);

				const pivot = new THREE.Group();
				pivot.name = `wheel_pivot_${i}`;
				pivot.position.copy(markerWorld);
				pivot.add(wheelClone);

				this.model.add(pivot);
				this.wheelMeshes.push(pivot); // sync() rotates the pivot

				console.log(
					`[VehicleRenderer] wheel ${i}: marker=${wheelNames[i]}, ` +
						`local=(${markerWorld.x.toFixed(3)}, ${markerWorld.y.toFixed(3)}, ${markerWorld.z.toFixed(3)})`,
				);
				const bb = new THREE.Box3().setFromObject(wheelClone);
				const bsize = new THREE.Vector3();
				bb.getSize(bsize);
				console.log(
					`[VehicleRenderer] wheel ${i} bbox: (${bsize.x.toFixed(3)}, ${bsize.y.toFixed(3)}, ${bsize.z.toFixed(3)})`,
				);
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
		// UnrealBloomPass applies to final pixel brightness, not just emissive.
		// A white-lit surface can exceed the bloom threshold even with low emissive.
		// Fix: dim the base color when not braking so lighting alone doesn't trigger bloom.
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

	/** Update tail light for reverse gear + activate reverse spotlight. */
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

	/**
	 * Update headlight brightness for day/night cycle.
	 * Called from sky.ts applyTimeOfDay — intensity is 0..1 (0=day, 1=full night).
	 * Controls both SpotLight intensity and mesh emissive bloom.
	 */
	setHeadlightIntensity(intensity: number): void {
		// SpotLight intensity is controlled by sky.ts via state.headlights array
		// We only control the emissive mesh glow here
		this.applyHeadlightEmissive(intensity * 2.0); // 0 in day, 2.0 at night (above bloom threshold)
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

		console.log(
			`[VehicleRenderer] autoDerive: wheelRadius=${avgRadius.toFixed(3)}, wheelBase=${wheelBase.toFixed(3)}, ` +
				`halfExtents=[${bodySize.x.toFixed(3)}/2, ${bodySize.y.toFixed(3)}/2, ${bodySize.z.toFixed(3)}/2], ` +
				`groundOffset=${this._modelGroundOffset.toFixed(3)}, pmY=${pmY.toFixed(3)}`,
		);
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

			// Use worldToLocal to get correct position relative to model root
			const worldPos = new THREE.Vector3();
			marker.getWorldPosition(worldPos);
			this.model.worldToLocal(worldPos);
			tireMesh.position.copy(worldPos);

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

	private wheelSpinAngle = 0;

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
		dt = 1 / 60,
	): void {
		if (!this.model) return;

		this.model.position.set(pos.x, pos.y + modelGroundOffset, pos.z);
		this.model.rotation.set(pitch, heading, roll);

		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			const steer = i < 2 ? steerAngle : 0;
			this.wheelSpinAngle += (speed / wheelRadius) * dt;

			// Inner wheel clone rotation is baked at load time (Y rotation for axle alignment)
			// Pivot: spin around X (axle), steer around Y
			mesh.quaternion.setFromEuler(new THREE.Euler(this.wheelSpinAngle, steer, 0, "YXZ"));
		}
	}
}
