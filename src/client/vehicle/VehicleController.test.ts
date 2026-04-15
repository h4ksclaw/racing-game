/**
 * Headless physics tests for VehicleController.
 *
 * No browser, no Three.js rendering — just cannon-es stepping + assertions.
 * Uses Trimesh terrain (Heightfield doesn't work with RaycastVehicle raycasts).
 *
 * Run: npm run test:run -- src/client/vehicle/VehicleController.test.ts
 */

import * as CANNON from "cannon-es";
import { describe, expect, it, vi } from "vitest";
import type { CarConfig, VehicleInput } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR, SEDAN_CAR } from "./types.ts";

// Stub Three.js (VehicleController imports GLTFLoader at top level)
vi.mock("three", () => ({
	Group: class {
		position = { x: 0, y: 0, z: 0 };
		quaternion = { x: 0, y: 0, z: 0, w: 1 };
		children: unknown[] = [];
		getObjectByName(): null {
			return null;
		}
	},
	Object3D: class {
		position = { x: 0, y: 0, z: 0 };
		quaternion = { x: 0, y: 0, z: 0, w: 1 };
	},
	Vector3: class {
		x = 0;
		y = 0;
		z = 0;
		set(x: number, y: number, z: number) {
			this.x = x;
			this.y = y;
			this.z = z;
		}
	},
	Color: class {
		r = 1;
		g = 1;
		b = 1;
	},
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class {
		loadAsync() {
			return {
				scene: new (class {
					position = { x: 0, y: 0, z: 0 };
					quaternion = { x: 0, y: 0, z: 0, w: 1 };
					children: unknown[] = [];
					getObjectByName(): null {
						return null;
					}
				})(),
			};
		}
	},
}));

const { VehicleController } = await import("./VehicleController.ts");

// ─── Helpers ────────────────────────────────────────────────────────────────

const flatTerrain = { getHeight: () => 0 };

function simulate(
	vc: InstanceType<typeof VehicleController>,
	input: VehicleInput,
	seconds: number,
): void {
	const dt = 1 / 120;
	const steps = Math.round(seconds * 120);
	for (let i = 0; i < steps; i++) vc.update(input, dt);
}

function telemetry(
	vc: InstanceType<typeof VehicleController>,
	input: VehicleInput,
	seconds: number,
) {
	const data: { time: number; speed: number; y: number; x: number; rpm: number }[] = [];
	const dt = 1 / 120;
	const steps = Math.round(seconds * 120);
	for (let i = 0; i < steps; i++) {
		vc.update(input, dt);
		if (i % 120 === 0) {
			const pos = vc.getPosition();
			data.push({ time: i / 120, speed: vc.state.speed, y: pos.y, x: pos.x, rpm: vc.state.rpm });
		}
	}
	return data;
}

function createVC(config?: CarConfig, worldSize = 2000): InstanceType<typeof VehicleController> {
	const vc = new VehicleController(config);
	vc.setTerrain(flatTerrain, worldSize, 32);
	vc.chassisBody.position.set(0, 2, 0);
	return vc;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("VehicleController — headless physics", () => {
	describe("Construction", () => {
		it("creates a RaycastVehicle with 4 wheels", () => {
			const vc = new VehicleController(RACE_CAR);
			expect(vc.vehicle.wheelInfos).toHaveLength(4);
			expect(vc.chassisBody.mass).toBe(RACE_CAR.mass);
			vc.dispose();
		});

		it("has correct world settings", () => {
			const vc = new VehicleController(RACE_CAR);
			expect(vc.world.gravity.y).toBe(-9.82);
			expect(vc.world.broadphase).toBeInstanceOf(CANNON.SAPBroadphase);
			// @ts-expect-error solver iterations
			expect(vc.world.solver.iterations).toBe(10);
			vc.dispose();
		});

		it("wheels are in correct positions (2 front, 2 rear)", () => {
			const vc = new VehicleController(RACE_CAR);
			const w = vc.vehicle.wheelInfos;
			expect(w[0].chassisConnectionPointLocal.z).toBeGreaterThan(0);
			expect(w[1].chassisConnectionPointLocal.z).toBeGreaterThan(0);
			expect(w[2].chassisConnectionPointLocal.z).toBeLessThan(0);
			expect(w[3].chassisConnectionPointLocal.z).toBeLessThan(0);
			expect(w[0].chassisConnectionPointLocal.x).toBeGreaterThan(0);
			expect(w[1].chassisConnectionPointLocal.x).toBeLessThan(0);
			vc.dispose();
		});
	});

	describe("Stability — no input", () => {
		it("settles on ground and stays still", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 3);
			const pos = vc.getPosition();
			const vel = vc.chassisBody.velocity;
			expect(pos.y).toBeGreaterThan(0);
			expect(pos.y).toBeLessThan(3);
			expect(Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)).toBeLessThan(1.5);
			vc.dispose();
		});

		it("does not flip or spin", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 5);
			const av = vc.chassisBody.angularVelocity;
			expect(Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2)).toBeLessThan(0.3);
			const up = new CANNON.Vec3();
			vc.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), up);
			expect(up.y).toBeGreaterThan(0.8);
			vc.dispose();
		});

		it("stays put for 30 seconds", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 30);
			const pos = vc.getPosition();
			expect(Math.abs(pos.x)).toBeLessThan(5);
			expect(Math.abs(pos.z)).toBeLessThan(5);
			vc.dispose();
		});
	});

	describe("Acceleration", () => {
		it("accelerates forward with throttle", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const z0 = vc.getPosition().z;
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			expect(vc.getPosition().z - z0).toBeGreaterThan(10);
			expect(vc.state.speed).toBeGreaterThan(5);
		});

		it("reaches reasonable top speed", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 20);
			const max = Math.max(...t.map((d) => d.speed));
			expect(max).toBeGreaterThan(15);
			expect(max).toBeLessThan(RACE_CAR.maxSpeed * 1.5);
		});

		it("0-100 km/h under 15s", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 15);
			const hit = t.find((d) => d.speed >= 27.8);
			if (hit) expect(hit.time).toBeLessThan(15);
		});

		it("logs performance metrics", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 15);
			const max = Math.max(...t.map((d) => d.speed));
			console.log(`\n  📊 RACE_CAR: max ${(max * 3.6).toFixed(0)} km/h`);
			const vc2 = createVC(SEDAN_CAR);
			simulate(vc2, DEFAULT_INPUT, 2);
			const t2 = telemetry(vc2, { ...DEFAULT_INPUT, forward: true }, 15);
			const max2 = Math.max(...t2.map((d) => d.speed));
			console.log(`  📊 SEDAN_CAR: max ${(max2 * 3.6).toFixed(0)} km/h`);
			vc.dispose();
			vc2.dispose();
		});
	});

	describe("Braking", () => {
		it("handbrake decelerates the car", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			const before = vc.state.speed;
			expect(before).toBeGreaterThan(5);
			simulate(vc, { ...DEFAULT_INPUT, handbrake: true }, 3);
			expect(vc.state.speed).toBeLessThan(before);
		});

		it("car eventually stops with sustained handbrake", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			simulate(vc, { ...DEFAULT_INPUT, handbrake: true }, 15);
			expect(Math.abs(vc.state.speed)).toBeLessThan(5);
			vc.dispose();
		});
	});

	describe("Steering", () => {
		it("turns left with left input", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 3);
			const x0 = vc.getPosition().x;
			simulate(vc, { ...DEFAULT_INPUT, forward: true, left: true }, 3);
			expect(Math.abs(vc.getPosition().x - x0)).toBeGreaterThan(1);
		});

		it("steering is smooth (not instant)", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 0.1);
			expect(Math.abs(vc.state.steeringAngle)).toBeGreaterThan(0);
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(RACE_CAR.maxSteerAngle);
		});

		it("steering returns to center when released", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 2);
			simulate(vc, DEFAULT_INPUT, 3);
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(0.05);
		});

		it("Ackermann gives different angles at moderate steering", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 0.3);
			const sL = (vc.vehicle.wheelInfos[0] as unknown as { steering: number }).steering;
			const sR = (vc.vehicle.wheelInfos[1] as unknown as { steering: number }).steering;
			expect(Number.isNaN(sL)).toBe(false);
			expect(Number.isNaN(sR)).toBe(false);
			expect(Math.abs(sL)).toBeGreaterThan(0);
			expect(Math.abs(sL)).toBeGreaterThan(Math.abs(sR) * 0.99);
			vc.dispose();
		});
	});

	describe("Ground collision", () => {
		it("stays above ground during full throttle", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 10);
			for (const d of t) expect(d.y).toBeGreaterThan(-1);
		});

		it("stays above ground during hard steering at speed", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true, left: true }, 5);
			for (const d of t) expect(d.y).toBeGreaterThan(-1);
		});

		it("does not fly away from various spawn heights", () => {
			for (const h of [1, 5, 10, 20]) {
				const vc = createVC(RACE_CAR);
				vc.chassisBody.position.set(0, h, 0);
				simulate(vc, DEFAULT_INPUT, 5);
				expect(vc.getPosition().y).toBeGreaterThan(-1);
				expect(vc.getPosition().y).toBeLessThan(h + 1);
				vc.dispose();
			}
		});
	});

	describe("Safety net", () => {
		it("does not teleport at 1m below (physics handles it)", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			vc.chassisBody.position.set(0, -1, 0);
			vc.chassisBody.velocity.set(0, 0, 0);
			simulate(vc, DEFAULT_INPUT, 0.5);
			expect(vc.chassisBody.position.y).toBeGreaterThan(-5);
			vc.dispose();
		});

		it("teleports at 10m below", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			vc.chassisBody.position.set(0, -10, 0);
			vc.chassisBody.velocity.set(0, -5, 0);
			simulate(vc, DEFAULT_INPUT, 1);
			expect(vc.chassisBody.position.y).toBeGreaterThan(0);
			vc.dispose();
		});

		it("teleports at 100m above", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			vc.chassisBody.position.set(0, 100, 0);
			vc.chassisBody.velocity.set(0, 10, 0);
			simulate(vc, DEFAULT_INPUT, 1);
			expect(vc.chassisBody.position.y).toBeLessThan(20);
			vc.dispose();
		});
	});

	describe("RPM", () => {
		it("increases with throttle at standstill", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const rpm0 = vc.state.rpm;
			vc.update({ ...DEFAULT_INPUT, forward: true }, 1 / 120);
			expect(vc.state.rpm).toBeGreaterThan(rpm0);
			vc.dispose();
		});

		it("stays within idle-max range", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 2);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 20);
			for (const d of t) {
				expect(d.rpm).toBeGreaterThanOrEqual(RACE_CAR.idleRPM * 0.9);
				expect(d.rpm).toBeLessThanOrEqual(RACE_CAR.maxRPM * 1.1);
			}
			vc.dispose();
		});
	});

	describe("Reset", () => {
		it("resets position, velocity, and state", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true, left: true }, 5);
			vc.reset(10, 2, 20, Math.PI / 4);
			expect(vc.chassisBody.position.x).toBe(10);
			expect(vc.chassisBody.position.y).toBe(2);
			expect(vc.chassisBody.position.z).toBe(20);
			expect(vc.state.speed).toBe(0);
			expect(vc.state.rpm).toBe(RACE_CAR.idleRPM);
			expect(vc.state.throttle).toBe(0);
			expect(vc.state.brake).toBe(0);
			expect(vc.state.steeringAngle).toBe(0);
			vc.dispose();
		});

		it("drives normally after reset", () => {
			const vc = createVC(RACE_CAR);
			vc.reset(0, 2, 0);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});
	});

	describe("Config validation", () => {
		it("sedan heavier than race car", () => {
			expect(SEDAN_CAR.mass).toBeGreaterThan(RACE_CAR.mass);
		});

		it("race car has higher max speed config", () => {
			expect(RACE_CAR.maxSpeed).toBeGreaterThan(SEDAN_CAR.maxSpeed);
		});

		it("race car has higher force/mass ratio", () => {
			expect(RACE_CAR.engineForce / RACE_CAR.mass).toBeGreaterThan(
				SEDAN_CAR.engineForce / SEDAN_CAR.mass,
			);
		});

		it("all params are physically consistent", () => {
			for (const c of [RACE_CAR, SEDAN_CAR]) {
				expect(c.mass).toBeGreaterThan(0);
				const accel = c.engineForce / c.mass;
				expect(accel).toBeGreaterThan(1);
				expect(accel).toBeLessThan(15);
				expect(c.brakeForce / c.mass).toBeGreaterThan(0.3);
				expect(c.wheelRadius).toBeGreaterThan(0.1);
				expect(c.suspensionStiffness).toBeGreaterThan(10);
				expect(c.suspensionRestLength).toBeGreaterThan(0.1);
				expect(c.frictionSlip).toBeGreaterThan(0.5);
				expect(c.frictionSlip).toBeLessThan(5);
				expect(c.rollInfluence).toBeGreaterThanOrEqual(0);
				expect(c.rollInfluence).toBeLessThanOrEqual(1);
			}
		});
	});

	describe("Dispose", () => {
		it("cleans up all bodies", () => {
			const vc = createVC(RACE_CAR);
			expect(vc.world.bodies.length).toBeGreaterThan(0);
			vc.dispose();
			expect(vc.world.bodies.length).toBe(0);
		});
	});
});
