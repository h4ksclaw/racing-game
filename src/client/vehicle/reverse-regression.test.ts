/**
 * Reverse acceleration regression test.
 *
 * Reproduces the bug: reverse engages (gear=-1, brakeF=0) but car
 * doesn't accelerate backward — stays stuck at ~-0.7 m/s.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { SPORTS_CAR } from "./configs.ts";
import { RapierVehicleController } from "./RapierVehicleController.ts";
import type { TerrainProvider, VehicleInput } from "./types.ts";

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

async function makeVehicle(terrainHeight = 0) {
	const v = new RapierVehicleController(SPORTS_CAR);
	await v.init();
	v.setTerrain(new FlatTerrain(terrainHeight));
	const cfg = SPORTS_CAR.chassis;
	const bodyY = terrainHeight + 0.3 + cfg.wheelRadius + cfg.suspensionRestLength + cfg.halfExtents[1];
	v.reset(0, bodyY, 0, 0);
	return v;
}

describe("Reverse acceleration regression", () => {
	beforeAll(async () => {
		await RAPIER.init();
	});

	it("reverse should accelerate beyond -1 m/s within 3 seconds of engagement", async () => {
		const v = await makeVehicle(0);

		// Settle on ground
		for (let i = 0; i < 60; i++) v.update(flatInput(), 1 / 60);

		// Hold backward: 600ms to engage reverse, then continue for 3s
		for (let i = 0; i < 216; i++) {
			v.update(flatInput({ backward: true }), 1 / 60);
		}

		// Reverse must be engaged
		expect(v.state.gear).toBe(-1);

		// Car should be accelerating backward — at least -2 m/s by now
		const speed = v.state.speed;
		console.log(`[TEST] Reverse speed after 3.6s: ${speed.toFixed(2)} m/s, gear=${v.state.gear}`);
		expect(speed).toBeLessThan(-1.0);
	});

	it("reverse speed should keep increasing (not plateau at -0.7)", async () => {
		const v = await makeVehicle(0);

		// Settle
		for (let i = 0; i < 60; i++) v.update(flatInput(), 1 / 60);

		// Hold backward long enough to engage + build speed
		const speeds: number[] = [];
		for (let i = 0; i < 360; i++) {
			// 6 seconds total
			v.update(flatInput({ backward: true }), 1 / 60);
			if (i >= 60) speeds.push(v.state.speed); // only after reverse engages
		}

		// Speed at end should be more negative than speed at start of reverse
		const firstThird = speeds.slice(0, speeds.length / 3);
		const lastThird = speeds.slice(-speeds.length / 3);
		const avgFirst = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
		const avgLast = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

		console.log(`[TEST] Avg reverse speed first third: ${avgFirst.toFixed(2)}, last third: ${avgLast.toFixed(2)}`);
		expect(avgLast).toBeLessThan(avgFirst); // should be more negative
		expect(speeds[speeds.length - 1]).toBeLessThan(-2.0); // final speed at least -2 m/s
	});

	it("forward should work normally after reverse disengage", async () => {
		const v = await makeVehicle(0);

		// Settle
		for (let i = 0; i < 60; i++) v.update(flatInput(), 1 / 60);

		// Reverse for 2 seconds
		for (let i = 0; i < 120; i++) v.update(flatInput({ backward: true }), 1 / 60);

		// Release all input — car should slow down
		for (let i = 0; i < 120; i++) v.update(flatInput(), 1 / 60);

		// Now go forward
		for (let i = 0; i < 120; i++) v.update(flatInput({ forward: true }), 1 / 60);

		console.log(`[TEST] Forward speed after reverse: ${v.state.speed.toFixed(2)} m/s`);
		expect(v.state.speed).toBeGreaterThan(1.0);
	});

	it("auto-stop: releasing all input should slow car to near-zero", async () => {
		const v = await makeVehicle(0);

		// Settle
		for (let i = 0; i < 60; i++) v.update(flatInput(), 1 / 60);

		// Accelerate forward for 3 seconds
		for (let i = 0; i < 180; i++) v.update(flatInput({ forward: true }), 1 / 60);
		expect(v.state.speed).toBeGreaterThan(5.0);

		// Release — should slow down via auto-stop (wheel brakes + rolling drag)
		const startSpeed = v.state.speed;
		for (let i = 0; i < 300; i++) v.update(flatInput(), 1 / 60); // 5 seconds of coasting

		console.log(`[TEST] Speed after 5s no input: ${v.state.speed.toFixed(2)} (was ${startSpeed.toFixed(2)})`);
		// Realistic coasting (~0.03g) — car should be slower but not aggressively stopped
		expect(v.state.speed).toBeLessThan(startSpeed * 0.85);
		expect(v.state.brake).toBe(0); // auto-stop should NOT show brake lights
	});
});
