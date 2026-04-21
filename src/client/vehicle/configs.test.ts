import { describe, expect, it } from "vitest";
import { DEFAULT_CAR_MODEL_SCHEMA, DEFAULT_OFF_ROAD, RACE_CAR, SEDAN_CAR, SPORTS_CAR } from "./configs.ts";

describe("Car Configs", () => {
	describe("RACE_CAR", () => {
		it("has AWD drivetrain", () => {
			expect(RACE_CAR.drivetrain).toBe("AWD");
		});

		it("has 6 gears", () => {
			expect(RACE_CAR.gearbox.gearRatios.length).toBe(6);
		});

		it("has high maxBrakeG", () => {
			expect(RACE_CAR.brakes.maxBrakeG).toBeGreaterThan(1.0);
		});

		it("has lower mass than sedan", () => {
			expect(RACE_CAR.chassis.mass).toBeLessThan(SEDAN_CAR.chassis.mass);
		});

		it("torque curve covers idle to maxRPM", () => {
			const curve = RACE_CAR.engine.torqueCurve;
			expect(curve[0][0]).toBe(RACE_CAR.engine.idleRPM);
			expect(curve[curve.length - 1][0]).toBe(RACE_CAR.engine.maxRPM);
		});

		it("gear ratios are decreasing (higher gear = lower ratio)", () => {
			for (let i = 1; i < RACE_CAR.gearbox.gearRatios.length; i++) {
				expect(RACE_CAR.gearbox.gearRatios[i]).toBeLessThan(RACE_CAR.gearbox.gearRatios[i - 1]);
			}
		});
	});

	describe("SEDAN_CAR", () => {
		it("has 6 gears", () => {
			expect(SEDAN_CAR.gearbox.gearRatios.length).toBe(6);
		});

		it("has higher mass than race car", () => {
			expect(SEDAN_CAR.chassis.mass).toBeGreaterThan(RACE_CAR.chassis.mass);
		});

		it("has lower peak friction than race car", () => {
			expect(SEDAN_CAR.tires.peakFriction).toBeLessThan(RACE_CAR.tires.peakFriction);
		});

		it("has modelScale of 1", () => {
			expect(SEDAN_CAR.modelScale).toBe(1);
		});

		it("has 4 wheel positions", () => {
			expect(SEDAN_CAR.chassis.wheelPositions.length).toBe(4);
		});
	});

	describe("SPORTS_CAR (AE86)", () => {
		it("is RWD", () => {
			expect(SPORTS_CAR.drivetrain).toBe("RWD");
		});

		it("has 5 gears", () => {
			expect(SPORTS_CAR.gearbox.gearRatios.length).toBe(5);
		});

		it("has much higher mass than arcade cars", () => {
			expect(SPORTS_CAR.chassis.mass).toBe(1000);
			expect(SPORTS_CAR.chassis.mass).toBeGreaterThan(SEDAN_CAR.chassis.mass * 3);
		});

		it("has modelScale of 2.1", () => {
			expect(SPORTS_CAR.modelScale).toBe(2.1);
		});

		it("has detailed torque curve with 6 points", () => {
			expect(SPORTS_CAR.engine.torqueCurve.length).toBe(6);
		});

		it("has weightFront set", () => {
			expect(SPORTS_CAR.chassis.weightFront).toBeDefined();
			expect(SPORTS_CAR.chassis.weightFront).toBe(0.53);
		});

		it("has longer wheelbase than arcade cars", () => {
			expect(SPORTS_CAR.chassis.wheelBase).toBe(2.48);
			expect(SPORTS_CAR.chassis.wheelBase).toBeGreaterThan(SEDAN_CAR.chassis.wheelBase);
		});
	});

	describe("DEFAULT_OFF_ROAD", () => {
		it("has positive dragPerWheel", () => {
			expect(DEFAULT_OFF_ROAD.dragPerWheel).toBeGreaterThan(0);
		});

		it("has positive minSpeed", () => {
			expect(DEFAULT_OFF_ROAD.minSpeed).toBeGreaterThan(0);
		});
	});

	describe("DEFAULT_CAR_MODEL_SCHEMA", () => {
		it("has 4 wheel markers", () => {
			expect(DEFAULT_CAR_MODEL_SCHEMA.markers.wheels.length).toBe(4);
		});

		it("has physicsMarker defined", () => {
			expect(DEFAULT_CAR_MODEL_SCHEMA.markers.physicsMarker).toBe("PhysicsMarker");
		});

		it("has headlight and taillight materials", () => {
			expect(DEFAULT_CAR_MODEL_SCHEMA.materials.headlight).toBeDefined();
			expect(DEFAULT_CAR_MODEL_SCHEMA.materials.taillight).toBeDefined();
		});
	});

	describe("config consistency", () => {
		it("all configs have required fields", () => {
			for (const car of [RACE_CAR, SEDAN_CAR, SPORTS_CAR]) {
				expect(car.name).toBeTruthy();
				expect(car.engine.torqueNm).toBeGreaterThan(0);
				expect(car.engine.idleRPM).toBeGreaterThan(0);
				expect(car.engine.maxRPM).toBeGreaterThan(car.engine.idleRPM);
				expect(car.chassis.mass).toBeGreaterThan(0);
				expect(car.chassis.wheelPositions.length).toBe(4);
				expect(car.chassis.halfExtents.length).toBe(3);
			}
		});
	});
});
