/**
 * Chase camera that follows the vehicle with smooth interpolation.
 */

import { CAMERA } from "@shared/constants.ts";
import { type PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { Vehicle } from "./Vehicle.ts";

export class VehicleCamera {
	private targetPosition = new Vector3();
	private targetLookAt = new Vector3();
	private currentLookAt = new Vector3();

	constructor(
		private camera: PerspectiveCamera,
		private vehicle: Vehicle,
	) {
		// Initialize behind the car
		this.camera.position.set(0, CAMERA.HEIGHT, CAMERA.DISTANCE);
		this.currentLookAt.set(0, 0, 0);
	}

	update(_delta: number): void {
		const chassis = this.vehicle.getChassis();

		// Compute desired position: behind and above the car
		const quat = chassis.quaternion;
		const forward = new Vector3(0, 0, 1);
		forward.applyQuaternion(new Quaternion(quat.x, quat.y, quat.z, quat.w));

		this.targetPosition.set(
			chassis.position.x - forward.x * CAMERA.DISTANCE,
			chassis.position.y + CAMERA.HEIGHT,
			chassis.position.z - forward.z * CAMERA.DISTANCE,
		);

		// Smooth follow
		this.camera.position.lerp(this.targetPosition, CAMERA.LERP);

		// Look ahead of the car
		this.targetLookAt.set(
			chassis.position.x + forward.x * CAMERA.LOOK_AHEAD,
			chassis.position.y,
			chassis.position.z + forward.z * CAMERA.LOOK_AHEAD,
		);

		this.currentLookAt.lerp(this.targetLookAt, CAMERA.LERP);
		this.camera.lookAt(this.currentLookAt);
	}
}
