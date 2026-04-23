/**
 * WheelAnimator — drives wheel spin + suspension offset in the editor,
 * reusing the same pivot-based math as VehicleRenderer.sync() for visual accuracy.
 *
 * Handles GLB models where meshes have baked geometry (position [0,0,0] but vertices
 * at world positions) by centering geometry before reparenting under pivot groups.
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
	/** Original parents of meshes (for cleanup/reparenting) */
	originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D; geoTranslate: THREE.Vector3 }[];
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
		console.log("[WheelAnimator v3] init called");
		this.cleanup();
		this.model = model;
		this.scanWheels();
	}

	/** Remove all pivot groups and reparent meshes back to their original parents. */
	private cleanup(): void {
		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;
			for (const { mesh, parent, geoTranslate } of pd.originalParents) {
				// Reverse the geometry translation
				const g = (mesh as THREE.Mesh).geometry;
				g.translate(-geoTranslate.x, -geoTranslate.y, -geoTranslate.z);

				// Remove from pivot, add back to original parent
				pd.pivot.remove(mesh);
				parent.add(mesh);
				// Position was set to [0,0,0] during init, restore it
				mesh.position.set(0, 0, 0);
			}
			pd.pivot.parent?.remove(pd.pivot);
			this.pivots[i] = null;
		}
		this.onFrame = null;
	}

	/**
	 * Scan the model for marked wheel meshes and brake discs.
	 * Creates pivot groups and reparents meshes with centered geometry.
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

			// Compute wheel center from actual geometry bounding boxes
			// (handles models where meshes have position [0,0,0] but vertices baked at world positions)
			const center = new THREE.Vector3();
			const allMeshes = [...meshes, ...discs.map((d) => d.mesh)];
			for (const m of allMeshes) {
				const box = new THREE.Box3().setFromObject(m);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				center.add(bc);
			}
			center.divideScalar(allMeshes.length);

			// Convert to model-local space
			const localCenter = this.model.worldToLocal(center.clone());

			// Detect axle direction from wheel bounding box (shortest dimension = axle axis)
			const wheelBox = new THREE.Box3();
			for (const m of meshes) wheelBox.union(new THREE.Box3().setFromObject(m));
			const wheelSize = new THREE.Vector3();
			wheelBox.getSize(wheelSize);
			console.log(
				`[WheelAnimator] Wheel ${i} bbox size: (${wheelSize.x.toFixed(3)}, ${wheelSize.y.toFixed(3)}, ${wheelSize.z.toFixed(3)})`,
			);

			// The axle is the shortest dimension — find which axis
			const axleAxis = new THREE.Vector3(1, 0, 0); // default X
			if (wheelSize.y < wheelSize.x && wheelSize.y < wheelSize.z) axleAxis.set(0, 1, 0);
			else if (wheelSize.z < wheelSize.x && wheelSize.z < wheelSize.y) axleAxis.set(0, 0, 1);
			console.log(`[WheelAnimator] Wheel ${i} axle axis: (${axleAxis.x}, ${axleAxis.y}, ${axleAxis.z})`);

			// Create pivot at wheel center
			const pivot = new THREE.Group();
			pivot.name = `editor_wheel_pivot_${i}`;
			pivot.position.copy(localCenter);
			this.model.add(pivot);

			// Reparent meshes: center geometry at origin, set position to offset from pivot
			const originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D; geoTranslate: THREE.Vector3 }[] = [];

			const reparentMesh = (mesh: THREE.Mesh) => {
				const parent = mesh.parent!;

				// Get the mesh's bounding box center in world space
				const box = new THREE.Box3().setFromObject(mesh);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				const localBc = this.model!.worldToLocal(bc.clone());

				// Translate geometry so center is at local origin
				const geoTranslate = localBc.clone();
				(mesh as THREE.Mesh).geometry.translate(geoTranslate.x, geoTranslate.y, geoTranslate.z);

				originalParents.push({ mesh, parent, geoTranslate });

				// Reparent under pivot at [0,0,0] (geometry is now centered)
				parent.remove(mesh);
				pivot.add(mesh);
				mesh.position.set(0, 0, 0);
			};

			for (const m of meshes) reparentMesh(m);
			for (const d of discs) {
				reparentMesh(d.mesh);
				// Recompute baseQuat and axleDir after reparenting
				d.baseQuat = d.mesh.quaternion.clone();
				// Recompute axle direction: project world X into disc's local frame
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

			console.log(
				`[WheelAnimator] Wheel ${i}: ${meshes.length} meshes, ${discs.length} discs, pivot=(${localCenter.x.toFixed(3)}, ${localCenter.y.toFixed(3)}, ${localCenter.z.toFixed(3)})`,
			);
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
		const delta = offset - this.state.suspOffset;
		this.state.suspOffset = offset;
		console.log(`[WheelAnimator] setSuspensionOffset(${offset.toFixed(3)}), delta=${delta.toFixed(3)}`);

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
	 * Per-frame update — same math as VehicleRenderer.sync().
	 * Rotates pivot around detected axle axis using quaternion.
	 */
	private tick(now: number): void {
		if (!this.state.spinning) return;

		const dt = Math.min(now - this.lastTime, 0.05);
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;

			this.state.spinAngles[i] += this.state.spinSpeed * dt;

			// Detect axle axis from the first wheel's bounding box
			// (cached would be better but this runs once per frame, 4 wheels — cheap)
			// Use X axis as default — works for most car models where X = axle
			// VehicleRenderer uses Euler(spinX, steerY, 0, "YXZ") which assumes X = axle
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
