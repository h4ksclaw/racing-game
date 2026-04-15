/**
 * Headless tests for VehicleController (arcade/bicycle physics).
 *
 * No browser, no Three.js rendering — just math + terrain sampling.
 *
 * Run: npm run test:run -- src/client/vehicle/VehicleController.test.ts
 */

import { describe, expect, it, vi } from "vitest";
import type { CarConfig, VehicleInput } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR, SEDAN_CAR } from "./types.ts";

// Stub Three.js (VehicleController imports GLTFLoader at top level)
vi.mock("three", () => ({
	Group: class {
		position = { x: 0, y: 0, z: 0, set() {} };
		quaternion = { x: 0, y: 0, z: 0, w: 1, set() {}, setFromEuler() {} };
		children: unknown[] = [];
		updateMatrixWorld() {}
		getObjectByName(): null {
			return null;
		}
		clone() {
			return this;
		}
		invert() {
			return this;
		}
	},
	Object3D: class {
		position = { x: 0, y: 0, z: 0, set() {} };
		quaternion = {
			x: 0,
			y: 0,
			z: 0,
			w: 1,
			set() {},
			setFromEuler() {},
			copy() {},
			multiply() {},
			setFromAxisAngle() {
				return this;
			},
		};
	},
	Vector3: class {
		x = 0;
		y = 0;
		z = 0;
		set() {}
	},
	Quaternion: class {
		x = 0;
		y = 0;
		z = 0;
		w = 1;
		set() {}
		setFromAxisAngle() {}
		setFromEuler() {}
		copy() {}
		multiply() {}
		premultiply() {}
		clone() {
			return this;
		}
		invert() {
			return this;
		}
	},
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class {
		loadAsync() {
			return {
				scene: new (class {
					position = { x: 0, y: 0, z: 0, set() {} };
					quaternion = { x: 0, y: 0, z: 0, w: 1, set() {}, setFromEuler() {} };
					children: unknown[] = [];
					updateMatrixWorld() {}
					getObjectByName(): null {
						return null;
					}
				})(),
			};
		}
	},
}));

const { VehicleController } = await import("./VehicleController.ts");
type VC = InstanceType<typeof VehicleController>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const flatTerrain = { getHeight: () => 0, getNormal: () => ({ x: 0, y: 1, z: 0 }) };

function simulate(vc: VC, input: VehicleInput, seconds: number): void {
	const dt = 1 / 60;
	const steps = Math.round(seconds * 60);
	for (let i = 0; i < steps; i++) vc.update(input, dt);
}

function telemetry(vc: VC, input: VehicleInput, seconds: number) {
	const data: { time: number; speed: number; y: number; x: number; rpm: number }[] = [];
	const dt = 1 / 60;
	const steps = Math.round(seconds * 60);
	for (let i = 0; i < steps; i++) {
		vc.update(input, dt);
		if (i % 60 === 0) {
			const pos = vc.getPosition();
			data.push({ time: i / 60, speed: vc.state.speed, y: pos.y, x: pos.x, rpm: vc.state.rpm });
		}
	}
	return data;
}

function createVC(config?: CarConfig) {
	const vc = new VehicleController(config);
	vc.setTerrain(flatTerrain);
	return vc;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("VehicleController — arcade physics", () => {
	describe("Construction", () => {
		it("creates with default config", () => {
			const vc = new VehicleController(RACE_CAR);
			expect(vc.state.speed).toBe(0);
			vc.dispose();
		});

		it("accepts custom config", () => {
			const vc = new VehicleController(SEDAN_CAR);
			expect(vc.state.speed).toBe(0);
			vc.dispose();
		});
	});

	describe("Ground collision", () => {
		it("lands on flat terrain from height", () => {
			const vc = createVC(RACE_CAR);
			// Starts at y=2, should settle near wheelRadius + suspensionRestLength
			simulate(vc, DEFAULT_INPUT, 3);
			const pos = vc.getPosition();
			expect(pos.y).toBeGreaterThan(0);
			expect(pos.y).toBeLessThan(2);
			vc.dispose();
		});

		it("stays on ground during throttle", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 10);
			for (const d of t) expect(d.y).toBeGreaterThan(-0.5);
			vc.dispose();
		});

		it("lands from various heights", () => {
			for (const h of [5, 10, 20]) {
				const vc = createVC(RACE_CAR);
				vc.reset(0, h, 0);
				simulate(vc, DEFAULT_INPUT, 5);
				expect(vc.getPosition().y).toBeGreaterThan(-0.5);
				expect(vc.getPosition().y).toBeLessThan(h + 0.5);
				vc.dispose();
			}
		});

		it("follows hilly terrain", () => {
			const hillyTerrain = {
				getHeight(x: number, z: number) {
					return Math.sin(x * 0.05) * 3 + Math.cos(z * 0.07) * 2;
				},
			};
			const vc = new VehicleController(RACE_CAR);
			vc.setTerrain(hillyTerrain);
			simulate(vc, DEFAULT_INPUT, 2);
			const pos = vc.getPosition();
			const ground = hillyTerrain.getHeight(pos.x, pos.z);
			expect(pos.y).toBeGreaterThan(ground - 0.5);
			expect(pos.y).toBeLessThan(ground + 5);
			vc.dispose();
		});
	});

	describe("Acceleration", () => {
		it("accelerates forward with throttle", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
			const z0 = vc.getPosition().z;
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			// Car moves forward (heading=0 → +Z direction)
			expect(vc.getPosition().z).toBeGreaterThan(z0);
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});

		it("reaches reasonable top speed", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 20);
			const max = Math.max(...t.map((d) => d.speed));
			expect(max).toBeGreaterThan(15);
			expect(max).toBeLessThan(RACE_CAR.maxSpeed * 1.5);
			vc.dispose();
		});

		it("coasts to a stop when throttle released", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			expect(vc.state.speed).toBeGreaterThan(5);
			simulate(vc, DEFAULT_INPUT, 20);
			expect(vc.state.speed).toBeLessThan(40);
			vc.dispose();
		});

		it("logs performance metrics", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
			const t = telemetry(vc, { ...DEFAULT_INPUT, forward: true }, 20);
			const max = Math.max(...t.map((d) => d.speed));
			console.log(`\n  📊 RACE_CAR: max ${(max * 3.6).toFixed(0)} km/h`);

			const vc2 = createVC(SEDAN_CAR);
			simulate(vc2, DEFAULT_INPUT, 1);
			const t2 = telemetry(vc2, { ...DEFAULT_INPUT, forward: true }, 20);
			const max2 = Math.max(...t2.map((d) => d.speed));
			console.log(`  📊 SEDAN_CAR: max ${(max2 * 3.6).toFixed(0)} km/h`);
			vc.dispose();
			vc2.dispose();
		});
	});

	describe("Braking", () => {
		it("handbrake decelerates the car", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			const before = vc.state.speed;
			expect(before).toBeGreaterThan(5);
			simulate(vc, { ...DEFAULT_INPUT, handbrake: true }, 3);
			expect(vc.state.speed).toBeLessThan(before);
			vc.dispose();
		});

		it("S key brakes when moving forward", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			const before = vc.state.speed;
			simulate(vc, { ...DEFAULT_INPUT, backward: true }, 2);
			expect(vc.state.speed).toBeLessThan(before);
			vc.dispose();
		});

		it("car eventually stops with sustained handbrake", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
			simulate(vc, { ...DEFAULT_INPUT, handbrake: true }, 15);
			expect(Math.abs(vc.state.speed)).toBeLessThan(5);
			vc.dispose();
		});
	});

	describe("Steering", () => {
		it("turns left with left input", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 3);
			const x0 = vc.getPosition().x;
			simulate(vc, { ...DEFAULT_INPUT, forward: true, left: true }, 3);
			expect(Math.abs(vc.getPosition().x - x0)).toBeGreaterThan(1);
			vc.dispose();
		});

		it("turns right with right input", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 3);
			const x0 = vc.getPosition().x;
			simulate(vc, { ...DEFAULT_INPUT, forward: true, right: true }, 3);
			expect(Math.abs(vc.getPosition().x - x0)).toBeGreaterThan(1);
			vc.dispose();
		});

		it("steering is smooth (not instant)", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 0.1);
			expect(Math.abs(vc.state.steeringAngle)).toBeGreaterThan(0);
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(RACE_CAR.maxSteerAngle);
			vc.dispose();
		});

		it("steering returns to center when released", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 2);
			expect(Math.abs(vc.state.steeringAngle)).toBeGreaterThan(0.1);
			simulate(vc, DEFAULT_INPUT, 2);
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(0.05);
			vc.dispose();
		});

		it("no steering at zero speed", () => {
			const vc = createVC(RACE_CAR);
			const x0 = vc.getPosition().x;
			simulate(vc, { ...DEFAULT_INPUT, left: true }, 3);
			// Without throttle, car shouldn't move sideways
			expect(Math.abs(vc.getPosition().x - x0)).toBeLessThan(1);
			vc.dispose();
		});
	});

	describe("No invisible walls", () => {
		it("drives across varied terrain without stopping", () => {
			const terrain = {
				getHeight(x: number, z: number) {
					return Math.sin(x * 0.1) * 2 + Math.cos(z * 0.08) * 3;
				},
			};
			const vc = new VehicleController(RACE_CAR);
			vc.setTerrain(terrain);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 10);
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});
	});

	describe("RPM", () => {
		it("increases with throttle at standstill", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
			const rpm0 = vc.state.rpm;
			vc.update({ ...DEFAULT_INPUT, forward: true }, 1 / 60);
			expect(vc.state.rpm).toBeGreaterThan(rpm0);
			vc.dispose();
		});

		it("stays within idle-max range", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, DEFAULT_INPUT, 1);
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
			vc.reset(10, 5, 20, Math.PI / 4);
			const pos = vc.getPosition();
			expect(pos.x).toBe(10);
			expect(pos.y).toBe(5);
			expect(pos.z).toBe(20);
			expect(vc.state.speed).toBe(0);
			expect(vc.state.rpm).toBe(RACE_CAR.idleRPM);
			expect(vc.state.throttle).toBe(0);
			expect(vc.state.brake).toBe(0);
			expect(vc.state.steeringAngle).toBe(0);
			vc.dispose();
		});

		it("drives normally after reset", () => {
			const vc = createVC(RACE_CAR);
			simulate(vc, { ...DEFAULT_INPUT, forward: true }, 5);
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
		it("does not throw", () => {
			const vc = createVC(RACE_CAR);
			expect(() => vc.dispose()).not.toThrow();
		});
	});
});
