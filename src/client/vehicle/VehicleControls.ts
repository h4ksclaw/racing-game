/**
 * Maps player input to vehicle physics forces.
 */

import { PHYSICS } from "@shared/constants.ts";
import type { ControlState } from "@shared/types.ts";
import type { InputManager } from "../game/InputManager.ts";
import type { Vehicle } from "./Vehicle.ts";

export class VehicleControls {
	constructor(
		private vehicle: Vehicle,
		// InputManager referenced via apply() controls parameter
		_input: InputManager,
	) {}

	/** Apply input to vehicle physics each frame */
	apply(controls: ControlState, _delta: number): void {
		const rv = this.vehicle.getRaycastVehicle();

		// Steering (front wheels: indices 0, 1)
		const targetSteer = controls.left ? PHYSICS.MAX_STEER : controls.right ? -PHYSICS.MAX_STEER : 0;
		for (const idx of [0, 1]) {
			rv.setSteeringValue(targetSteer, idx);
		}

		// Engine force (rear wheels: indices 2, 3)
		const engineForce = controls.forward ? PHYSICS.MAX_ENGINE_FORCE : 0;
		const brakeForce = controls.backward ? PHYSICS.MAX_BRAKE_FORCE : 0;

		for (const idx of [2, 3]) {
			rv.applyEngineForce(engineForce, idx);
			rv.setBrake(brakeForce, idx);
		}

		// Handbrake — reduce rear friction to enable drift
		if (controls.handbrake) {
			for (const idx of [2, 3]) {
				// TODO: Switch wheel friction to drift values dynamically
				rv.setBrake(PHYSICS.MAX_BRAKE_FORCE * 0.5, idx);
			}
		}

		// Reset
		if (controls.reset) {
			this.vehicle.resetTo({ x: 0, y: 2, z: 0 });
		}
	}
}
