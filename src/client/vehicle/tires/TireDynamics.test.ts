/**
 * TireDynamics unit tests.
 *
 * Tests the tire slip model, handbrake grip reduction, COM calculation,
 * drift torque computation, and weight distribution — all without
 * needing a full Rapier physics world.
 */

import { describe, expect, it } from "vitest";
import { SPORTS_CAR } from "../configs.ts";
import type { TireDynamicsConfig } from "../tires/TireDynamics.ts";
import { TireDynamics } from "../tires/TireDynamics.ts";

// ─── Mock vehicle for wheel state reading ─────────────────────────────

function makeMockVehicle(overrides?: {
	suspensionForces?: number[];
	sideImpulses?: number[];
	forwardImpulses?: number[];
	inContact?: boolean[];
}) {
	const sf = overrides?.suspensionForces ?? [2500, 2500, 2200, 2200];
	const si = overrides?.sideImpulses ?? [0, 0, 0, 0];
	const fi = overrides?.forwardImpulses ?? [0, 0, 0, 0];
	const ic = overrides?.inContact ?? [true, true, true, true];

	return {
		wheelIsInContact: (i: number) => ic[i],
		wheelForwardImpulse: (i: number) => (ic[i] ? fi[i] : 0),
		wheelSideImpulse: (i: number) => (ic[i] ? si[i] : 0),
		wheelSuspensionForce: (i: number) => (ic[i] ? sf[i] : 0),
		wheelContactPoint: (i: number) => (ic[i] ? { x: 0, y: 0, z: 0 } : null),
	};
}

function makeConfig(overrides?: Partial<TireDynamicsConfig>): TireDynamicsConfig {
	return {
		chassis: SPORTS_CAR.chassis,
		tires: SPORTS_CAR.tires,
		wheelIndices: { fl: 0, fr: 1, rl: 2, rr: 3 },
		...overrides,
	};
}

describe("TireDynamics", () => {
	describe("Wheel state reading", () => {
		it("reads suspension forces correctly", () => {
			const td = new TireDynamics(makeConfig());
			const mock = makeMockVehicle({
				suspensionForces: [3000, 3000, 2000, 2000],
			});
			td.readWheelStates(mock);

			expect(td.totalLoad).toBe(10000);
			expect(td.frontLoad).toBe(6000);
			expect(td.rearLoad).toBe(4000);
			expect(td.wheelStates).toHaveLength(4);
		});

		it("reads contact state correctly", () => {
			const td = new TireDynamics(makeConfig());
			const mock = makeMockVehicle({
				inContact: [true, true, false, false],
			});
			td.readWheelStates(mock);

			expect(td.wheelStates[0].isInContact).toBe(true);
			expect(td.wheelStates[2].isInContact).toBe(false);
		});

		it("zero load when no wheels in contact", () => {
			const td = new TireDynamics(makeConfig());
			const mock = makeMockVehicle({
				inContact: [false, false, false, false],
			});
			td.readWheelStates(mock);

			expect(td.totalLoad).toBe(0);
			expect(td.frontLoad).toBe(0);
			expect(td.rearLoad).toBe(0);
		});

		it("classifies wheels as front/rear correctly", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());

			expect(td.wheelStates[0].isFront).toBe(true);
			expect(td.wheelStates[1].isFront).toBe(true);
			expect(td.wheelStates[2].isFront).toBe(false);
			expect(td.wheelStates[3].isFront).toBe(false);
		});

		it("reads forward and side impulses", () => {
			const td = new TireDynamics(makeConfig());
			const mock = makeMockVehicle({
				forwardImpulses: [100, -50, 200, 200],
				sideImpulses: [50, 60, 40, 45],
			});
			td.readWheelStates(mock);

			expect(td.wheelStates[0].forwardImpulse).toBe(100);
			expect(td.wheelStates[1].sideImpulse).toBe(60);
			expect(td.wheelStates[2].forwardImpulse).toBe(200);
		});
	});

	describe("Handbrake grip reduction", () => {
		it("starts at full grip (multiplier = 1.0)", () => {
			const td = new TireDynamics(makeConfig());
			expect(td.rearGripMultiplier).toBe(1.0);
		});

		it("reduces grip when handbrake is active at speed", () => {
			const td = new TireDynamics(makeConfig());
			const dt = 1 / 60;

			// Simulate 0.5 seconds of handbrake at 20 m/s
			for (let i = 0; i < 30; i++) {
				td.updateHandbrake(true, 20, dt);
			}

			expect(td.rearGripMultiplier).toBeLessThan(0.5);
		});

		it("reaches near-minimum grip after lock time", () => {
			const td = new TireDynamics(makeConfig());
			const dt = 1 / 60;

			// Simulate 1 second of handbrake
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, dt);
			}

			expect(td.rearGripMultiplier).toBeLessThan(0.25);
			expect(td.rearGripMultiplier).toBeGreaterThan(0);
		});

		it("does not reduce grip at very low speed", () => {
			const td = new TireDynamics(makeConfig());
			const dt = 1 / 60;

			for (let i = 0; i < 120; i++) {
				td.updateHandbrake(true, 0.5, dt); // 0.5 m/s — below threshold
			}

			expect(td.rearGripMultiplier).toBeGreaterThan(0.9);
		});

		it("recovers grip when handbrake is released", () => {
			const td = new TireDynamics(makeConfig());
			const dt = 1 / 60;

			// Lock wheels
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, dt);
			}
			const lockedGrip = td.rearGripMultiplier;
			expect(lockedGrip).toBeLessThan(0.3);

			// Release and wait
			for (let i = 0; i < 120; i++) {
				td.updateHandbrake(false, 15, dt);
			}

			expect(td.rearGripMultiplier).toBeGreaterThan(lockedGrip);
		});

		it("grip recovery takes longer than lock time", () => {
			const td = new TireDynamics(makeConfig());
			const dt = 1 / 60;

			// Lock for 0.15s (HANDRAKE_LOCK_TIME)
			for (let i = 0; i < 9; i++) {
				td.updateHandbrake(true, 20, dt);
			}
			const gripAtLock = td.rearGripMultiplier;

			// Release for same duration (0.15s)
			for (let i = 0; i < 9; i++) {
				td.updateHandbrake(false, 15, dt);
			}

			// Grip should NOT have fully recovered in the same time
			expect(td.rearGripMultiplier).toBeLessThan(0.95);
			expect(td.rearGripMultiplier).toBeGreaterThan(gripAtLock);
		});
	});

	describe("Drift yaw torque", () => {
		it("zero torque when not drifting", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			td.updateHandbrake(false, 20, 1 / 60);

			const torque = td.computeDriftYawTorque(20, 0, 0.3);
			expect(torque).toBe(0);
		});

		it("produces torque in steering direction when drifting", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(
				makeMockVehicle({
					suspensionForces: [3000, 3000, 2500, 2500],
				}),
			);

			// Lock rear wheels
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, 1 / 60);
			}

			const torqueLeft = td.computeDriftYawTorque(20, 0, 0.3);
			const torqueRight = td.computeDriftYawTorque(20, 0, -0.3);

			expect(torqueLeft).not.toBe(0);
			expect(torqueRight).not.toBe(0);
			expect(Math.sign(torqueLeft)).toBe(Math.sign(0.3)); // same as steer
			expect(Math.sign(torqueRight)).toBe(Math.sign(-0.3));
		});

		it("torque increases with speed", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, 1 / 60);
			}

			const torqueSlow = Math.abs(td.computeDriftYawTorque(5, 0, 0.3));
			const torqueFast = Math.abs(td.computeDriftYawTorque(20, 0, 0.3));

			expect(torqueFast).toBeGreaterThan(torqueSlow);
		});

		it("zero torque at very low speed", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, 1 / 60);
			}

			const torque = td.computeDriftYawTorque(0.5, 0, 0.3);
			expect(torque).toBe(0);
		});

		it("yaw damping prevents infinite spin", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, 1 / 60);
			}

			const torqueZero = Math.abs(td.computeDriftYawTorque(20, 0, 0.3));
			const torqueFast = Math.abs(td.computeDriftYawTorque(20, 3.5, 0.3));

			expect(torqueFast).toBeLessThan(torqueZero);
		});

		it("torque is clamped to reasonable maximum", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(
				makeMockVehicle({
					suspensionForces: [10000, 10000, 10000, 10000],
				}),
			);
			for (let i = 0; i < 120; i++) {
				td.updateHandbrake(true, 50, 1 / 60);
			}

			const torque = td.computeDriftYawTorque(50, 0, 0.55);
			const maxExpected = SPORTS_CAR.chassis.mass * 9.81 * SPORTS_CAR.chassis.cgHeight * 0.5;

			expect(Math.abs(torque)).toBeLessThanOrEqual(maxExpected * 1.01); // small tolerance
		});
	});

	describe("Center of mass calculation", () => {
		it("COM is forward of center for front-heavy car", () => {
			const td = new TireDynamics(makeConfig());
			const com = td.computeLocalCOM();

			// SPORTS_CAR has weightFront=0.53, so COM should be slightly forward
			// Front wheels at z=1.22, rear at z=-1.26, wheelbase=2.48
			// COM at: rearZ + wheelbase * wf = -1.26 + 2.48 * 0.53 = 0.054
			expect(com.z).toBeGreaterThan(0); // forward of geometric center
			expect(com.z).toBeLessThan(0.5);
		});

		it("COM height matches cgHeight config", () => {
			const td = new TireDynamics(makeConfig());
			const com = td.computeLocalCOM();

			// cgHeight = 0.35, halfExtents[1] = 0.67
			// comY = cgHeight - halfExtents[1] = 0.35 - 0.67 = -0.32
			const expectedY = SPORTS_CAR.chassis.cgHeight - SPORTS_CAR.chassis.halfExtents[1];
			expect(com.y).toBeCloseTo(expectedY, 2);
		});

		it("COM x is zero (symmetric car)", () => {
			const td = new TireDynamics(makeConfig());
			const com = td.computeLocalCOM();
			expect(com.x).toBe(0);
		});

		it("COM moves rearward for rear-heavy car", () => {
			const td = new TireDynamics(
				makeConfig({
					chassis: {
						...SPORTS_CAR.chassis,
						weightFront: 0.4,
					},
				}),
			);
			const comNormal = new TireDynamics(makeConfig()).computeLocalCOM();
			const comRear = td.computeLocalCOM();

			expect(comRear.z).toBeLessThan(comNormal.z);
		});

		it("COM moves forward for front-heavy car", () => {
			const td = new TireDynamics(
				makeConfig({
					chassis: {
						...SPORTS_CAR.chassis,
						weightFront: 0.65,
					},
				}),
			);
			const comNormal = new TireDynamics(makeConfig()).computeLocalCOM();
			const comFront = td.computeLocalCOM();

			expect(comFront.z).toBeGreaterThan(comNormal.z);
		});
	});

	describe("State snapshot", () => {
		it("isDrifting is true when handbrake active and grip reduced", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			for (let i = 0; i < 60; i++) {
				td.updateHandbrake(true, 20, 1 / 60);
			}

			const state = td.state;
			expect(state.isDrifting).toBe(true);
			expect(state.driftFactor).toBeGreaterThan(0.5);
		});

		it("isDrifting is false when not handbraking", () => {
			const td = new TireDynamics(makeConfig());
			td.readWheelStates(makeMockVehicle());
			td.updateHandbrake(false, 20, 1 / 60);

			expect(td.state.isDrifting).toBe(false);
		});

		it("driftFactor is 0 at full grip", () => {
			const td = new TireDynamics(makeConfig());
			expect(td.state.driftFactor).toBe(0);
		});

		it("localCOM is in state snapshot", () => {
			const td = new TireDynamics(makeConfig());
			td.computeLocalCOM();

			expect(td.state.localCOM).toEqual(td.computeLocalCOM());
		});
	});
});
