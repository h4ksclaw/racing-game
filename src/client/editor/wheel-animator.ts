/**
 * WheelAnimator — drives wheel spin + suspension offset in the editor.
 *
 * Handles GLB models where meshes have baked geometry (position [0,0,0] but vertices
 * at world positions) by computing per-mesh position offsets to align geometry centers
 * with pivot origins — no geometry mutation needed.
 */
import * as THREE from "three";

export interface WheelAnimatorState {
	spinning: boolean;
	/** rad/s — angular velocity of all wheels */
	spinSpeed: number;
	/** Suspension Y offset in meters (negative = compress, positive = extend) */
	suspOffset: number;
	/** Per-wheel spin angles */
	spinAngles: number[];
}

const WHEEL_TYPES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
const BRAKE_TYPES = ["brake_disc_FL", "brake_disc_FR", "brake_disc_RL", "brake_disc_RR"];

interface BrakeDiscData {
	mesh: THREE.Mesh;
	baseQuat: THREE.Quaternion;
	/** Axle direction in disc-local frame */
	axleDir: THREE.Vector3;
}

interface WheelPivotData {
	pivot: THREE.Group;
	/** For cleanup: restore each mesh to its original parent + position */
	originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D; originalPos: THREE.Vector3 }[];
	brakeDiscs: BrakeDiscData[];
	baseY: number;
}

export class WheelAnimator {
	private model: THREE.Group | null = null;
	private state: WheelAnimatorState = {
		spinning: false,
		spinSpeed: 15,
		suspOffset: 0,
		spinAngles: [0, 0, 0, 0],
	};
	private pivots: (WheelPivotData | null)[] = [null, null, null, null];
	private lastTime = 0;
	private onFrame: (() => void) | null = null;

	/** Bind to the editor's render loop callback. */
	getFrameCallback(): (() => void) | null {
		return this.onFrame;
	}

	/** Initialize with the current model. Call after model load + marker placement. */
	init(model: THREE.Group): void {
		console.log("[WheelAnimator v4] init called");
		this.cleanup();
		this.model = model;
		this.scanWheels();
	}

	/** Remove all pivot groups and reparent meshes back to their original parents. */
	private cleanup(): void {
		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;
			for (const { mesh, parent, originalPos } of pd.originalParents) {
				pd.pivot.remove(mesh);
				parent.add(mesh);
				mesh.position.copy(originalPos);
			}
			pd.pivot.parent?.remove(pd.pivot);
			this.pivots[i] = null;
		}
		this.onFrame = null;
	}

	/**
	 * Scan the model for marked wheel meshes and brake discs.
	 * Creates pivot groups at wheel centers and offsets mesh positions so
	 * geometry centers align with pivot origins — no geometry mutation.
	 */
	private scanWheels(): void {
		if (!this.model) return;

		let totalMarked = 0;
		this.model.traverse((child) => {
			if (child.userData.markedAs) {
				totalMarked++;
				console.log(`[WheelAnimator] Found: ${child.name} -> ${child.userData.markedAs}`);
			}
		});
		console.log(`[WheelAnimator] Total marked: ${totalMarked}`);

		let wheelCount = 0;

		for (let i = 0; i < 4; i++) {
			const meshes: THREE.Mesh[] = [];
			const discs: BrakeDiscData[] = [];

			this.model.traverse((child) => {
				if (!(child as THREE.Mesh).isMesh) return;
				const marked = child.userData.markedAs;
				if (marked === WHEEL_TYPES[i]) {
					meshes.push(child as THREE.Mesh);
				} else if (marked === BRAKE_TYPES[i]) {
					const worldQuat = new THREE.Quaternion();
					child.getWorldQuaternion(worldQuat);
					const axleDir = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat.clone().invert());
					discs.push({
						mesh: child as THREE.Mesh,
						baseQuat: child.quaternion.clone(),
						axleDir,
					});
				}
			});

			if (meshes.length === 0) continue;
			wheelCount += meshes.length;

			// Compute wheel center from actual geometry bounding boxes.
			// Box3.setFromObject accounts for the full transform chain (model scale, position, etc.)
			// so this gives us the true world-space center of each mesh's vertices.
			const center = new THREE.Vector3();
			const allMeshes = [...meshes, ...discs.map((d) => d.mesh)];
			for (const m of allMeshes) {
				const box = new THREE.Box3().setFromObject(m);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				center.add(bc);
			}
			center.divideScalar(allMeshes.length);

			// Convert wheel center to model-local space (the pivot will be a child of model)
			this.model.updateMatrixWorld(true);
			const localCenter = this.model.worldToLocal(center.clone());

			// Log wheel bbox dimensions
			const wheelBox = new THREE.Box3();
			for (const m of meshes) wheelBox.union(new THREE.Box3().setFromObject(m));
			const wheelSize = new THREE.Vector3();
			wheelBox.getSize(wheelSize);

			// Detect axle axis: shortest dimension of wheel bbox
			let axleAxisName = "X";
			if (wheelSize.y < wheelSize.x && wheelSize.y < wheelSize.z) axleAxisName = "Y";
			else if (wheelSize.z < wheelSize.x && wheelSize.z < wheelSize.y) axleAxisName = "Z";

			console.log(
				`[WheelAnimator] Wheel ${i}: center_world=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}) ` +
					`local=(${localCenter.x.toFixed(3)}, ${localCenter.y.toFixed(3)}, ${localCenter.z.toFixed(3)}) ` +
					`bbox=(${wheelSize.x.toFixed(3)}, ${wheelSize.y.toFixed(3)}, ${wheelSize.z.toFixed(3)}) axle=${axleAxisName}`,
			);

			// Create pivot group at wheel center (model-local space)
			const pivot = new THREE.Group();
			pivot.name = `editor_wheel_pivot_${i}`;
			pivot.position.copy(localCenter);
			this.model.add(pivot);

			// Reparent meshes under pivot, adjusting position so geometry stays in place.
			// Key insight: mesh.position is [0,0,0] but vertices are at some offset.
			// After reparenting, mesh.position must be set so that:
			//   pivot.worldPosition + model.scale * mesh.position = original worldPosition
			// Since geometry is at (meshWorldPos + vertexOffset), and pivot is at (meshWorldPos),
			// we need mesh.position such that the vertex center lands at pivot origin.
			//   model.position + model.scale * (pivot.position + mesh.position) + vertexOffset = original
			//   pivot.position + mesh.position = 0  (in model-local space)
			//   mesh.position = -pivot.position... NO, that's wrong for multiple meshes at different positions.
			//
			// Actually: each mesh's vertices render at meshWorldPos (which is model.position since mesh.position=0).
			// After reparenting under pivot at localCenter:
			//   new meshWorldPos = model.position + model.scale * (localCenter + mesh.position)
			// We want this to equal the original model.position (so vertices don't move):
			//   model.position + scale * (localCenter + mesh.position) = model.position
			//   localCenter + mesh.position = 0
			//   mesh.position = -localCenter
			// But this only works if ALL meshes for this wheel had the same bbox center (localCenter).
			// For different meshes (tire + rim at slightly different positions), we compute per-mesh offset.

			const originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D; originalPos: THREE.Vector3 }[] = [];

			const reparentMesh = (mesh: THREE.Mesh) => {
				const parent = mesh.parent!;
				const originalPos = mesh.position.clone();

				// Get this specific mesh's bbox center in model-local space
				const box = new THREE.Box3().setFromObject(mesh);
				const meshWorldCenter = new THREE.Vector3();
				box.getCenter(meshWorldCenter);
				const meshLocalCenter = this.model!.worldToLocal(meshWorldCenter.clone());

				// After reparenting under pivot, we need:
				//   model.scale * (localCenter + mesh.position) = meshLocalCenter
				//   mesh.position = meshLocalCenter/scale - localCenter
				// But since scale is uniform and already baked into Box3 via setFromObject...
				// Actually Box3.setFromObject gives world-space coords that include scale.
				// worldToLocal reverses scale. So meshLocalCenter is already in unscaled model space.
				// The pivot is also in unscaled model space.
				// The mesh position under pivot is also in unscaled model space.
				// When rendering: worldPos = model.position + model.scale * (pivot.position + mesh.position)
				// We want: model.position + model.scale * (pivot.position + mesh.position) = model.position + model.scale * meshLocalCenter
				// So: pivot.position + mesh.position = meshLocalCenter
				// mesh.position = meshLocalCenter - pivot.position = meshLocalCenter - localCenter
				mesh.position.copy(meshLocalCenter).sub(localCenter);

				originalParents.push({ mesh, parent, originalPos });
				parent.remove(mesh);
				pivot.add(mesh);
			};

			for (const m of meshes) reparentMesh(m);
			for (const d of discs) {
				reparentMesh(d.mesh);
				d.baseQuat = d.mesh.quaternion.clone();
				const wq = new THREE.Quaternion();
				d.mesh.getWorldQuaternion(wq);
				d.axleDir = new THREE.Vector3(1, 0, 0).applyQuaternion(wq.clone().invert());
			}

			this.pivots[i] = {
				pivot,
				originalParents,
				brakeDiscs: discs,
				baseY: localCenter.y,
			};

			console.log(`[WheelAnimator] Wheel ${i}: ${meshes.length} meshes, ${discs.length} discs, pivot set up`);
		}

		console.log(`[WheelAnimator] scanWheels done: ${wheelCount} wheel meshes total`);
		if (wheelCount > 0) {
			this.onFrame = () => this.tick(performance.now() / 1000);
			console.log("[WheelAnimator] Frame callback registered");
		} else {
			console.warn("[WheelAnimator] No wheel meshes found");
		}
	}

	/** Toggle wheel spinning on/off. */
	setSpinning(on: boolean): void {
		console.log(`[WheelAnimator] setSpinning(${on})`);
		this.state.spinning = on;
		if (on) {
			this.lastTime = performance.now() / 1000;
		}
	}

	/** Set spin speed in rad/s. */
	setSpinSpeed(radsPerSec: number): void {
		this.state.spinSpeed = radsPerSec;
	}

	/** Set suspension offset (meters). Negative = compress, positive = extend. */
	setSuspensionOffset(offset: number): void {
		this.state.suspOffset = offset;

		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;
			pd.pivot.position.y = pd.baseY + offset;
		}
	}

	/** Get current suspension offset. */
	getSuspensionOffset(): number {
		return this.state.suspOffset;
	}

	/** Get current spin speed. */
	getSpinSpeed(): number {
		return this.state.spinSpeed;
	}

	/** Is spinning active? */
	isSpinning(): boolean {
		return this.state.spinning;
	}

	/**
	 * Per-frame update — rotates pivot around X axis (axle direction for most car models).
	 * Counter-rotates brake discs so they stay visually fixed.
	 */
	private tick(now: number): void {
		if (!this.state.spinning) return;

		const dt = Math.min(now - this.lastTime, 0.05);
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;

			this.state.spinAngles[i] += this.state.spinSpeed * dt;

			// Rotate pivot around X axis (standard axle direction for car models)
			// Same as VehicleRenderer: Euler(spinX, steerY, 0, "YXZ")
			const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.state.spinAngles[i]);
			pd.pivot.quaternion.copy(spinQuat);

			// Counter-rotate brake discs so they stay visually fixed
			for (const disc of pd.brakeDiscs) {
				disc.mesh.quaternion.copy(disc.baseQuat);
				disc.mesh.quaternion.premultiply(
					new THREE.Quaternion().setFromAxisAngle(disc.axleDir, -this.state.spinAngles[i]),
				);
			}
		}
	}
}
