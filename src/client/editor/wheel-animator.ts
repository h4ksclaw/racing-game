/**
 * WheelAnimator — drives wheel spin + suspension offset in the editor,
 * reusing the same math as VehicleRenderer.sync() for visual accuracy.
 */
import * as THREE from "three";

export interface WheelAnimatorState {
	spinning: boolean;
	/** rad/s — angular velocity of all wheels */
	spinSpeed: number;
	/** Suspension Y offset in meters (negative = compress, positive = extend) */
	suspOffset: number;
	/** Per-wheel base Y positions (set when animation starts) */
	privateBaseY: number[];
	/** Per-wheel spin angles */
	spinAngles: number[];
}

export class WheelAnimator {
	private model: THREE.Group | null = null;
	private state: WheelAnimatorState = {
		spinning: false,
		spinSpeed: 15, // ~143 RPM
		suspOffset: 0,
		privateBaseY: [0, 0, 0, 0],
		spinAngles: [0, 0, 0, 0],
	};
	/** Per-wheel associated meshes (tire + rim) for spin */
	private wheelMeshes: THREE.Object3D[][] = [[], [], [], []];
	/** Per-wheel brake disc meshes (counter-rotate against spin) */
	private brakeDiscs: { mesh: THREE.Mesh; baseQuat: THREE.Quaternion; axleDir: THREE.Vector3 }[][] = [[], [], [], []];
	private running = false;
	private lastTime = 0;
	private onFrame: (() => void) | null = null;

	/** Bind to the editor's render loop callback. Call in animate(). */
	getFrameCallback(): (() => void) | null {
		return this.onFrame;
	}

	/** Initialize with the current model. Call after model load + marker placement. */
	init(model: THREE.Group): void {
		this.model = model;
		this.reset();
		this.scanWheels();
	}

	private reset(): void {
		this.state.spinAngles = [0, 0, 0, 0];
		this.state.suspOffset = 0;
		this.state.privateBaseY = [0, 0, 0, 0];
		this.wheelMeshes = [[], [], [], []];
		this.brakeDiscs = [[], [], [], []];
		this.running = false;
		this.onFrame = null;
	}

	/** Scan the model for marked wheel meshes and brake discs. */
	private scanWheels(): void {
		if (!this.model) return;

		const wheelTypes = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
		const brakeTypes = ["brake_disc_FL", "brake_disc_FR", "brake_disc_RL", "brake_disc_RR"];

		for (let i = 0; i < 4; i++) {
			const meshes: THREE.Object3D[] = [];
			const discs: { mesh: THREE.Mesh; baseQuat: THREE.Quaternion; axleDir: THREE.Vector3 }[] = [];
			let hasAny = false;

			this.model.traverse((child) => {
				if (!(child as THREE.Mesh).isMesh) return;
				const marked = child.userData.markedAs;
				if (marked === wheelTypes[i]) {
					meshes.push(child);
					hasAny = true;
				} else if (marked === brakeTypes[i]) {
					// Compute axle direction in disc-local frame (X axis = axle for most car models)
					const axleDir = new THREE.Vector3(1, 0, 0).applyQuaternion(
						child.getWorldQuaternion(new THREE.Quaternion()).invert(),
					);
					discs.push({
						mesh: child as THREE.Mesh,
						baseQuat: child.quaternion.clone(),
						axleDir,
					});
					hasAny = true;
				}
			});

			if (hasAny) {
				// Use the bounding box center of all meshes for this wheel as the pivot
				// In practice, the marker position IS the pivot
				this.wheelMeshes[i] = meshes;
				this.brakeDiscs[i] = discs;

				// Record base Y from the first mesh (all meshes for same wheel share Y roughly)
				const baseY = meshes.length > 0 ? meshes[0].position.y : 0;
				this.state.privateBaseY[i] = baseY;
			}
		}

		// If we found wheels, enable the frame callback
		if (this.wheelMeshes.some((m) => m.length > 0)) {
			this.onFrame = () => this.tick(performance.now() / 1000);
		}
	}

	/** Toggle wheel spinning on/off. */
	setSpinning(on: boolean): void {
		this.state.spinning = on;
		if (on && !this.running) {
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

		// Immediately apply Y offset to all wheel meshes
		for (let i = 0; i < 4; i++) {
			for (const mesh of this.wheelMeshes[i]) {
				mesh.position.y += delta;
			}
			for (const disc of this.brakeDiscs[i]) {
				disc.mesh.position.y += delta;
			}
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

	/** Per-frame update. Called from the editor render loop via getFrameCallback(). */
	private tick(now: number): void {
		if (!this.state.spinning) return;

		const dt = Math.min(now - this.lastTime, 0.05); // cap at 50ms
		this.lastTime = now;

		for (let i = 0; i < 4; i++) {
			const angle = this.state.spinSpeed * dt;
			this.state.spinAngles[i] += angle;

			// Spin wheel meshes around local X axis (axle)
			for (const mesh of this.wheelMeshes[i]) {
				const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
				mesh.quaternion.premultiply(quat);
			}

			// Counter-rotate brake discs so they stay fixed
			for (const disc of this.brakeDiscs[i]) {
				const counterQuat = new THREE.Quaternion().setFromAxisAngle(disc.axleDir, -angle);
				disc.mesh.quaternion.premultiply(counterQuat);
			}
		}
	}
}
