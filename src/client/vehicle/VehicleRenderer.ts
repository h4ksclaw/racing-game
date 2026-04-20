/**
 * VehicleRenderer — all Three.js rendering for the vehicle.
 *
 * WHY a dedicated renderer: Three.js is the only dependency. Physics and audio
 * systems call sync() each frame with computed state — the renderer owns all
 * visual representation. This keeps RapierVehicleController free of any
 * THREE.js imports and makes the renderer testable in isolation (swap GLTF
 * loader for a mock).
 *
 * Responsibilities:
 * - GLTF model loading with CarModelSchema validation
 * - Marker-based chassis auto-derivation (wheel positions, CG height)
 * - Wheel loading from external GLB or procedural generation
 * - Brake disc extraction (non-spinning, tracks car body)
 * - Headlight/taillight emissive effects with bloom
 * - Visual sync (position, rotation, wheel spin/steer)
 *
 * NO physics, NO audio — pure rendering.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CarConfig, CarModelSchema } from "./configs.ts";
import { DEFAULT_CAR_MODEL_SCHEMA } from "./configs.ts";

export class VehicleRenderer {
	model: THREE.Group | null = null;
	readonly wheelMeshes: THREE.Object3D[] = [];
	headlights: THREE.SpotLight[] = [];
	private _modelGroundOffset = 0;
	private _suspRestLength = 0;
	/** Full local positions of wheel pivots (set at load time). Used for pitch/roll visual compensation. */
	private _wheelBasePos: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
		new THREE.Vector3(),
		new THREE.Vector3(),
		new THREE.Vector3(),
		new THREE.Vector3(),
	];
	private config: CarConfig;
	private readonly schema: CarModelSchema;
	/** Per-wheel brake disc data — axle direction in disc-local frame + base quaternion. */
	private _brakeDiscsByWheel: Record<
		number,
		{ mesh: THREE.Mesh; axleDir: THREE.Vector3; baseQuat: THREE.Quaternion }[]
	> = {};

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
						typeof (mesh as THREE.Mesh).geometry?.computeBoundingBox === "function"
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
		this.schema = config.modelSchema ?? DEFAULT_CAR_MODEL_SCHEMA;
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
		this._brakeDiscsByWheel = {};
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

		const wheelNames = this.schema.markers.wheels;
		const root = this.model;
		const markers: (THREE.Object3D | null)[] = wheelNames.map((n) => this.findMarkerRecursive(root, n));
		if (markers.some((m) => !m)) {
			console.warn(`[VehicleRenderer] Wheel markers not found: ${wheelNames.filter((_, i) => !markers[i]).join(", ")}`);
			return false;
		}

		try {
			const loader = new GLTFLoader();
			const wheelGltf = await loader.loadAsync(this.schema.wheelModelPath);
			const wheelScene = wheelGltf.scene;

			// Find wheel template node in wheel GLB
			const wheelTemplate = wheelScene.getObjectByName(this.schema.wheelTemplateNode);
			if (!wheelTemplate) {
				console.warn(`[VehicleRenderer] ${this.schema.wheelTemplateNode} not found in wheel GLB`);
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

			// Store full base positions for suspension visual + pitch/roll compensation.
			this._suspRestLength = this.config.chassis.suspensionRestLength;
			for (let wi = 0; wi < 4; wi++) {
				this._wheelBasePos[wi].copy(this.wheelMeshes[wi].position);
			}

			this.extractBrakeDiscs();
			console.log("[VehicleRenderer] Loaded 4 wheels from external GLB");
			return true;
		} catch (e) {
			console.warn("[VehicleRenderer] Failed to load wheel GLB:", e);
			return false;
		}
	}

	// ── Brake disc extraction ──────────────────────────────────────────────

	/**
	 * Find and track brake disc meshes inside each wheel clone.
	 *
	 * WHY: Brake discs must follow the wheel's position, suspension, steering, and
	 * baked rotation — but NOT spin. Rather than reparenting (which breaks local
	 * transforms), we leave them in the wheelClone hierarchy and counter-rotate
	 * against spin each frame in sync().
	 */
	private extractBrakeDiscs(): void {
		if (!this.model) return;
		this._brakeDiscsByWheel = {};

		for (let i = 0; i < this.wheelMeshes.length; i++) {
			const pivot = this.wheelMeshes[i];
			const wheelClone = pivot.children[0];
			if (!wheelClone) continue;

			// The pivot applies Euler(spin, steer, 0, "YXZ") in sync(). The spin
			// rotates around the pivot's local X axis (the axle). To counter this
			// on the brake disc (which is a deep descendant), we need the axle
			// direction expressed in the disc's own local frame.
			//
			// At load time the pivot has identity rotation, so the transform chain
			// from disc to pivot is just the baked hierarchy: wheelClone → Group → disc.
			// We compute: axleDir = inverse(Q_disc_to_pivot) * (1,0,0)

			const discs: { mesh: THREE.Mesh; axleDir: THREE.Vector3; baseQuat: THREE.Quaternion }[] = [];
			wheelClone.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				const mat = child.material;
				if (!mat?.name || !this.schema.brakeDiscMaterials.includes(mat.name)) return;

				// Compute accumulated rotation from disc up to the pivot (not including pivot).
				// Walk parent chain: disc → ... → wheelClone (stop before pivot).
				const qToPivot = new THREE.Quaternion();
				let node: THREE.Object3D | null = child;
				while (node && node !== wheelClone) {
					qToPivot.premultiply(node.quaternion);
					node = node.parent;
				}
				// Include wheelClone's own rotation
				if (node === wheelClone) qToPivot.premultiply(wheelClone.quaternion);

				// Axle in pivot-local space is X=(1,0,0). Transform to disc-local frame.
				const axleInPivot = new THREE.Vector3(1, 0, 0);
				const axleDir = axleInPivot.clone().applyQuaternion(qToPivot.clone().invert());

				discs.push({
					mesh: child,
					axleDir,
					baseQuat: child.quaternion.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axleDir, Math.PI / 2)),
				});
			});
			if (discs.length > 0) this._brakeDiscsByWheel[i] = discs;
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
			`[VehicleRenderer] Found ${this.headlightMeshes.length} headlight meshes, ${this.taillightMeshes.length} taillight meshes`,
		);
	}

	private findEscapePipes(): void {
		if (!this.model) return;
		const pipes = this.schema.markers.escapePipes;
		if (pipes?.left) {
			this._escapeL = this.findMarkerRecursive(this.model, pipes.left);
			if (this._escapeL) console.log(`[VehicleRenderer] Found ${pipes.left} exhaust pipe`);
		}
		if (pipes?.right) {
			this._escapeR = this.findMarkerRecursive(this.model, pipes.right);
			if (this._escapeR) console.log(`[VehicleRenderer] Found ${pipes.right} exhaust pipe`);
		}
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

		const physicsMarker = this.findMarkerRecursive(this.model, this.schema.markers.physicsMarker);
		const wheelRigs: THREE.Object3D[] = [];
		for (const name of this.schema.markers.wheels) {
			const obj = this.findMarkerRecursive(this.model, name);
			if (obj) wheelRigs.push(obj);
		}

		if (wheelRigs.length < 4 || !physicsMarker) {
			console.warn(
				`[VehicleRenderer] autoDerive: missing markers — physicsMarker=${!!physicsMarker}, ` +
					`wheels=${wheelRigs.length}/4 (expected: ${this.schema.markers.wheels.join(", ")})`,
			);
			return;
		}

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

		const rootPos = new THREE.Vector3();
		this.model.getWorldPosition(rootPos);

		// The Rapier cuboid should represent the chassis BODY (not including wheels).
		// Wheels extend below the body. The wheel center Y is the natural bottom boundary.
		// Wheel centers in GLB space = wheelWorldPositions[i].y (world, but model root is at origin)
		const wheelCenterY = wheelWorldPositions[0].y; // all wheels at same Y
		const bodyAboveWheels = bodyTop - wheelCenterY;
		const chassisHalfH = bodyAboveWheels / 2;

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
				halfExtents: [bodySize.x / 2, chassisHalfH, bodySize.z / 2],
				cgHeight,
			},
		};

		// Position the GLB model so its content fits inside the Rapier cuboid.
		// Rapier cuboid center = pos.y, cuboid bottom = pos.y - chassisHalfH.
		// The body mesh top = bodyTop (in GLB space), body mesh bottom ≈ wheelCenterY.
		// We need: model.y + bodyTop = pos.y + chassisHalfH  (tops align)
		// => model.y = pos.y + chassisHalfH - bodyTop
		// => offset = chassisHalfH - bodyTop
		this._modelGroundOffset = chassisHalfH - bodyTop;

		console.log(
			`[VehicleRenderer] autoDerive: wheelRadius=${avgRadius.toFixed(3)}, wheelBase=${wheelBase.toFixed(3)}, ` +
				`chassisHalfH=${chassisHalfH.toFixed(3)}, wheelCenterY=${wheelCenterY.toFixed(3)}, bodyTop=${bodyTop.toFixed(3)}, ` +
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

		const wheelNames = this.schema.markers.wheels;

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

	private wheelSpinAngles = [0, 0, 0, 0];

	/**
	 * Sync visual position, rotation, and wheel animation from physics state.
	 *
	 * Accepts either Euler angles (legacy) or a quaternion (preferred, from Rapier body).
	 * Handles body transform + wheel spin/steer — all rendering work lives here, not in game loop.
	 */
	/**
	 * Sync the visual model to physics state. Called every frame.
	 *
	 * @param pos - Physics body position (Rapier world coords)
	 * @param orientation - Body quaternion or euler angles
	 * @param steerAngle - Front wheel steer angle (radians)
	 * @param speed - Forward speed (m/s, positive = forward)
	 * @param wheelRadius - For computing spin rate
	 * @param dt - Frame timestep
	 * @param suspLengths - Optional per-wheel current suspension length from Rapier.
	 *   When provided, wheels visually offset vertically to simulate suspension travel.
	 *   Positive compression (rest > current) pushes wheel down relative to body.
	 */
	sync(
		pos: { x: number; y: number; z: number },
		orientation: { x: number; y: number; z: number; w: number } | { heading: number; pitch: number; roll: number },
		steerAngle: number,
		speed: number,
		wheelRadius: number,
		dt = 1 / 60,
		suspLengths?: (number | null)[],
	): void {
		if (!this.model) return;

		// Body transform
		this.model.position.set(pos.x, pos.y + this._modelGroundOffset, pos.z);
		if ("w" in orientation) {
			this.model.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
		} else {
			this.model.rotation.set(orientation.pitch, orientation.heading, orientation.roll);
		}

		// Wheel spin + steer on pivot groups
		for (let i = 0; i < 4; i++) {
			const pivot = this.wheelMeshes[i];
			if (!pivot) continue;

			const steer = i < 2 ? steerAngle : 0;
			this.wheelSpinAngles[i] += (speed / wheelRadius) * dt;

			// ── Wheel vertical positioning ──
			// The GLB wheel markers sit at the Rapier suspension anchor level in
			// model space (verified: anchorModelY = wheelCenterY). Physics places
			// the wheel center at anchor - susLen. So the pivot needs a -susLen
			// offset to match. Body rotation on slopes is handled automatically by
			// the Three.js transform hierarchy (pivot is a child of the model).

			const basePos = this._wheelBasePos[i];
			let suspOffset = 0;
			if (suspLengths && suspLengths[i] !== null && this._suspRestLength > 0) {
				suspOffset = -(suspLengths[i] as number);
			}

			pivot.position.y = basePos.y + suspOffset;

			// Inner wheel clone rotation is baked at load time (Y rotation for axle alignment).
			// Pivot: spin around X (axle), steer around Y.
			pivot.quaternion.setFromEuler(new THREE.Euler(this.wheelSpinAngles[i], steer, 0, "YXZ"));

			// Counter-rotate brake discs against spin so they stay fixed.
			// Spin rotates around pivot-local X (axle). The disc's axleDir was computed
			// at load time — it's the axle direction in the disc's local frame.
			const discs = this._brakeDiscsByWheel[i];
			if (discs) {
				for (const disc of discs) {
					disc.mesh.quaternion.copy(disc.baseQuat);
					disc.mesh.quaternion.premultiply(
						new THREE.Quaternion().setFromAxisAngle(disc.axleDir, -this.wheelSpinAngles[i]),
					);
				}
			}
		}
	}
}
