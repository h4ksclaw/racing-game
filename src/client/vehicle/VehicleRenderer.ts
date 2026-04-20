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
import { VehicleLights } from "./lights/VehicleLights.ts";

export class VehicleRenderer {
	model: THREE.Group | null = null;
	readonly wheelMeshes: THREE.Object3D[] = [];
	// headlights accessed via this.lights.headlights
	private _modelGroundOffset = 0;
	private _suspRestLength = 0;
	private _diagCount = 0;
	/** Per-wheel visual radius measured from world-space AABB at load time. */
	private _visualWheelRadii = [0, 0, 0, 0];
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

	// Light management (delegated to VehicleLights)
	readonly lights: VehicleLights;

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

	private _escapeL: THREE.Object3D | null = null;
	private _escapeR: THREE.Object3D | null = null;

	constructor(config: CarConfig) {
		this.config = config;
		this.schema = config.modelSchema ?? DEFAULT_CAR_MODEL_SCHEMA;
		this.lights = new VehicleLights(this.schema, config);
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
		this.lights.findLightMeshes(this.model);
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
		this.lights.addHeadlights(this.model);

		// ── Add reverse light ──
		this.lights.addReverseLight(this.model);

		// ── Initial light state: emissive OFF, let sky.ts control via setHeadlightIntensity ──
		this.lights.applyHeadlightEmissive(0);
		// Set tail light base color
		this.lights.initTaillightBase();

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
				// After rotation, axle is along X — Y and Z extents are radial.
				this._visualWheelRadii[i] = Math.max(bsize.y, bsize.z) / 2;
				console.log(
					`[VehicleRenderer] wheel ${i} bbox: (${bsize.x.toFixed(3)}, ${bsize.y.toFixed(3)}, ${bsize.z.toFixed(3)}) ` +
						`visualRadius=${this._visualWheelRadii[i].toFixed(3)}`,
				);
			}

			// Store full base positions for suspension visual + pitch/roll compensation.
			this._suspRestLength = this.config.chassis.suspensionRestLength;
			for (let wi = 0; wi < 4; wi++) {
				this._wheelBasePos[wi].copy(this.wheelMeshes[wi].position);
			}

			// Raise the whole model so wheels don't poke through the body.
			// The visual wheel is smaller than physics expects, so we shift
			// the entire model up by the radius delta (applied as ground offset).
			const maxRadiusDelta = Math.max(...this._visualWheelRadii.map((v) => this.config.chassis.wheelRadius - v));
			if (maxRadiusDelta > 0.005) {
				this._modelGroundOffset += maxRadiusDelta + 0.02;
				console.log(
					`[VehicleRenderer] Raising model by ${maxRadiusDelta.toFixed(3)}m to compensate wheel radius mismatch`,
				);
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

			const discs: { mesh: THREE.Mesh; axleDir: THREE.Vector3; baseQuat: THREE.Quaternion }[] = [];
			wheelClone.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				const mat = child.material;
				if (!mat?.name || !this.schema.brakeDiscMaterials.includes(mat.name)) return;

				const qToPivot = new THREE.Quaternion();
				let node: THREE.Object3D | null = child;
				while (node && node !== wheelClone) {
					qToPivot.premultiply(node.quaternion);
					node = node.parent;
				}
				if (node === wheelClone) qToPivot.premultiply(wheelClone.quaternion);

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

	// ── Light control methods ────────────────────────────────────────────

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

		const wheelCenterY = wheelWorldPositions[0].y;
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

			const worldPos = new THREE.Vector3();
			marker.getWorldPosition(worldPos);
			this.model.worldToLocal(worldPos);
			tireMesh.position.copy(worldPos);

			this.model.add(tireMesh);
			this.wheelMeshes.push(tireMesh);
		}
	}

	private wheelSpinAngles = [0, 0, 0, 0];

	/** Delegate: update tail light intensity. */
	setBraking(isBraking: boolean): void {
		this.lights.setBraking(isBraking);
	}

	/** Delegate: update tail light for reverse + reverse spotlight. */
	setReversing(isReversing: boolean): void {
		this.lights.setReversing(isReversing);
	}

	/** Delegate: update headlight brightness for day/night cycle. */
	setHeadlightIntensity(intensity: number): void {
		this.lights.setHeadlightIntensity(intensity);
	}

	/** Delegate: get headlight world-space positions for terrain shader. */
	getHeadlightData(physicsForward?: {
		x: number;
		y: number;
		z: number;
	}): { positions: THREE.Vector3[]; directions: THREE.Vector3[]; intensity: number } | null {
		this.model?.updateMatrixWorld(true);
		return this.lights.getHeadlightData(physicsForward);
	}

	sync(
		pos: { x: number; y: number; z: number },
		orientation: { x: number; y: number; z: number; w: number } | { heading: number; pitch: number; roll: number },
		steerAngle: number,
		speed: number,
		wheelRadius: number,
		dt = 1 / 60,
		suspLengths?: (number | null)[],
		wheelSpinAngles?: number[],
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
			if (wheelSpinAngles) {
				this.wheelSpinAngles[i] = wheelSpinAngles[i];
			} else {
				this.wheelSpinAngles[i] += (speed / wheelRadius) * dt;
			}

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

			// ── Wheel-ground alignment diagnostic (fires 3 times) ──
			if (this._diagCount < 3 && i === 0 && suspLengths?.[0]) {
				const pivotWorld = new THREE.Vector3(0, pivot.position.y, 0);
				pivotWorld.applyMatrix4(this.model.matrixWorld);
				// Compute visual radius from world-space AABB of the wheel pivot.
				// After baked rotation, axle is along X — use max(Y,Z)/2 as radius.
				let visualWheelRadius = wheelRadius;
				pivot.updateMatrixWorld(true);
				const visBb = new THREE.Box3().setFromObject(pivot);
				const visSize = new THREE.Vector3();
				visBb.getSize(visSize);
				visualWheelRadius = Math.max(visSize.y, visSize.z) / 2;
				const visualBotY = pivotWorld.y - visualWheelRadius;
				const halfH = this.config.chassis.halfExtents[1];
				const susLen = suspLengths[0] as number;
				const physicsBotY = pos.y - halfH - susLen - wheelRadius;
				console.log(
					`[WHEEL-DIAG] frame=${this._diagCount} ` +
						`bodyY=${pos.y.toFixed(3)} modelGroundOff=${this._modelGroundOffset.toFixed(3)} ` +
						`halfH=${halfH} anchorY=${(-halfH).toFixed(3)} ` +
						`susLen=${susLen.toFixed(4)} suspRest=${this._suspRestLength.toFixed(3)} ` +
						`basePos.y=${basePos.y.toFixed(3)} suspOffset=${suspOffset.toFixed(4)} ` +
						`pivotWorld.y=${pivotWorld.y.toFixed(3)} ` +
						`visualWheelRadius=${visualWheelRadius.toFixed(3)} physicsWheelRadius=${wheelRadius.toFixed(3)} ` +
						`visualBotY=${visualBotY.toFixed(3)} physicsBotY=${physicsBotY.toFixed(3)} ` +
						`delta=${(visualBotY - physicsBotY).toFixed(4)}`,
				);
				this._diagCount++;
			}

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
