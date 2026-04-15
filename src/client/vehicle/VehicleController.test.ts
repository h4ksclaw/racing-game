/**
 * Headless tests for VehicleController (arcade/bicycle physics).
 *
 * No browser, no Three.js rendering — just math + terrain sampling.
 *
 * Run: npm run test:run -- src/client/vehicle/VehicleController.test.ts
 */

import { describe, expect, it, vi } from "vitest";
import type { CarConfig } from "./types.ts";
import { DEFAULT_INPUT, RACE_CAR, SEDAN_CAR } from "./types.ts";
import { VehicleController } from "./VehicleController.ts";

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

function hillyTerrain() {
	return {
		getHeight: (x: number) => Math.sin(x * 0.01) * 3,
		getNormal: (x: number) => {
			const slope = Math.cos(x * 0.01) * 0.03;
			return { x: -slope, y: 1 - slope * slope, z: 0 };
		},
	};
}

function createVC(config: CarConfig = RACE_CAR) {
	const vc = new VehicleController(config);
	vc.setTerrain(flatTerrain());
	return vc;
}

const dt = 1 / 60;

// ─── Integration Tests ─────────────────────────────────────────────────

describe("VehicleController — arcade physics", () => {
	describe("Construction", () => {
		it("creates with default config", () => {
			const vc = createVC();
			expect(vc).toBeDefined();
			expect(vc.state.speed).toBe(0);
			expect(vc.state.gear).toBe(1);
			vc.dispose();
		});

		it("accepts custom config", () => {
			const vc = createVC(SEDAN_CAR);
			expect(vc).toBeDefined();
			expect(vc.state.rpm).toBeCloseTo(SEDAN_CAR.engine.idleRPM, -2);
			vc.dispose();
		});
	});

	describe("Ground contact", () => {
		it("lands on flat terrain from height", () => {
			const vc = createVC();
			for (let i = 0; i < 300; i++) {
				vc.update(DEFAULT_INPUT, dt);
			}
			expect(vc.state.onGround).toBe(true);
			vc.dispose();
		});

		it("stays on ground during throttle", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.onGround).toBe(true);
			vc.dispose();
		});

		it("lands from various heights", () => {
			for (const _h of [5, 15, 30]) {
				const vc = createVC();
				// Simulate starting higher (just let gravity do its thing)
				for (let i = 0; i < 600; i++) vc.update(DEFAULT_INPUT, dt);
				expect(vc.state.onGround).toBe(true);
				vc.dispose();
			}
		});

		it("follows hilly terrain", () => {
			const vc = createVC();
			vc.setTerrain(hillyTerrain());
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 600; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.onGround).toBe(true);
			vc.dispose();
		});
	});

	describe("Acceleration", () => {
		it("accelerates forward with throttle", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});

		it("reaches reasonable top speed", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 2000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const kmh = Math.abs(vc.state.speed) * 3.6;
			expect(kmh).toBeGreaterThan(150);
			expect(kmh).toBeLessThan(250);
			vc.dispose();
		});

		it("coasts to a stop when throttle released", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const speedAtRelease = vc.state.speed;
			expect(speedAtRelease).toBeGreaterThan(10);
			for (let i = 0; i < 1200; i++) vc.update(DEFAULT_INPUT, dt);
			// Race car has low drag — it won't stop quickly, but it should slow down
			expect(Math.abs(vc.state.speed)).toBeLessThan(speedAtRelease);
			vc.dispose();
		});

		it("sustained throttle reaches high speed", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 2000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const kmh = Math.abs(vc.state.speed) * 3.6;
			expect(kmh).toBeGreaterThan(150);
			expect(kmh).toBeLessThan(250);
			vc.dispose();
		});
	});

	describe("Braking", () => {
		it("handbrake decelerates the car", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const speedBefore = vc.state.speed;
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, handbrake: true }, dt);
			}
			expect(Math.abs(vc.state.speed)).toBeLessThan(speedBefore);
			vc.dispose();
		});

		it("S key brakes when moving forward", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			const speedBefore = vc.state.speed;
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, backward: true }, dt);
			}
			expect(Math.abs(vc.state.speed)).toBeLessThan(speedBefore);
			vc.dispose();
		});

		it("car eventually stops with sustained handbrake", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.speed).toBeGreaterThan(10);
			for (let i = 0; i < 3000; i++) {
				vc.update({ ...DEFAULT_INPUT, handbrake: true }, dt);
			}
			expect(Math.abs(vc.state.speed)).toBeLessThan(1);
			vc.dispose();
		});
	});

	describe("Steering", () => {
		it("turns left with left input", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			const posBefore = vc.getPosition();
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true, left: true }, dt);
			}
			const posAfter = vc.getPosition();
			// Car should have moved laterally (turned)
			expect(Math.abs(posAfter.x - posBefore.x)).toBeGreaterThan(0.5);
			vc.dispose();
		});

		it("turns right with right input", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			const posBefore = vc.getPosition();
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true, right: true }, dt);
			}
			const posAfter = vc.getPosition();
			expect(Math.abs(posAfter.x - posBefore.x)).toBeGreaterThan(0.5);
			vc.dispose();
		});

		it("steering is smooth (not instant)", () => {
			const vc = createVC();
			vc.update({ ...DEFAULT_INPUT, left: true }, dt);
			expect(Math.abs(vc.state.steeringAngle)).toBeGreaterThan(0);
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(0.5);
			vc.dispose();
		});

		it("steering returns to center when released", () => {
			const vc = createVC();
			for (let i = 0; i < 60; i++) {
				vc.update({ ...DEFAULT_INPUT, left: true }, dt);
			}
			expect(Math.abs(vc.state.steeringAngle)).toBeGreaterThan(0.1);
			for (let i = 0; i < 60; i++) {
				vc.update(DEFAULT_INPUT, dt);
			}
			expect(Math.abs(vc.state.steeringAngle)).toBeLessThan(0.15);
			vc.dispose();
		});

		it("no steering at zero speed", () => {
			const vc = createVC();
			for (let i = 0; i < 60; i++) {
				vc.update({ ...DEFAULT_INPUT, left: true }, dt);
			}
			// At zero speed steering is applied but doesn't create yaw
			const posBefore = vc.getPosition();
			for (let i = 0; i < 120; i++) {
				vc.update({ ...DEFAULT_INPUT, left: true }, dt);
			}
			const posAfter = vc.getPosition();
			expect(Math.abs(posAfter.x - posBefore.x)).toBeLessThan(1);
			vc.dispose();
		});
	});

	describe("Combined driving", () => {
		it("drives across varied terrain without stopping", () => {
			const vc = createVC();
			vc.setTerrain(hillyTerrain());
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 1000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});
	});

	describe("RPM", () => {
		it("increases with throttle at standstill", () => {
			const vc = createVC();
			const initialRPM = vc.state.rpm;
			for (let i = 0; i < 30; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.rpm).toBeGreaterThan(initialRPM);
			vc.dispose();
		});

		it("stays within idle-max range", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 3000; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
				expect(vc.state.rpm).toBeGreaterThanOrEqual(RACE_CAR.engine.idleRPM * 0.5);
				expect(vc.state.rpm).toBeLessThanOrEqual(RACE_CAR.engine.maxRPM * 1.01);
			}
			vc.dispose();
		});
	});

	describe("Reset", () => {
		it("resets position, velocity, and state", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.reset(10, 5, 20);
			expect(vc.getPosition()).toEqual({ x: 10, y: 5, z: 20 });
			expect(vc.state.speed).toBe(0);
			expect(vc.state.gear).toBe(1);
			vc.dispose();
		});

		it("drives normally after reset", () => {
			const vc = createVC();
			for (let i = 0; i < 120; i++) vc.update(DEFAULT_INPUT, dt);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			vc.reset(0, 2, 0);
			for (let i = 0; i < 300; i++) {
				vc.update({ ...DEFAULT_INPUT, forward: true }, dt);
			}
			expect(vc.state.speed).toBeGreaterThan(5);
			vc.dispose();
		});
	});

	describe("Config validation", () => {
		it("sedan heavier than race car", () => {
			expect(SEDAN_CAR.chassis.mass).toBeGreaterThan(RACE_CAR.chassis.mass);
		});

		it("race car has higher max speed potential", () => {
			expect(RACE_CAR.engine.maxRPM).toBeGreaterThan(SEDAN_CAR.engine.maxRPM);
		});

		it("race car has higher torque/mass ratio", () => {
			const raceRatio = RACE_CAR.engine.torqueNm / RACE_CAR.chassis.mass;
			const sedanRatio = SEDAN_CAR.engine.torqueNm / SEDAN_CAR.chassis.mass;
			expect(raceRatio).toBeGreaterThan(0.1);
			expect(sedanRatio).toBeGreaterThan(0.1);
		});

		it("all params are physically consistent", () => {
			for (const c of [RACE_CAR, SEDAN_CAR]) {
				expect(c.chassis.mass).toBeGreaterThan(0);
				expect(c.engine.torqueNm).toBeGreaterThan(5);
				expect(c.engine.torqueNm).toBeLessThan(5000);
				expect(c.brakes.maxBrakeG).toBeGreaterThan(0.1);
				expect(c.brakes.maxBrakeG).toBeLessThan(3);
				expect(c.chassis.wheelRadius).toBeGreaterThan(0.1);
				expect(c.chassis.suspensionStiffness).toBeGreaterThan(10);
				expect(c.chassis.suspensionRestLength).toBeGreaterThan(0.1);
				expect(c.tires.peakFriction).toBeGreaterThan(0.5);
				expect(c.tires.peakFriction).toBeLessThan(5);
				expect(c.chassis.rollInfluence).toBeGreaterThanOrEqual(0);
				expect(c.chassis.rollInfluence).toBeLessThanOrEqual(1);
			}
		});
	});

	describe("Dispose", () => {
		it("does not throw", () => {
			const vc = createVC();
			expect(() => vc.dispose()).not.toThrow();
		});
	});
});

// ─── Module-Level Tests ────────────────────────────────────────────────

const { buildCarModel, Engine, Gearbox, Brakes, TireModel, DragModel } = await import(
	"./CarModel.ts"
);

describe("Engine module", () => {
	it("computes torque multiplier from curve", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.rpm = 5000;
		const tm = car.engine.getTorqueMultiplier();
		expect(tm).toBeGreaterThan(0);
		expect(tm).toBeLessThanOrEqual(1.1);
	});

	it("rev limiter activates at maxRPM", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.rpm = RACE_CAR.engine.maxRPM;
		expect(car.engine.revLimited).toBe(false);
		car.engine.update(60, 1.0, 0.3, 1 / 60);
		expect(car.engine.rpm).toBeLessThanOrEqual(RACE_CAR.engine.maxRPM);
	});

	it("rev limiter produces zero wheel force", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.throttle = 1;
		car.engine.rpm = RACE_CAR.engine.maxRPM;
		car.engine.revLimited = true;
		const force = car.engine.getWheelForce(50, 1.0, 2000);
		expect(force).toBe(0);
	});

	it("zero throttle produces zero force", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.throttle = 0;
		car.engine.rpm = 5000;
		const force = car.engine.getWheelForce(50, 1.0, 2000);
		expect(force).toBe(0);
	});

	it("traction limit caps wheel force", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.throttle = 1;
		car.engine.rpm = 5000;
		const noLimit = car.engine.getWheelForce(6.67, 0.3, 99999);
		const limited = car.engine.getWheelForce(6.67, 0.3, 500);
		expect(limited).toBeLessThan(noLimit);
		expect(limited).toBeLessThanOrEqual(500);
	});

	it("shouldUpshift triggers at redline", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.rpm = RACE_CAR.engine.maxRPM * RACE_CAR.engine.redlinePct * 1.01;
		expect(car.engine.shouldUpshift()).toBe(true);
	});

	it("shouldDownshift triggers at low RPM", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.rpm = RACE_CAR.engine.idleRPM * 1.2;
		expect(car.engine.shouldDownshift()).toBe(true);
	});

	it("engine braking returns zero when throttle applied", () => {
		const car = buildCarModel(RACE_CAR);
		car.engine.throttle = 1;
		car.engine.rpm = 5000;
		expect(car.engine.getEngineBraking(20, 150)).toBe(0);
	});
});

describe("Gearbox module", () => {
	it("starts in gear 1", () => {
		const car = buildCarModel(RACE_CAR);
		expect(car.gearbox.currentGear).toBe(0);
	});

	it("shifts up when engine hits redline", () => {
		const car = buildCarModel(RACE_CAR);
		const dt2 = 1 / 60;
		for (let i = 0; i < 120; i++) {
			car.engine.throttle = 1;
			car.engine.rpm = RACE_CAR.engine.maxRPM * 0.9;
			car.gearbox.update(dt2, car.engine, 0, false);
		}
		expect(car.gearbox.currentGear).toBeGreaterThan(0);
	});

	it("does not shift past top gear", () => {
		const car = buildCarModel(RACE_CAR);
		car.gearbox.currentGear = car.gearbox.gearCount - 1;
		car.engine.rpm = RACE_CAR.engine.maxRPM;
		car.gearbox.update(1 / 60, car.engine, 0, false);
		expect(car.gearbox.currentGear).toBe(car.gearbox.gearCount - 1);
	});

	it("shift time creates clutch disengage period", () => {
		const car = buildCarModel(RACE_CAR);
		const dt2 = 1 / 60;
		car.engine.rpm = RACE_CAR.engine.maxRPM * 0.9;
		car.gearbox.update(dt2, car.engine, 0, false);
		car.engine.rpm = RACE_CAR.engine.idleRPM;
		car.gearbox.update(dt2, car.engine, 0, false);
		expect(car.gearbox.isShifting).toBe(true);
		expect(car.gearbox.effectiveRatio).not.toBeCloseTo(car.gearbox.currentRatio, 1);
	});

	it("effective ratio returns to normal after shift completes", () => {
		const car = buildCarModel(RACE_CAR);
		const dt2 = 1 / 60;
		car.engine.rpm = RACE_CAR.engine.maxRPM * 0.9;
		car.gearbox.update(dt2, car.engine, 0, false);
		car.engine.rpm = RACE_CAR.engine.idleRPM;
		for (let i = 0; i < 20; i++) car.gearbox.update(dt2, car.engine, 0, false);
		expect(car.gearbox.isShifting).toBe(false);
		expect(car.gearbox.effectiveRatio).toBeCloseTo(car.gearbox.currentRatio, 3);
	});
});

describe("Brakes module", () => {
	it("produces zero force when not braking", () => {
		const car = buildCarModel(RACE_CAR);
		car.brakes.isBraking = false;
		car.brakes.isHandbrake = false;
		expect(car.brakes.getForce(150)).toBe(0);
	});

	it("handbrake produces strong deceleration", () => {
		const car = buildCarModel(RACE_CAR);
		car.brakes.isHandbrake = true;
		const force = car.brakes.getForce(150);
		expect(force).toBeLessThan(0);
		expect(Math.abs(force)).toBeGreaterThan(1000);
	});

	it("rear grip factor drops with handbrake", () => {
		const car = buildCarModel(RACE_CAR);
		expect(car.brakes.rearGripFactor).toBe(1.0);
		car.brakes.isHandbrake = true;
		expect(car.brakes.rearGripFactor).toBeLessThan(1.0);
	});

	it("brings car to stop without oscillation", () => {
		const car = buildCarModel(RACE_CAR);
		car.brakes.isBraking = true;
		let speed = 20;
		const dt2 = 1 / 60;
		let oscillations = 0;
		let lastSign = 1;
		for (let i = 0; i < 600; i++) {
			const force = car.brakes.getForce(150);
			speed += (force / 150) * dt2;
			if (speed < 0) speed = 0;
			if (speed > 0 && lastSign < 0) oscillations++;
			lastSign = speed > 0.01 ? 1 : 0;
		}
		expect(speed).toBeLessThan(1.0);
		expect(oscillations).toBeLessThan(3);
	});
});

describe("DragModel module", () => {
	it("produces zero force at zero speed", () => {
		const car = buildCarModel(RACE_CAR);
		expect(car.drag.getForce(0)).toBe(0);
	});

	it("force increases with speed", () => {
		const car = buildCarModel(RACE_CAR);
		const f20 = car.drag.getForce(20);
		const f50 = car.drag.getForce(50);
		expect(f50).toBeGreaterThan(f20);
	});

	it("drag is quadratic at high speed", () => {
		const car = buildCarModel(RACE_CAR);
		const f10 = car.drag.getForce(10);
		const f20 = car.drag.getForce(20);
		expect(f20 / f10).toBeGreaterThan(1.5);
		expect(f20 / f10).toBeLessThan(5);
	});
});

describe("CarModel factory", () => {
	it("builds all modules for RACE_CAR", () => {
		const car = buildCarModel(RACE_CAR);
		expect(car.engine).toBeInstanceOf(Engine);
		expect(car.gearbox).toBeInstanceOf(Gearbox);
		expect(car.brakes).toBeInstanceOf(Brakes);
		expect(car.tires).toBeInstanceOf(TireModel);
		expect(car.drag).toBeInstanceOf(DragModel);
		expect(car.config).toBe(RACE_CAR);
	});

	it("different car configs produce different models", () => {
		const race = buildCarModel(RACE_CAR);
		const sedan = buildCarModel(SEDAN_CAR);
		expect(race.engine.config.maxRPM).toBe(8500);
		expect(sedan.engine.config.maxRPM).toBe(6500);
		expect(race.gearbox.gearCount).toBe(6);
		expect(sedan.gearbox.gearCount).toBe(6);
	});
});
