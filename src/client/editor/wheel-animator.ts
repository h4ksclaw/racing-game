/**
 * WheelAnimator — drives wheel spin + suspension offset in the editor.
 *
 * Simple approach: no pivots, no reparenting, no geometry mutation.
 * Each frame, directly set mesh quaternion to rotate around the detected axle axis.
 * Suspension moves mesh.position.y by the offset amount.
 */
import * as THREE from "three";

export interface WheelAnimatorState {
	spinning: boolean;
	spinSpeed: number;
	suspOffset: number;
	spinAngles: number[];
}

const WHEEL_TYPES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
const BRAKE_TYPES = ["brake_disc_FL", "brake_disc_FR", "brake_disc_RL", "brake_disc_RR"];

interface WheelMeshData {
	mesh: THREE.Mesh;
	/** Bbox center in model-local space (used as rotation center) */
	center: THREE.Vector3;
	/** Original position before animation */
	originalPos: THREE.Vector3;
	/** Axle axis direction in model-local space (unit vector) */
	axleAxis: THREE.Vector3;
}

interface WheelGroupData {
	wheels: WheelMeshData[];
	discs: WheelMeshData[];
	axleAxis: THREE.Vector3;
	/** Average center of all meshes in this wheel group */
	center: THREE.Vector3;
}

export class WheelAnimator {
	private model: THREE.Group | null = null;
	private state: WheelAnimatorState = {
		spinning: false,
		spinSpeed: 15,
		suspOffset: 0,
		spinAngles: [0, 0, 0, 0],
	};
	private groups: (WheelGroupData | null)[] = [null, null, null, null];
	private lastTime = 0;
	private onFrame: (() => void) | null = null;

	getFrameCallback(): (() => void) | null {
		return this.onFrame;
	}

	init(model: THREE.Group): void {
		console.log("[WheelAnimator v6] init called");
		this.stop();
		this.model = model;
		this.scanWheels();
	}

	/** Stop animation and restore all mesh transforms. */
	private stop(): void {
		for (let i = 0; i < 4; i++) {
			const g = this.groups[i];
			if (!g) continue;
			for (const d of [...g.wheels, ...g.discs]) {
				d.mesh.position.copy(d.originalPos);
				d.mesh.quaternion.identity();
			}
			this.groups[i] = null;
		}
		this.onFrame = null;
	}

	private scanWheels(): void {
		if (!this.model) return;

		console.log(`[WA] model="${this.model.name}" pos=(${f(this.model.position)}) scale=(${f(this.model.scale)})`);

		this.model.updateMatrixWorld(true);
		let wheelCount = 0;

		for (let i = 0; i < 4; i++) {
			const label = WHEEL_TYPES[i];
			const wheelMeshes: THREE.Mesh[] = [];
			const discMeshes: THREE.Mesh[] = [];

			this.model.traverse((child) => {
				if (!(child as THREE.Mesh).isMesh) return;
				const marked = child.userData.markedAs;
				if (marked === label) wheelMeshes.push(child as THREE.Mesh);
				else if (marked === BRAKE_TYPES[i]) discMeshes.push(child as THREE.Mesh);
			});

			if (wheelMeshes.length === 0) continue;
			wheelCount += wheelMeshes.length;

			// Compute combined bbox for all wheel meshes (tire + rim) to find axle direction
			const wheelBox = new THREE.Box3();
			for (const m of wheelMeshes) wheelBox.union(new THREE.Box3().setFromObject(m));
			const wheelSize = new THREE.Vector3();
			wheelBox.getSize(wheelSize);

			// Axle = shortest dimension
			const axleAxis = new THREE.Vector3(1, 0, 0);
			if (wheelSize.y < wheelSize.x && wheelSize.y < wheelSize.z) axleAxis.set(0, 1, 0);
			else if (wheelSize.z < wheelSize.x && wheelSize.z < wheelSize.y) axleAxis.set(0, 0, 1);

			console.log(
				`[WA] Wheel ${i} (${label}): ${wheelMeshes.length} wheels, ${discMeshes.length} discs, size=(${f(wheelSize)}), axle=(${f(axleAxis)})`,
			);

			// Build mesh data with bbox centers
			const wheels: WheelMeshData[] = [];
			for (const m of wheelMeshes) {
				const box = new THREE.Box3().setFromObject(m);
				const worldCenter = new THREE.Vector3();
				box.getCenter(worldCenter);
				const localCenter = this.model!.worldToLocal(worldCenter.clone());
				wheels.push({
					mesh: m,
					center: localCenter,
					originalPos: m.position.clone(),
					axleAxis,
				});
				console.log(`[WA]   ${m.name}: worldCenter=(${f(worldCenter)}) localCenter=(${f(localCenter)})`);
			}

			const discs: WheelMeshData[] = [];
			for (const m of discMeshes) {
				const box = new THREE.Box3().setFromObject(m);
				const worldCenter = new THREE.Vector3();
				box.getCenter(worldCenter);
				const localCenter = this.model!.worldToLocal(worldCenter.clone());
				discs.push({
					mesh: m,
					center: localCenter,
					originalPos: m.position.clone(),
					axleAxis,
				});
				console.log(`[WA]   ${m.name}: worldCenter=(${f(worldCenter)}) localCenter=(${f(localCenter)})`);
			}

			// Group center = average of all mesh centers
			const allCenters = [...wheels, ...discs].map((d) => d.center);
			const groupCenter = new THREE.Vector3();
			for (const c of allCenters) groupCenter.add(c);
			groupCenter.divideScalar(allCenters.length);

			console.log(`[WA]   groupCenter=(${f(groupCenter)})`);

			this.groups[i] = { wheels, discs, axleAxis, center: groupCenter };
		}

		console.log(`[WA] scanWheels done: ${wheelCount} wheel meshes`);
		if (wheelCount > 0) {
			this.onFrame = () => this.tick(performance.now() / 1000);
		}
	}

	setSpinning(on: boolean): void {
		console.log(`[WA] setSpinning(${on})`);
		this.state.spinning = on;
		if (on) this.lastTime = performance.now() / 1000;
	}

	setSpinSpeed(radsPerSec: number): void {
		this.state.spinSpeed = radsPerSec;
	}

	setSuspensionOffset(offset: number): void {
		this.state.suspOffset = offset;
		// Move wheel meshes vertically
		for (let i = 0; i < 4; i++) {
			const g = this.groups[i];
			if (!g) continue;
			for (const d of [...g.wheels, ...g.discs]) {
				d.mesh.position.y = d.originalPos.y + offset;
			}
		}
	}

	getSuspensionOffset(): number {
		return this.state.suspOffset;
	}
	getSpinSpeed(): number {
		return this.state.spinSpeed;
	}
	isSpinning(): boolean {
		return this.state.spinning;
	}

	private tick(now: number): void {
		if (!this.state.spinning || !this.model) return;

		const dt = Math.min(now - this.lastTime, 0.05);
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const g = this.groups[i];
			if (!g) continue;

			this.state.spinAngles[i] += this.state.spinSpeed * dt;
			const angle = this.state.spinAngles[i];

			// For each wheel mesh, rotate it around the wheel group's center
			// by setting its quaternion directly — no reparenting needed.
			for (const d of g.wheels) {
				// Build a rotation that spins the mesh around the axle axis
				// passing through the wheel center.
				// Since the mesh is at position [0,0,0] with baked vertices,
				// we need to: translate to center, rotate, translate back.
				// But we can't modify geometry — so use a TRS matrix approach:
				// M = T(center) * R(axle, angle) * T(-center)
				// Applied to mesh.matrix, but mesh.matrix is composed from
				// mesh.position, mesh.quaternion, mesh.scale.
				//
				// Simpler: just rotate the quaternion. The mesh vertices are
				// baked at their world positions. Rotation around the axle axis
				// at origin (0,0,0) would spin them around the model origin,
				// NOT around the wheel center.
				//
				// We need to spin around the wheel center. The cleanest way
				// without pivots: temporarily offset position, rotate, restore.
				//
				// Actually — the mesh position is [0,0,0] and vertices are baked.
				// To rotate vertices around point C:
				//   1. Translate all vertices by -C (so C is at origin)
				//   2. Rotate
				//   3. Translate back by +C
				// This is equivalent to: mesh.position = C - R * C (after rotation)
				// where R is the rotation matrix.

				const C = d.center;
				const R = new THREE.Quaternion().setFromAxisAngle(g.axleAxis, angle);

				// rotated_center = R * C
				const rotCenter = C.clone().applyQuaternion(R);
				// mesh.position = C - rotCenter (so vertices end up in right place)
				const posOffset = C.clone().sub(rotCenter);
				d.mesh.position.copy(d.originalPos).add(posOffset);
				if (this.state.suspOffset !== 0) {
					d.mesh.position.y += this.state.suspOffset;
				}
				d.mesh.quaternion.copy(R);
			}

			// Brake discs and calipers: counter-rotate (stay fixed)
			for (const d of g.discs) {
				d.mesh.quaternion.identity();
				d.mesh.position.copy(d.originalPos);
				if (this.state.suspOffset !== 0) {
					d.mesh.position.y += this.state.suspOffset;
				}
			}
		}
	}
}

function f(v: THREE.Vector3 | THREE.Euler): string {
	return `${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}`;
}
