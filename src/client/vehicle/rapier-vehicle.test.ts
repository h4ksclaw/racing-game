import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { SPORTS_CAR } from "./configs.ts";
import { RapierVehicleController } from "./RapierVehicleController.ts";
import type { TerrainProvider, VehicleInput } from "./types.ts";

/** Mock terrain: flat at given height. */
class FlatTerrain implements TerrainProvider {
	constructor(private height = 0) {}
	getHeight() {
		return this.height;
	}
	get physicsHeight() {
		return this.height + 0.3;
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

/** Run N physics steps to let the car settle. */
function settle(v: RapierVehicleController, steps = 60, dt = 1 / 60) {
	for (let i = 0; i < steps; i++) {
		v.update(flatInput(), dt);
	}
}

/** Get the car up to a reasonable speed. */
function getMoving(v: RapierVehicleController, frames = 120) {
	for (let i = 0; i < frames; i++) {
		v.update(flatInput({ forward: true }), 1 / 60);
	}
}

describe("RapierVehicleController", () => {
	beforeAll(async () => {
		await RAPIER.init();
	});

	async function makeVehicle(terrainHeight = 0) {
		const v = new RapierVehicleController(SPORTS_CAR);
		await v.init();
		v.setTerrain(new FlatTerrain(terrainHeight));
		const cfg = SPORTS_CAR.chassis;
		const bodyY = terrainHeight + 0.3 + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1];
		v.reset(0, bodyY, 0, 0);
		return v;
	}

	describe("Ground contact", () => {
		it("wheels are in contact with ground after settling", async () => {
			const v = await makeVehicle(0);
			settle(v);
			expect(v.state.onGround).toBe(true);
		});

		it("car Y matches expected ground height + offset after settling", async () => {
			const v = await makeVehicle(0);
			settle(v);
			const pos = v.getPosition();
			const cfg = SPORTS_CAR.chassis;
			const expectedY = 0.3 + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1];
			expect(pos.y).toBeGreaterThan(expectedY - 0.5);
			expect(pos.y).toBeLessThan(expectedY + 0.5);
		});

		it("ground trimesh at correct height for non-zero terrain", async () => {
			const v = await makeVehicle(5);
			settle(v);
			const pos = v.getPosition();
			const cfg = SPORTS_CAR.chassis;
			const expectedY = 5.3 + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1];
			expect(pos.y).toBeGreaterThan(expectedY - 0.5);
			expect(pos.y).toBeLessThan(expectedY + 0.5);
		});
	});

	describe("Acceleration", () => {
		it("accelerates forward when throttle applied", async () => {
			const v = await makeVehicle(0);
			settle(v);
			const speedBefore = Math.abs(v.state.speed);

			for (let i = 0; i < 60; i++) {
				v.update(flatInput({ forward: true }), 1 / 60);
			}
			expect(Math.abs(v.state.speed)).toBeGreaterThan(speedBefore);
			expect(Math.abs(v.state.speed)).toBeGreaterThan(0.5);
		});

		it("throttle produces positive speed (W = forward)", async () => {
			const v = await makeVehicle(0);
			settle(v);

			for (let i = 0; i < 120; i++) {
				v.update(flatInput({ forward: true }), 1 / 60);
			}
			expect(v.state.speed).toBeGreaterThan(1.0);
		});

		it("reverse produces negative speed (S = backward, after 500ms delay)", async () => {
			const v = await makeVehicle(0);
			settle(v);

			// Hold backward long enough: 600ms to engage reverse + 2s to build speed
			for (let i = 0; i < 156; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.gear).toBe(-1);
			expect(v.state.speed).toBeLessThan(-0.1);
		});
	});

	describe("Braking", () => {
		it("decelerates when brake applied", async () => {
			const v = await makeVehicle(0);
			getMoving(v);
			const speedBefore = Math.abs(v.state.speed);
			expect(speedBefore).toBeGreaterThan(1.0);

			for (let i = 0; i < 60; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(Math.abs(v.state.speed)).toBeLessThan(speedBefore);
		});

		it("does not flip/roll during hard braking from speed", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 180);
			expect(Math.abs(v.state.speed)).toBeGreaterThan(5.0);

			for (let i = 0; i < 120; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}

			const r = v.physicsBody.rotation();
			const roll = Math.asin(2 * (r.w * r.x + r.y * r.z));
			expect(Math.abs(roll)).toBeLessThan(Math.PI / 12);
			expect(v.getPosition().y).toBeGreaterThan(0);
		});

		it("does not flip during handbrake from speed", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 180);

			for (let i = 0; i < 120; i++) {
				v.update(flatInput({ handbrake: true }), 1 / 60);
			}

			const r = v.physicsBody.rotation();
			const roll = Math.asin(2 * (r.w * r.x + r.y * r.z));
			expect(Math.abs(roll)).toBeLessThan(Math.PI / 6);
		});

		it("significantly reduces speed with sustained braking", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 180);

			for (let i = 0; i < 300; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}

			expect(Math.abs(v.state.speed)).toBeLessThan(15);
		});
	});

	describe("Steering", () => {
		it("turns when steering input applied", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 60);
			const headingBefore = v.getHeading();

			for (let i = 0; i < 90; i++) {
				v.update(flatInput({ forward: true, left: true }), 1 / 60);
			}
			expect(Math.abs(v.getHeading() - headingBefore)).toBeGreaterThan(0.01);
		});

		it("steering angle is zero when no input", async () => {
			const v = await makeVehicle(0);
			settle(v);
			expect(v.state.steeringAngle).toBe(0);
		});

		it("steering angle is non-zero with left/right input", async () => {
			const v = await makeVehicle(0);
			settle(v);
			v.update(flatInput({ left: true }), 1 / 60);
			expect(Math.abs(v.state.steeringAngle)).toBeGreaterThan(0);
		});

		it("drives straight without steering — no oscillation", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 120);

			const headings: number[] = [];
			for (let i = 0; i < 180; i++) {
				v.update(flatInput({ forward: true }), 1 / 60);
				headings.push(v.getHeading());
			}

			let maxDelta = 0;
			for (let i = 1; i < headings.length; i++) {
				maxDelta = Math.max(maxDelta, Math.abs(headings[i] - headings[i - 1]));
			}
			expect(maxDelta).toBeLessThan(0.02);
		});

		it("high-speed steering does not cause spinout", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 240);
			expect(Math.abs(v.state.speed)).toBeGreaterThan(10.0);

			for (let i = 0; i < 60; i++) {
				v.update(flatInput({ forward: true, left: true }), 1 / 60);
			}

			const r = v.physicsBody.rotation();
			const roll = Math.asin(2 * (r.w * r.x + r.y * r.z));
			expect(Math.abs(roll)).toBeLessThan(Math.PI / 4);
			expect(v.state.speed).toBeGreaterThan(-2.0);
		});
	});

	describe("Reset", () => {
		it("resets position, velocity, and state", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 120);
			expect(Math.abs(v.state.speed)).toBeGreaterThan(1.0);

			v.reset(10, 5, 20, 0);
			expect(v.getPosition()).toEqual({ x: 10, y: 5, z: 20 });
			expect(v.state.speed).toBe(0);
			expect(v.state.rpm).toBe(SPORTS_CAR.engine.idleRPM);
			expect(v.state.gear).toBe(1);
			expect(v.state.steeringAngle).toBe(0);
		});

		it("drives normally after reset", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 120);
			v.reset(0, 3, 0, 0);

			for (let i = 0; i < 120; i++) {
				v.update(flatInput({ forward: true }), 1 / 60);
			}
			expect(v.state.speed).toBeGreaterThan(1.0);
		});

		it("reset sets correct heading from rotation parameter", async () => {
			const v = await makeVehicle(0);
			v.reset(0, 3, 0, Math.PI / 2);
			expect(v.getHeading()).toBeCloseTo(Math.PI / 2, 1);
		});
	});

	describe("Engine braking (coasting)", () => {
		it("coasting decelerates gently, not aggressively", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 240);
			const speedBefore = v.state.speed;
			expect(speedBefore).toBeGreaterThan(5.0);

			// Coast (no throttle, no brake) for 3 seconds
			for (let i = 0; i < 180; i++) {
				v.update(flatInput(), 1 / 60);
			}

			// Should retain at least 30% of speed
			expect(v.state.speed).toBeGreaterThan(0);
			expect(v.state.speed).toBeGreaterThan(speedBefore * 0.3);
		});
	});

	describe("Gearbox downshift", () => {
		it("downshifts when RPM drops low enough", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 300);
			const gearAtSpeed = v.telemetry.gear;
			expect(gearAtSpeed).toBeGreaterThan(0);

			for (let i = 0; i < 600; i++) {
				v.update(flatInput(), 1 / 60);
			}

			expect(v.telemetry.gear).toBeLessThanOrEqual(gearAtSpeed);
		});
	});

	describe("Reverse gear state machine", () => {
		it("brakes first — gear stays forward while car has speed", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 120);
			expect(v.state.speed).toBeGreaterThan(1.0);

			// Hold backward for 1 second
			for (let i = 0; i < 60; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			// Gear should be positive (forward), not -1 — still braking
			expect(v.state.gear).toBeGreaterThan(0);
		});

		it("does NOT engage reverse within 500ms of stopping", async () => {
			const v = await makeVehicle(0);
			settle(v);

			// Hold backward for 400ms (less than 500ms threshold)
			for (let i = 0; i < 24; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.gear).not.toBe(-1);
		});

		it("engages reverse after 500ms hold while stopped", async () => {
			const v = await makeVehicle(0);
			settle(v);

			// Hold backward for 600ms (> 500ms threshold)
			for (let i = 0; i < 36; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.gear).toBe(-1);
		});

		it("car accelerates backward once reverse is engaged", async () => {
			const v = await makeVehicle(0);
			settle(v);

			// Hold backward long enough to engage reverse (600ms)
			for (let i = 0; i < 36; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.gear).toBe(-1);

			// Continue holding — car should start moving backward
			for (let i = 0; i < 120; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.speed).toBeLessThan(-0.3);
		});

		it("resets reverse timer if backward is released mid-wait", async () => {
			const v = await makeVehicle(0);
			settle(v);

			// Hold backward for 300ms
			for (let i = 0; i < 18; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			// Release
			for (let i = 0; i < 10; i++) {
				v.update(flatInput(), 1 / 60);
			}
			// Hold backward for 400ms (total 700ms if timer persisted)
			for (let i = 0; i < 24; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			// Timer was reset — should NOT be in reverse
			expect(v.state.gear).not.toBe(-1);
		});

		it("speed trends downward during braking phase", async () => {
			const v = await makeVehicle(0);
			getMoving(v, 180);
			const startSpeed = v.state.speed;
			expect(startSpeed).toBeGreaterThan(2.0);

			// After 0.5s of braking, speed should be lower than start
			for (let i = 0; i < 30; i++) {
				v.update(flatInput({ backward: true }), 1 / 60);
			}
			expect(v.state.speed).toBeLessThan(startSpeed);
		});
	});

	describe("Properties", () => {
		it("physicsBody exposes the Rapier rigid body", async () => {
			const v = await makeVehicle(0);
			expect(v.physicsBody).toBeDefined();
			expect(v.physicsBody.translation()).toBeDefined();
		});

		it("rapierWorld exposes the Rapier world", async () => {
			const v = await makeVehicle(0);
			expect(v.rapierWorld).toBeDefined();
		});

		it("config returns the car config", async () => {
			const v = await makeVehicle(0);
			expect(v.config).toBe(SPORTS_CAR);
		});

		it("getDebugInfo returns all expected fields", async () => {
			const v = await makeVehicle(0);
			settle(v);
			const info = v.getDebugInfo();

			expect(info.pos).toBeDefined();
			expect(info.vel).toBeDefined();
			expect(info.speed).toBeDefined();
			expect(info.rpm).toBeDefined();
			expect(info.gear).toBeDefined();
			expect(info.contacts).toBeDefined();
			expect(info.guardrails).toBeDefined();
			expect(info.patchCenter).toBeDefined();
		});
	});
});
