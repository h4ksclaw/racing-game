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
		console.log("[WheelAnimator v5] init called");
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

	private scanWheels(): void {
		if (!this.model) return;

		// ── Log model transform state ──
		console.log(`[WA] model.name="${this.model.name}"`);
		console.log(`[WA] model.position=(${f(this.model.position)})`);
		console.log(`[WA] model.scale=(${f(this.model.scale)})`);
		console.log(`[WA] model.rotation=(${f(this.model.rotation)})`);

		// ── Collect all marked objects ──
		const allMarked: string[] = [];
		this.model.traverse((child) => {
			if (child.userData.markedAs) {
				allMarked.push(`${child.name} -> ${child.userData.markedAs}`);
			}
		});
		console.log(`[WA] All marked objects (${allMarked.length}):`, allMarked);

		let wheelCount = 0;

		for (let i = 0; i < 4; i++) {
			const label = WHEEL_TYPES[i];
			const meshes: THREE.Mesh[] = [];
			const discs: BrakeDiscData[] = [];

			this.model.traverse((child) => {
				if (!(child as THREE.Mesh).isMesh) return;
				const marked = child.userData.markedAs;
				if (marked === label) {
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

			if (meshes.length === 0) {
				console.log(`[WA] Wheel ${i} (${label}): NO meshes found`);
				continue;
			}
			wheelCount += meshes.length;

			console.log(`[WA] ═══ Wheel ${i} (${label}): ${meshes.length} meshes, ${discs.length} discs ═══`);

			// ── Per-mesh analysis ──
			for (const m of meshes) {
				console.log(`[WA]   mesh: "${m.name}"`);
				console.log(`[WA]     parent: "${m.parent?.name}" position=(${f(m.position)}) scale=(${f(m.scale)})`);
				const box = new THREE.Box3().setFromObject(m);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				const sz = new THREE.Vector3();
				box.getSize(sz);
				console.log(`[WA]     bbox WORLD center=(${f(bc)}) size=(${f(sz)})`);
			}
			for (const d of discs) {
				console.log(`[WA]   disc: "${d.mesh.name}"`);
				console.log(`[WA]     parent: "${d.mesh.parent?.name}" position=(${f(d.mesh.position)})`);
				const box = new THREE.Box3().setFromObject(d.mesh);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				console.log(`[WA]     bbox WORLD center=(${f(bc)})`);
			}

			// ── Compute wheel center (average bbox center) ──
			const center = new THREE.Vector3();
			const allMeshes = [...meshes, ...discs.map((d) => d.mesh)];
			for (const m of allMeshes) {
				const box = new THREE.Box3().setFromObject(m);
				const bc = new THREE.Vector3();
				box.getCenter(bc);
				center.add(bc);
			}
			center.divideScalar(allMeshes.length);
			console.log(`[WA]   avg bbox WORLD center=(${f(center)})`);

			// ── Convert to model-local ──
			this.model.updateMatrixWorld(true);
			const localCenter = this.model.worldToLocal(center.clone());
			console.log(`[WA]   avg bbox LOCAL center=(${f(localCenter)})`);

			// ── Create pivot ──
			const pivot = new THREE.Group();
			pivot.name = `editor_wheel_pivot_${i}`;
			pivot.position.copy(localCenter);
			this.model.add(pivot);
			console.log(`[WA]   pivot at LOCAL=(${f(localCenter)})`);

			// ── Reparent with position offset ──
			const originalParents: { mesh: THREE.Object3D; parent: THREE.Object3D; originalPos: THREE.Vector3 }[] = [];

			const reparentMesh = (mesh: THREE.Mesh) => {
				const parent = mesh.parent!;
				const originalPos = mesh.position.clone();

				// This mesh's bbox center in world space
				const box = new THREE.Box3().setFromObject(mesh);
				const meshWorldCenter = new THREE.Vector3();
				box.getCenter(meshWorldCenter);

				// Convert to model-local
				const meshLocalCenter = this.model!.worldToLocal(meshWorldCenter.clone());

				// Position offset: mesh.position under pivot = meshLocalCenter - pivotLocalCenter
				// So that: pivot.position + mesh.position = meshLocalCenter (in model-local space)
				// Rendering: worldPos = model.position + model.scale * (pivot.position + mesh.position)
				const offset = meshLocalCenter.clone().sub(localCenter);
				mesh.position.copy(offset);

				console.log(`[WA]     reparent "${mesh.name}": localCenter=(${f(meshLocalCenter)}) offset=(${f(offset)})`);

				// Verify: compute where this mesh's center will render in world space
				const verifyWorld = new THREE.Vector3();
				pivot.getWorldPosition(verifyWorld);
				verifyWorld.add(offset.clone().multiplyScalar(this.model!.scale.x));
				console.log(
					`[WA]     verify world center after reparent=(${f(verifyWorld)}) (should be ≈ ${f(meshWorldCenter)})`,
				);

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

			console.log(`[WA]   ✓ Wheel ${i} set up`);
		}

		console.log(`[WA] scanWheels done: ${wheelCount} wheel meshes total`);
		if (wheelCount > 0) {
			this.onFrame = () => this.tick(performance.now() / 1000);
			console.log("[WA] Frame callback registered");
		} else {
			console.warn("[WA] No wheel meshes found!");
		}
	}

	/** Toggle wheel spinning on/off. */
	setSpinning(on: boolean): void {
		console.log(`[WA] setSpinning(${on})`);
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

	private tick(now: number): void {
		if (!this.state.spinning) return;

		const dt = Math.min(now - this.lastTime, 0.05);
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const pd = this.pivots[i];
			if (!pd) continue;

			this.state.spinAngles[i] += this.state.spinSpeed * dt;

			const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.state.spinAngles[i]);
			pd.pivot.quaternion.copy(spinQuat);

			for (const disc of pd.brakeDiscs) {
				disc.mesh.quaternion.copy(disc.baseQuat);
				disc.mesh.quaternion.premultiply(
					new THREE.Quaternion().setFromAxisAngle(disc.axleDir, -this.state.spinAngles[i]),
				);
			}
		}
	}
}

/** Format a Vector3 for logging */
function f(v: THREE.Vector3 | THREE.Euler): string {
	return `${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}`;
}
