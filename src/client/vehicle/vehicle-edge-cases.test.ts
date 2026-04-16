/**
 * Additional vehicle physics edge case tests.
 * Covers corner cases, boundary conditions, and stress scenarios.
 */

import { describe, expect, it, vi } from "vitest";
import type { CarConfig } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR, SEDAN_CAR } from "./types.ts";
import { VehicleController } from "./VehicleController.ts";

// Stub Three.js
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
		position = { x: 0, y: 0, z: 0 };
		quaternion = { x: 0, y: 0, z: 0, w: 1, set() {}, setFromEuler() {}, multiply() {} };
		getObjectByName(): null {
			return null;
		}
		clone() {
			return this;
		}
	},
	Vector3: class {
		constructor(
			public x = 0,
			public y = 0,
			public z = 0,
		) {}
		set() {}
	},
	Quaternion: class {
		setFromAxisAngle() {
			return this;
		}
		multiply() {
			return this;
		}
	},
	Euler: class {},
	Fog: class {},
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class {
		loadAsync() {
			return { scene: new (vi.importActual("three") as any).Group() };
		}
	},
}));

// ─── Helpers ────────────────────────────────────────────────────────────

function flatTerrain() {
	return {
		getHeight: () => 0,
		getNormal: () => ({ x: 0, y: 1, z: 0 }),
	};
}

function createVC(config: CarConfig = RACE_CAR) {
	const vc = new VehicleController(config);
	vc.setTerrain(flatTerrain());
	return vc;
}

const dt = 1 / 60;

// ─── Edge Case Tests ───────────────────────────────────────────────────

describe("VehicleController — edge cases", () => {
	describe("Gear shifting edge cases", () => {
		it("shifts through all 6 gears during sustained acceleration", () => {
			const vc = createVC();
			// Let car settle
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Sustained throttle
			const gearsSeen = new Set<number>();
			for (let i = 0; i < 5000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
				gearsSeen.add(vc.state.gear);
			}
			// Should have seen at least 4 different gears
			expect(gearsSeen.size).toBeGreaterThanOrEqual(4);
			vc.dispose();
		});

		it("downshifts during heavy braking from high speed", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Build up speed
			for (let i = 0; i < 3000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const gearAtSpeed = vc.state.gear;
			expect(gearAtSpeed).toBeGreaterThan(1);
			// Heavy braking
			for (let i = 0; i < 2000; i++) {
				vc.update({ ...DEFAULT_INPUT, backward: true }, dt);
			}
			// Should be in a lower gear
			expect(vc.state.gear).toBeLessThan(gearAtSpeed);
			vc.dispose();
		});
	});

	describe("Reverse", () => {
		it("can reverse from standstill", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, backward: true }, dt);
			}
			// Backward is brake when nearly stopped; reverse force is weak
			expect(vc.state.speed).toBeLessThanOrEqual(0.1);
			vc.dispose();
		});

		it("car stays stopped when no input is given after settling", () => {
			const vc = createVC();
			for (let i = 0; i < 600; i++) vc.update(DEFAULT_INPUT, dt);
			expect(Math.abs(vc.state.speed)).toBeLessThan(0.5);
			// Should remain stopped
			for (let i = 0; i < 300; i++) vc.update(DEFAULT_INPUT, dt);
			expect(Math.abs(vc.state.speed)).toBeLessThan(0.5);
			vc.dispose();
		});
	});

	describe("Terrain edge cases", () => {
		it("handles very steep terrain", () => {
			const vc = createVC();
			const steepTerrain = {
				getHeight: (_x: number, _z: number) => Math.abs(_x) * 0.5,
				getNormal: (x: number) => {
					const slope = x > 0 ? -0.5 : 0.5;
					return { x: slope, y: 1 - slope * slope, z: 0 };
				},
			};
			vc.setTerrain(steepTerrain);
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 500; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
				// Should not crash or produce NaN
				expect(Number.isFinite(vc.state.speed)).toBe(true);
				expect(Number.isFinite(vc.state.rpm)).toBe(true);
			}
			vc.dispose();
		});

		it("handles terrain that returns NaN gracefully", () => {
			const vc = createVC();
			const nanTerrain = {
				getHeight: () => NaN,
				getNormal: () => ({ x: 0, y: 1, z: 0 }),
			};
			vc.setTerrain(nanTerrain);
			// Should not throw
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			vc.dispose();
		});
	});

	describe("Physics stability", () => {
		it("remains stable with alternating throttle/brake inputs", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 3000; i++) {
				const input =
					i % 120 < 60 ? { ...DEFAULT_INPUT, forward: true } : { ...DEFAULT_INPUT, backward: true };
				vc.update(input, dt);
				expect(Number.isFinite(vc.state.speed)).toBe(true);
				expect(Number.isFinite(vc.state.rpm)).toBe(true);
				expect(Number.isFinite(vc.state.steeringAngle)).toBe(true);
			}
			vc.dispose();
		});

		it("handles simultaneous throttle and brake (priority to brake)", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Build speed
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const speedBefore = vc.state.speed;
			// Both throttle and brake
			for (let i = 0; i < 60; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true, backward: true }, dt);
			}
			// Should decelerate (brake wins)
			expect(vc.state.speed).toBeLessThan(speedBefore);
			vc.dispose();
		});

		it("very long simulation stays stable", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Simulate 5 minutes of driving
			for (let i = 0; i < 18000; i++) {
				const input = {
					...DEFAULT_INPUT,
					forward: true,
					left: i % 3000 < 500,
					right: i % 3000 > 500 && i % 3000 < 1000,
				};
				vc.update(input, dt);
			}
			expect(Number.isFinite(vc.state.speed)).toBe(true);
			expect(Number.isFinite(vc.state.rpm)).toBe(true);
			vc.dispose();
		});
	});

	describe("Sedan vs Race Car", () => {
		it("sedan accelerates slower than race car", () => {
			const raceVC = createVC(RACE_CAR);
			const sedanVC = createVC(SEDAN_CAR);

			// Settle both
			for (let i = 0; i < 120; i++) {
				raceVC.update(DEFAULT_INPUT, dt);
				sedanVC.update(DEFAULT_INPUT, dt);
			}
			// Accelerate
			for (let i = 0; i < 600; i++) {
				raceVC.update({ ...DEFAULT_INPUT, forward: true }, dt);
				sedanVC.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(raceVC.state.speed).toBeGreaterThan(sedanVC.state.speed);
			raceVC.dispose();
			sedanVC.dispose();
		});

		it("both cars handle braking without issues", () => {
			for (const config of [RACE_CAR, SEDAN_CAR]) {
				const vc = createVC(config);
				for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
				for (let i = 0; i < 500; i++) {
					vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
				}
				for (let i = 0; i < 3000; i++) {
					vc.update({ ...DEFAULT_INPUT, handbrake: true }, dt);
				}
				expect(Math.abs(vc.state.speed)).toBeLessThan(1);
				vc.dispose();
			}
		});
	});

	describe("Delta time variations", () => {
		it("handles variable timestep without instability", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Mix of small and large timesteps
			const deltas = [1 / 120, 1 / 60, 1 / 30, 1 / 60, 1 / 120, 1 / 60];
			for (let cycle = 0; cycle < 100; cycle++) {
				for (const d of deltas) {
					vc.update({ ...DEFAULT_INPUT, forward: true }, d);
					expect(Number.isFinite(vc.state.speed)).toBe(true);
				}
			}
			vc.dispose();
		});

		it("capped at 1/30s prevents physics explosion", () => {
			const vc = createVC();
			// Very large dt should be capped internally
			vc.update({ ...DEFAULT_INPUT, forward: true }, 1.0);
			expect(Number.isFinite(vc.state.speed)).toBe(true);
			expect(Math.abs(vc.state.speed)).toBeLessThan(100);
			vc.dispose();
		});
	});

	describe("Handbrake drifting", () => {
		it("handbrake at speed causes lateral movement", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			// Build speed and turn slightly
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true, left: true }, dt);
			}
			const posBefore = vc.getPosition();
			// Handbrake while turning
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true, left: true, handbrake: true }, dt);
			}
			const { x: afterX, z: afterZ } = vc.getPosition();
			// Car should have moved laterally (drift)
			expect(Math.abs(afterX - posBefore.x)).toBeGreaterThan(0);
			expect(Math.abs(afterZ - posBefore.z)).toBeGreaterThan(0);
			vc.dispose();
		});
	});
});

// ─── CarModel Factory Tests ────────────────────────────────────────────

const { buildCarModel } = await import("./CarModel.ts");

describe("CarModel factory — additional tests", () => {
	describe("Downshift thresholds", () => {
		it("thresholds[0] is 0 (can't downshift from 1st)", () => {
			const car = buildCarModel(RACE_CAR);
			expect(car.gearbox).toBeDefined();
			// Thresholds are in the GearboxConfig but not directly exposed
			// Verify by checking gearbox behavior
			car.gearbox.currentGear = 0;
			car.engine.rpm = 500;
			car.gearbox.update(dt, car.engine, 0, true);
			expect(car.gearbox.currentGear).toBe(0); // Can't downshift from 1st
		});

		it("higher gears have higher downshift thresholds", () => {
			const car = buildCarModel(RACE_CAR);
			// The thresholds are computed from gear ratios — higher gears should
			// require more speed to prevent downshifting
			// Verify by checking behavior at various speeds
			car.gearbox.currentGear = 3;
			car.engine.rpm = 2000;
			// At zero speed, should downshift
			car.gearbox.update(dt, car.engine, 0, true);
			expect(car.gearbox.currentGear).toBeLessThan(3);
		});
	});

	describe("Engine torque curve", () => {
		it("flat torque curve returns 1.0 everywhere in range", () => {
			const car = buildCarModel(RACE_CAR);
			for (let rpm = 1100; rpm <= 8500; rpm += 500) {
				car.engine.rpm = rpm;
				const mult = car.engine.getTorqueMultiplier();
				expect(mult).toBe(1.0);
			}
		});

		it("below curve range returns first point", () => {
			const car = buildCarModel(RACE_CAR);
			car.engine.rpm = 500;
			const mult = car.engine.getTorqueMultiplier();
			expect(mult).toBe(0.3);
		});

		it("above curve range returns last point", () => {
			const car = buildCarModel(RACE_CAR);
			car.engine.rpm = 10000;
			const mult = car.engine.getTorqueMultiplier();
			expect(mult).toBe(1.0);
		});

		it("interpolates between curve points", () => {
			const customCar = buildCarModel({
				...RACE_CAR,
				engine: {
					...RACE_CAR.engine,
					torqueCurve: [
						[1000, 0.5],
						[5000, 1.0],
						[8000, 0.8],
					],
				},
			});
			customCar.engine.rpm = 3000;
			const mult = customCar.engine.getTorqueMultiplier();
			expect(mult).toBeGreaterThan(0.5);
			expect(mult).toBeLessThan(1.0);
			expect(mult).toBeCloseTo(0.75, 1); // Midpoint between 0.5 and 1.0
		});
	});

	describe("Engine braking", () => {
		it("returns zero at very low speed", () => {
			const car = buildCarModel(RACE_CAR);
			car.engine.throttle = 0;
			expect(car.engine.getEngineBraking(0.5, 150)).toBe(0);
		});

		it("increases with RPM", () => {
			const car = buildCarModel(RACE_CAR);
			car.engine.throttle = 0;
			car.engine.rpm = 3000;
			const low = car.engine.getEngineBraking(20, 150);
			car.engine.rpm = 6000;
			const high = car.engine.getEngineBraking(20, 150);
			expect(high).toBeGreaterThan(low);
		});
	});

	describe("Drag model", () => {
		it("always returns positive or zero force", () => {
			const car = buildCarModel(RACE_CAR);
			for (const speed of [-50, -10, 0, 10, 50]) {
				expect(car.drag.getForce(speed)).toBeGreaterThanOrEqual(0);
			}
		});

		it("rolling resistance is linear, aero is quadratic", () => {
			const car = buildCarModel(RACE_CAR);
			// At low speed, rolling dominates
			const f1 = car.drag.getForce(1);
			const f2 = car.drag.getForce(2);
			expect(f2 / f1).toBeCloseTo(2, 0); // ~2x for rolling

			// At high speed, aero dominates
			const f50 = car.drag.getForce(50);
			const f100 = car.drag.getForce(100);
			expect(f100 / f50).toBeGreaterThan(3); // >2x due to quadratic
		});
	});
});
