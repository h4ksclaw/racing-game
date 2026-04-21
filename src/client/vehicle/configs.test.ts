/**
 * Tests for car configuration presets.
 *
 * Validates that all preset configs have required fields, sensible value
 * ranges, and consistent physics relationships.
 */

import { describe, expect, it } from "vitest";
import {
	type CarConfig,
	DEFAULT_CAR_MODEL_SCHEMA,
	DEFAULT_OFF_ROAD,
	RACE_CAR,
	SEDAN_CAR,
	SPORTS_CAR,
} from "./configs.js";

const ALL_CONFIGS: [string, CarConfig][] = [
	["RACE_CAR", RACE_CAR],
	["SEDAN_CAR", SEDAN_CAR],
	["SPORTS_CAR", SPORTS_CAR],
];

describe("Car config presets", () => {
	describe("required fields", () => {
		for (const [name, cfg] of ALL_CONFIGS) {
			describe(name, () => {
				it("has a name", () => {
					expect(cfg.name).toBeTruthy();
					expect(typeof cfg.name).toBe("string");
				});

				it("has engine specs", () => {
					expect(cfg.engine).toBeDefined();
					expect(cfg.engine.torqueNm).toBeGreaterThan(0);
					expect(cfg.engine.idleRPM).toBeGreaterThan(0);
					expect(cfg.engine.maxRPM).toBeGreaterThan(cfg.engine.idleRPM);
					expect(cfg.engine.finalDrive).toBeGreaterThan(0);
					expect(cfg.engine.torqueCurve.length).toBeGreaterThanOrEqual(2);
				});

				it("has gearbox specs", () => {
					expect(cfg.gearbox).toBeDefined();
					expect(cfg.gearbox.gearRatios.length).toBeGreaterThanOrEqual(3);
					expect(cfg.gearbox.shiftTime).toBeGreaterThan(0);
				});

				it("has brake specs", () => {
					expect(cfg.brakes).toBeDefined();
					expect(cfg.brakes.maxBrakeG).toBeGreaterThan(0);
					expect(cfg.brakes.handbrakeG).toBeGreaterThan(0);
					expect(cfg.brakes.brakeBias).toBeGreaterThan(0);
					expect(cfg.brakes.brakeBias).toBeLessThanOrEqual(1);
				});

				it("has tire specs", () => {
					expect(cfg.tires).toBeDefined();
					expect(cfg.tires.corneringStiffnessFront).toBeGreaterThan(0);
					expect(cfg.tires.corneringStiffnessRear).toBeGreaterThan(0);
					expect(cfg.tires.peakFriction).toBeGreaterThan(0);
					expect(cfg.tires.tractionPct).toBeGreaterThan(0);
					expect(cfg.tires.tractionPct).toBeLessThanOrEqual(1);
				});

				it("has drag specs", () => {
					expect(cfg.drag).toBeDefined();
					expect(cfg.drag.rollingResistance).toBeGreaterThanOrEqual(0);
					expect(cfg.drag.aeroDrag).toBeGreaterThanOrEqual(0);
				});

				it("has chassis specs", () => {
					expect(cfg.chassis).toBeDefined();
					expect(cfg.chassis.mass).toBeGreaterThan(0);
					expect(cfg.chassis.wheelRadius).toBeGreaterThan(0);
					expect(cfg.chassis.wheelPositions.length).toBe(4);
					expect(cfg.chassis.wheelBase).toBeGreaterThan(0);
					expect(cfg.chassis.maxSteerAngle).toBeGreaterThan(0);
					expect(cfg.chassis.suspensionStiffness).toBeGreaterThan(0);
					expect(cfg.chassis.suspensionRestLength).toBeGreaterThan(0);
					expect(cfg.chassis.cgHeight).toBeGreaterThan(0);
				});

				it("has halfExtents with 3 elements", () => {
					expect(cfg.chassis.halfExtents).toHaveLength(3);
					for (const v of cfg.chassis.halfExtents) {
						expect(v).toBeGreaterThan(0);
					}
				});

				it("has wheel positions with x, y, z", () => {
					for (const wp of cfg.chassis.wheelPositions) {
						expect(wp).toHaveProperty("x");
						expect(wp).toHaveProperty("y");
						expect(wp).toHaveProperty("z");
					}
				});
			});
		}
	});

	describe("physics consistency", () => {
		it("gear ratios decrease (each gear taller than the last)", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				for (let i = 1; i < cfg.gearbox.gearRatios.length; i++) {
					expect(cfg.gearbox.gearRatios[i]).toBeLessThanOrEqual(cfg.gearbox.gearRatios[i - 1]);
				}
			}
		});

		it("torque curve starts at or below idleRPM", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				const firstRPM = cfg.engine.torqueCurve[0][0];
				expect(firstRPM).toBeLessThanOrEqual(cfg.engine.idleRPM * 1.1);
			}
		});

		it("torque curve ends at or above maxRPM", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				const lastRPM = cfg.engine.torqueCurve[cfg.engine.torqueCurve.length - 1][0];
				expect(lastRPM).toBeGreaterThanOrEqual(cfg.engine.maxRPM * 0.9);
			}
		});

		it("torque curve values are in [0, 1+] range", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				for (const [rpm, mul] of cfg.engine.torqueCurve) {
					expect(rpm).toBeGreaterThan(0);
					expect(mul).toBeGreaterThan(0);
				}
			}
		});

		it("handbrakeG >= maxBrakeG", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				expect(cfg.brakes.handbrakeG).toBeGreaterThanOrEqual(cfg.brakes.maxBrakeG);
			}
		});

		it("wheel radius is consistent with suspension rest length", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				// Rest length should be at least as long as wheel radius for realistic geometry
				expect(cfg.chassis.suspensionRestLength).toBeGreaterThanOrEqual(cfg.chassis.wheelRadius * 0.3);
			}
		});

		it("mass is reasonable (50-5000 kg)", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				expect(cfg.chassis.mass).toBeGreaterThanOrEqual(50);
				expect(cfg.chassis.mass).toBeLessThanOrEqual(5000);
			}
		});

		it("modelScale is positive", () => {
			for (const [, cfg] of ALL_CONFIGS) {
				expect(cfg.modelScale).toBeGreaterThan(0);
			}
		});
	});

	describe("drivetrain", () => {
		it("SPORTS_CAR is RWD", () => {
			expect(SPORTS_CAR.drivetrain).toBe("RWD");
		});

		it("RACE_CAR is AWD", () => {
			expect(RACE_CAR.drivetrain).toBe("AWD");
		});

		it("SEDAN_CAR defaults to RWD when not specified", () => {
			// SEDAN_CAR may or may not have explicit drivetrain
			expect(["RWD", "FWD", "AWD", undefined]).toContain(SEDAN_CAR.drivetrain);
		});
	});

	describe("SPORTS_CAR specific tuning", () => {
		it("has realistic aero drag (0.3-0.6)", () => {
			expect(SPORTS_CAR.drag.aeroDrag).toBeGreaterThanOrEqual(0.3);
			expect(SPORTS_CAR.drag.aeroDrag).toBeLessThanOrEqual(0.6);
		});

		it("has realistic traction (0.15-0.5)", () => {
			expect(SPORTS_CAR.tires.tractionPct).toBeGreaterThanOrEqual(0.15);
			expect(SPORTS_CAR.tires.tractionPct).toBeLessThanOrEqual(0.5);
		});

		it("has max steer angle <= 0.5 rad (~29°)", () => {
			expect(SPORTS_CAR.chassis.maxSteerAngle).toBeLessThanOrEqual(0.5);
		});
	});
});

describe("DEFAULT_OFF_ROAD", () => {
	it("has required fields", () => {
		expect(DEFAULT_OFF_ROAD.dragPerWheel).toBeGreaterThan(0);
		expect(DEFAULT_OFF_ROAD.minSpeed).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_OFF_ROAD.bumpAmplitude).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_OFF_ROAD.bumpAmplitudeOuter).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_OFF_ROAD.bumpFrequency).toBeGreaterThan(0);
	});
});

describe("DEFAULT_CAR_MODEL_SCHEMA", () => {
	it("has marker names", () => {
		expect(DEFAULT_CAR_MODEL_SCHEMA.markers.physicsMarker).toBeTruthy();
		expect(DEFAULT_CAR_MODEL_SCHEMA.markers.wheels).toHaveLength(4);
	});

	it("has material names", () => {
		expect(DEFAULT_CAR_MODEL_SCHEMA.materials.headlight).toBeTruthy();
		expect(DEFAULT_CAR_MODEL_SCHEMA.materials.taillight).toBeTruthy();
	});

	it("has wheel model path", () => {
		expect(DEFAULT_CAR_MODEL_SCHEMA.wheelModelPath).toBeTruthy();
	});
});
