/**
 * WheelAnimator — drives wheel spin + suspension offset in the editor,
 * reusing the same pivot-based math as VehicleRenderer.sync() for visual accuracy.
 *
 * Key difference from naive approach: we create temporary pivot groups at each wheel
 * position (matching VehicleRenderer's architecture) and rotate those pivots instead of
 * individual meshes. This ensures wheels spin around their axle axis correctly.
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
	axleDir: THREE.Vector3;
}

interface WheelPivotData {
	pivot: THREE.Group;
	/** Original parents of the meshes (for reparenting on cleanup) */
	originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D }[];
	brakeDiscs: BrakeDiscData[];
	baseY: number;
}

export class WheelAnimator {
	private model: THREE.Group | null = null;
	private scene: THREE.Scene | null = null;
	private state: WheelAnimatorState = {
		spinning: false,
		spinSpeed: 15,
		suspOffset: 0,
		spinAngles: [0, 0, 0, 0],
	};
	/** Per-wheel pivot groups with their child meshes */
	private pivots: (WheelPivotData | null)[] = [null, null, null, null];
	private lastTime = 0;
	private onFrame: (() => void) | null = null;

	/** Bind to the editor's render loop callback. */
	getFrameCallback(): (() => void) | null {
		return this.onFrame;
	}

	/** Initialize with the current model + scene. Call after model load + marker placement. */
	init(model: THREE.Group, scene: THREE.Scene): void {
		console.log("[WheelAnimator] init called");
		this.cleanup();
		this.model = model;
		this.scene = scene;
		this.scanWheels();
	}

	/** Remove all pivot groups and reparent meshes back to their original parents. */
	private cleanup(): void {
		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;
			// Reparent meshes back
			for (const { mesh, parent } of pd.originalParents) {
				// Restore mesh's local transform relative to original parent
				pd.pivot.updateMatrixWorld(true);
				const worldPos = new THREE.Vector3();
				const worldQuat = new THREE.Quaternion();
				const worldScale = new THREE.Vector3();
				mesh.getWorldPosition(worldPos);
				mesh.getWorldQuaternion(worldQuat);
				mesh.getWorldScale(worldScale);
				pd.pivot.remove(mesh);
				parent.add(mesh);
				parent.worldToLocal(worldPos);
				// We can't perfectly restore the original local transform since the pivot
				// was at a different position, but position is the critical part for editor use
				mesh.position.copy(worldPos);
			}
			// Remove pivot from scene
			pd.pivot.parent?.remove(pd.pivot);
			this.pivots[i] = null;
		}
		this.onFrame = null;
	}

	/**
	 * Scan the model for marked wheel meshes and brake discs.
	 * Creates pivot groups at each wheel position and reparents meshes under them.
	 */
	private scanWheels(): void {
		if (!this.model || !this.scene) return;

		let totalMarked = 0;
		this.model.traverse((child) => {
			if (child.userData.markedAs) {
				totalMarked++;
				console.log(`[WheelAnimator] Found marked object: ${child.name} -> ${child.userData.markedAs}`);
			}
		});
		console.log(`[WheelAnimator] Total marked objects in model: ${totalMarked}`);

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
					// Compute axle direction in disc-local frame
					// Use world X axis projected into disc's local space
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

			// Compute wheel center (average position of all meshes for this wheel)
			const center = new THREE.Vector3();
			for (const m of meshes) {
				const wp = new THREE.Vector3();
				m.getWorldPosition(wp);
				center.add(wp);
			}
			center.divideScalar(meshes.length);

			// Convert to model-local space
			const localCenter = this.model.worldToLocal(center.clone());

			// Create pivot group at wheel center (added to scene, not model, so it
			// inherits the scene transform but not the model's transform)
			const pivot = new THREE.Group();
			pivot.name = `editor_wheel_pivot_${i}`;
			pivot.position.copy(localCenter);
			this.model.add(pivot);

			// Reparent wheel meshes under pivot
			const originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D }[] = [];
			for (const mesh of meshes) {
				const parent = mesh.parent!;
				originalParents.push({ mesh, parent });

				// Compute mesh's local position relative to pivot
				const meshWorldPos = new THREE.Vector3();
				mesh.getWorldPosition(meshWorldPos);
				const localPos = pivot.worldToLocal(meshWorldPos.clone());

				parent.remove(mesh);
				pivot.add(mesh);
				mesh.position.copy(localPos);
			}

			// Also reparent brake discs under the same pivot
			for (const disc of discs) {
				const parent = disc.mesh.parent!;
				originalParents.push({ mesh: disc.mesh, parent });

				const meshWorldPos = new THREE.Vector3();
				disc.mesh.getWorldPosition(meshWorldPos);
				const localPos = pivot.worldToLocal(meshWorldPos.clone());

				parent.remove(disc.mesh);
				pivot.add(disc.mesh);
				disc.mesh.position.copy(localPos);

				// Recompute baseQuat relative to pivot
				disc.baseQuat = disc.mesh.quaternion.clone();
			}

			this.pivots[i] = {
				pivot,
				originalParents,
				brakeDiscs: discs,
				baseY: localCenter.y,
			};

			console.log(
				`[WheelAnimator] Wheel ${i}: ${meshes.length} meshes, ${discs.length} discs, center=(${localCenter.x.toFixed(3)}, ${localCenter.y.toFixed(3)}, ${localCenter.z.toFixed(3)})`,
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

		// Apply Y offset to all pivots (same as VehicleRenderer: pivot.position.y = basePos.y + suspOffset)
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

	/** Per-frame update — same math as VehicleRenderer.sync() wheel section. */
	private tick(now: number): void {
		if (!this.state.spinning) return;

		const dt = Math.min(now - this.lastTime, 0.05);
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;

			this.state.spinAngles[i] += this.state.spinSpeed * dt;

			// Same as VehicleRenderer: pivot.quaternion.setFromEuler(spinX, steerY, 0, "YXZ")
			// No steering in editor, just spin around X (axle axis)
			pd.pivot.quaternion.setFromEuler(new THREE.Euler(this.state.spinAngles[i], 0, 0, "YXZ"));

			// Counter-rotate brake discs so they stay visually fixed
			// Same as VehicleRenderer: disc.quaternion.copy(baseQuat).premultiply(counter-rot)
			for (const disc of pd.brakeDiscs) {
				disc.mesh.quaternion.copy(disc.baseQuat);
				disc.mesh.quaternion.premultiply(
					new THREE.Quaternion().setFromAxisAngle(disc.axleDir, -this.state.spinAngles[i]),
				);
			}
		}
	}
}
