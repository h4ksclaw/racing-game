/**
 * CameraController — chase + orbit camera for vehicle following.
 *
 * Two modes:
 *   - Chase: smooth follow behind the car, auto-syncs orbit params
 *   - Orbit: left-click drag to orbit, scroll to zoom
 *
 * Releasing mouse snaps back to chase. Orbit parameters are continuously
 * synced from chase mode so the transition is seamless.
 */

import * as THREE from "three";

export type CameraMode = "chase" | "orbit";

interface VehiclePosition {
	getPosition(): { x: number; y: number; z: number };
	getForward(): { x: number; y: number; z: number };
}

export class CameraController {
	private mode: CameraMode = "chase";

	private orbitYaw = 0;
	private orbitPitch = 0.3;
	private orbitDist = 10;
	private readonly orbitTarget = new THREE.Vector3();
	private readonly orbitSpherical = new THREE.Spherical();

	private isDragging = false;
	private lastMouseX = 0;
	private lastMouseY = 0;

	// Chase tuning
	private readonly chaseHeight = 4;
	private readonly chaseDist = 8;
	private readonly chaseLookAhead = 5;
	private readonly chaseSmooth = 0.08;

	get cameraMode(): CameraMode {
		return this.mode;
	}

	setChaseMode(): void {
		this.mode = "chase";
	}

	/** Bind mouse/wheel events on the renderer's DOM element. */
	setupInput(renderer: THREE.WebGLRenderer): void {
		const el = renderer.domElement;

		el.addEventListener("mousedown", (e) => {
			if (e.button === 0) {
				this.isDragging = true;
				this.lastMouseX = e.clientX;
				this.lastMouseY = e.clientY;
				this.mode = "orbit";
			}
		});

		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
		});

		window.addEventListener("mouseup", () => {
			this.isDragging = false;
			this.mode = "chase";
		});

		window.addEventListener("mousemove", (e) => {
			if (!this.isDragging) return;
			const dx = e.clientX - this.lastMouseX;
			const dy = e.clientY - this.lastMouseY;
			this.lastMouseX = e.clientX;
			this.lastMouseY = e.clientY;
			this.orbitYaw -= dx * 0.005;
			this.orbitPitch = Math.max(-0.5, Math.min(1.2, this.orbitPitch + dy * 0.005));
		});

		el.addEventListener("wheel", (e) => {
			if (this.mode === "orbit") {
				this.orbitDist = Math.max(3, Math.min(30, this.orbitDist + e.deltaY * 0.01));
			}
		});
	}

	/** Update camera position and orientation for the current frame. */
	update(camera: THREE.Camera, vehicle: VehiclePosition): void {
		const pos = vehicle.getPosition();
		const fwd = vehicle.getForward();
		this.orbitTarget.set(pos.x, pos.y + 1, pos.z);

		if (this.mode === "chase") {
			this.updateChase(camera, pos, fwd);
		} else {
			this.updateOrbit(camera, fwd);
		}
	}

	private carYawRef = 0;

	private updateChase(
		camera: THREE.Camera,
		pos: { x: number; y: number; z: number },
		fwd: { x: number; y: number; z: number },
	): void {
		const targetX = pos.x - fwd.x * this.chaseDist;
		const targetY = pos.y + this.chaseHeight;
		const targetZ = pos.z - fwd.z * this.chaseDist;

		camera.position.x += (targetX - camera.position.x) * this.chaseSmooth;
		camera.position.y += (targetY - camera.position.y) * this.chaseSmooth;
		camera.position.z += (targetZ - camera.position.z) * this.chaseSmooth;

		const lookX = pos.x + fwd.x * this.chaseLookAhead;
		const lookZ = pos.z + fwd.z * this.chaseLookAhead;
		camera.lookAt(lookX, pos.y + 1, lookZ);

		// Sync orbit params from chase position for seamless transition
		this.carYawRef = Math.atan2(fwd.x, fwd.z);
		this.orbitYaw = 0; // user offset relative to car
		this.orbitDist = camera.position.distanceTo(this.orbitTarget);
		this.orbitPitch = Math.atan2(
			camera.position.y - pos.y - 1,
			Math.sqrt((camera.position.x - pos.x) ** 2 + (camera.position.z - pos.z) ** 2),
		);
	}

	private updateOrbit(camera: THREE.Camera, _fwd: { x: number; y: number; z: number }): void {
		const totalYaw = this.carYawRef + this.orbitYaw;
		this.orbitSpherical.set(this.orbitDist, Math.PI / 2 - this.orbitPitch, totalYaw);
		const targetPos = new THREE.Vector3().setFromSpherical(this.orbitSpherical);
		targetPos.add(this.orbitTarget);

		camera.position.lerp(targetPos, 0.1);
		camera.lookAt(this.orbitTarget);
	}
}
