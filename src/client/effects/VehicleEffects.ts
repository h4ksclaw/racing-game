/**
 * VehicleEffects — orchestrates all visual effects tied to vehicle state.
 *
 * Reads vehicle controller state each frame and dispatches to:
 * - TireSmoke: white/gray smoke from sliding tires
 * - DirtThrow: brown/green dirt from off-road wheels
 * - SkidMarks: dark marks painted on road surface
 *
 * Architecture:
 * - Single entry point: `update(dt, vehicle)`
 * - Each effect is independent and can be added/removed
 * - Effects read from vehicle state, never write to it
 * - Future effects (sparks, exhaust, rain spray) plug in here
 *
 * For burnout support:
 * - When engine burnout is implemented, set `wheelSlideIntensity` > 0
 *   for stationary driven wheels with throttle applied
 * - TireSmoke and SkidMarks will automatically respond
 */

import type * as THREE from "three";
import type { RapierVehicleController } from "../vehicle/RapierVehicleController.ts";
import { DirtThrow } from "./DirtThrow.ts";
import { SkidMarks } from "./SkidMarks.ts";
import { TireSmoke } from "./TireSmoke.ts";

export class VehicleEffects {
	private tireSmoke: TireSmoke;
	private dirtThrow: DirtThrow;
	private skidMarks: SkidMarks;

	constructor(scene: THREE.Scene) {
		this.tireSmoke = new TireSmoke(scene);
		this.dirtThrow = new DirtThrow(scene);
		this.skidMarks = new SkidMarks(scene);
	}

	/** Provide terrain for skid mark Y-snapping */
	setTerrain(terrain: { getHeight(x: number, z: number): number }): void {
		this.skidMarks.setTerrain(terrain);
	}

	/**
	 * Update all effects. Call once per frame, after vehicle physics step.
	 *
	 * @param dt Frame delta (seconds)
	 * @param vehicle Vehicle controller (reads state, wheel positions, etc.)
	 * @param now Current time in seconds (for skid mark aging)
	 */
	update(dt: number, vehicle: RapierVehicleController, now: number): void {
		const wheelWorldPos = vehicle.getWheelWorldPositions();
		const speed = Math.abs(vehicle.state.speed);
		const wheelSlide = this.computeWheelSlide(vehicle);
		const wheelSlideScaled = this.scaleBySpeed(wheelSlide, speed);
		const wheelOffRoad = this.computeWheelOffRoad(vehicle);

		this.tireSmoke.update(dt, wheelWorldPos, wheelSlideScaled);
		this.dirtThrow.update(dt, wheelWorldPos, wheelOffRoad, speed);
		this.skidMarks.update(now, wheelWorldPos, wheelSlideScaled, wheelOffRoad);
	}

	/**
	 * Compute per-wheel slide intensity (0-1).
	 *
	 * Sources of sliding:
	 * 1. Handbrake: rear wheels slide (intensity = driftFactor)
	 * 2. Hard cornering: outside rear slides (intensity based on lateral G)
	 * 3. Future burnout: driven wheels spin while stationary
	 */
	private computeWheelSlide(vehicle: RapierVehicleController): number[] {
		const td = vehicle.tireDynState;
		const intensities = [0, 0, 0, 0];
		const speed = Math.abs(vehicle.state.speed);

		if (!td || speed < 0.5) return intensities;

		// Handbrake / drift: rear wheels (index 2, 3) slide only
		if (td.isDrifting) {
			const driftIntensity = Math.min(1, td.driftFactor);
			intensities[2] = driftIntensity;
			intensities[3] = driftIntensity;
		}

		// Hard cornering: outside rear slides (fronts keep grip)
		const angVel = vehicle.physicsBody?.angvel();
		if (angVel) {
			const yawRate = angVel.y;
			const latG = Math.abs(yawRate * speed) / 9.81;
			if (latG > 0.3) {
				const cornerIntensity = Math.min(0.6, (latG - 0.3) * 0.5);
				const turningRight = yawRate > 0;
				if (turningRight) {
					intensities[3] = Math.max(intensities[3], cornerIntensity); // RR
				} else {
					intensities[2] = Math.max(intensities[2], cornerIntensity); // RL
				}
			}
		}

		return intensities;
	}

	/** Scale slide intensities by speed — linear ramp. Full at 20 m/s (~72 km/h). */
	private scaleBySpeed(intensities: number[], speed: number): number[] {
		const factor = Math.min(1, (speed - 0.5) / 19.5);
		return intensities.map((v) => v * factor);
	}

	/**
	 * Compute per-wheel off-road status.
	 * Checks each wheel's world XZ against road boundary.
	 */
	private computeWheelOffRoad(vehicle: RapierVehicleController): boolean[] {
		const body = vehicle.physicsBody;
		const terrain = vehicle.terrain;
		if (!body || !terrain?.getRoadBoundary) return [false, false, false, false];

		const pos = body.translation();
		const rot = body.rotation();
		const heading = Math.atan2(2 * (rot.w * rot.y + rot.z * rot.x), 1 - 2 * (rot.y * rot.y + rot.x * rot.x));
		const cosH = Math.cos(heading);
		const sinH = Math.sin(heading);
		const chassis = vehicle.config.chassis;

		return chassis.wheelPositions.map((lp) => {
			const wx = pos.x + lp.x * cosH - lp.z * sinH;
			const wz = pos.z + lp.x * sinH + lp.z * cosH;
			const rb = terrain.getRoadBoundary?.(wx, wz);
			return rb ? !rb.onRoad : false;
		});
	}

	dispose(): void {
		this.tireSmoke.dispose();
		this.dirtThrow.dispose();
		this.skidMarks.dispose();
	}
}
