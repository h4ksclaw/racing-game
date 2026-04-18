import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { SPORTS_CAR } from "./configs.ts";
import { RapierVehicleController } from "./RapierVehicleController.ts";
import type { TerrainProvider, VehicleInput } from "./types.ts";

/** Mock terrain that returns a flat height everywhere. */
class FlatTerrain implements TerrainProvider {
	constructor(private height = 0) {}
	getHeight() {
		return this.height;
	}
}

const flatInput = (overrides: Partial<VehicleInput> = {}): VehicleInput => ({
	forward: false,
	backward: false,
	left: false,
	right: false,
	brake: false,
	handbrake: false,
	...overrides,
});

describe("RapierVehicleController", () => {
	beforeAll(async () => {
		await RAPIER.init();
	});

	async function makeVehicle(terrainHeight = 0) {
		const v = new RapierVehicleController(SPORTS_CAR);
		await v.init();
		v.setTerrain(new FlatTerrain(terrainHeight));
		// Reset car to a known position on the flat ground
		const cfg = SPORTS_CAR.chassis;
		const bodyY = terrainHeight + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1] * 0.5;
		v.reset(0, bodyY, 0, 0);
		return v;
	}

	/** Run N physics steps to let the car settle. */
	function settle(v: RapierVehicleController, steps = 60, dt = 1 / 60) {
		for (let i = 0; i < steps; i++) {
			v.update(flatInput(), dt);
		}
	}

	it("wheels are in contact with ground after settling", async () => {
		const v = await makeVehicle(0);
		settle(v);
		expect(v.state.onGround).toBe(true);
	});

	it("car Y position matches expected ground height + offset after settling", async () => {
		const v = await makeVehicle(0);
		settle(v);
		const pos = v.getPosition();
		const cfg = SPORTS_CAR.chassis;
		// After settling, car should be near: groundY + wheelRadius + suspensionRestLength + connectionOffset
		const expectedY = cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1] * 0.5;
		// Allow 0.5m tolerance for suspension compression
		expect(pos.y).toBeGreaterThan(expectedY - 0.5);
		expect(pos.y).toBeLessThan(expectedY + 0.5);
	});

	it("car accelerates forward when throttle applied", async () => {
		const v = await makeVehicle(0);
		settle(v);
		const speedBefore = Math.abs(v.state.speed);

		// Apply throttle for 60 frames (1 second)
		for (let i = 0; i < 60; i++) {
			v.update(flatInput({ forward: true }), 1 / 60);
		}
		const speedAfter = Math.abs(v.state.speed);

		expect(speedAfter).toBeGreaterThan(speedBefore);
		expect(speedAfter).toBeGreaterThan(0.5); // Should be moving at least 0.5 m/s
	});

	it("throttle produces positive speed (W = forward)", async () => {
		const v = await makeVehicle(0);
		settle(v);

		// Apply throttle for 120 frames (2 seconds)
		for (let i = 0; i < 120; i++) {
			v.update(flatInput({ forward: true }), 1 / 60);
		}

		// Speed should be positive (forward), not negative (backward)
		expect(v.state.speed).toBeGreaterThan(1.0);
	});

	it("reverse produces negative speed (S = backward)", async () => {
		const v = await makeVehicle(0);
		settle(v);

		// Apply reverse for 120 frames
		for (let i = 0; i < 120; i++) {
			v.update(flatInput({ backward: true }), 1 / 60);
		}

		// Speed should be negative (reverse)
		expect(v.state.speed).toBeLessThan(-0.5);
	});

	it("car turns when steering input applied", async () => {
		const v = await makeVehicle(0);
		// Get the car moving first
		for (let i = 0; i < 60; i++) {
			v.update(flatInput({ forward: true }), 1 / 60);
		}
		const headingBefore = v.getHeading();

		// Apply left steering while moving
		for (let i = 0; i < 90; i++) {
			v.update(flatInput({ forward: true, left: true }), 1 / 60);
		}
		const headingAfter = v.getHeading();

		// Heading should have changed (car turned)
		const headingDelta = Math.abs(headingAfter - headingBefore);
		expect(headingDelta).toBeGreaterThan(0.01);
	});

	it("car decelerates when brake applied", async () => {
		const v = await makeVehicle(0);
		// Get the car moving
		for (let i = 0; i < 120; i++) {
			v.update(flatInput({ forward: true }), 1 / 60);
		}
		const speedBefore = Math.abs(v.state.speed);
		expect(speedBefore).toBeGreaterThan(1.0);

		// Apply brakes
		for (let i = 0; i < 60; i++) {
			v.update(flatInput({ backward: true }), 1 / 60);
		}
		const speedAfter = Math.abs(v.state.speed);

		expect(speedAfter).toBeLessThan(speedBefore);
	});

	it("steering angle is zero when no input", async () => {
		const v = await makeVehicle(0);
		settle(v);
		expect(v.state.steeringAngle).toBe(0);
	});

	it("steering angle is non-zero when left/right input", async () => {
		const v = await makeVehicle(0);
		settle(v);
		v.update(flatInput({ left: true }), 1 / 60);
		expect(Math.abs(v.state.steeringAngle)).toBeGreaterThan(0);
	});

	it("ground trimesh is at correct height for non-zero terrain", async () => {
		const terrainHeight = 5.0;
		const v = await makeVehicle(terrainHeight);
		settle(v);
		const pos = v.getPosition();
		// Car should be near terrainHeight + expected offset
		const cfg = SPORTS_CAR.chassis;
		const expectedY = terrainHeight + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1] * 0.5;
		expect(pos.y).toBeGreaterThan(expectedY - 0.5);
		expect(pos.y).toBeLessThan(expectedY + 0.5);
	});
});
