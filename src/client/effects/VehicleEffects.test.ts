// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

// jsdom doesn't implement Canvas 2D
beforeAll(() => {
	HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
		createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		fillRect: vi.fn(),
	});
});

// Mock THREE.js and document for VehicleEffects (which creates TireSmoke -> ParticleSystem)
vi.mock("three", () => {
	const setUsage = vi.fn((u: number) => u);
	class BufferAttribute {
		setUsage = setUsage;
		needsUpdate = false;
	}
	class PlaneGeometry {
		setAttribute = vi.fn();
		attributes: Record<string, { needsUpdate: boolean }> = {};
		dispose = vi.fn();
	}
	class ShaderMaterial {
		uniforms = {};
		dispose = vi.fn();
	}
	class InstancedMesh {
		geometry = { attributes: {} as Record<string, { needsUpdate: boolean }>, dispose: vi.fn() };
		material = { dispose: vi.fn() };
		frustumCulled = false;
		count = 0;
		removeFromParent = vi.fn();
	}
	class CanvasTexture {
		needsUpdate = true;
		dispose = vi.fn();
	}
	class Color {
		r = 0;
		g = 0;
		b = 0;
		constructor(r?: number, g?: number, b?: number) {
			this.r = r ?? 0;
			this.g = g ?? 0;
			this.b = b ?? 0;
		}
	}
	class Mesh {
		geometry = { dispose: vi.fn() };
		material = { dispose: vi.fn() };
		frustumCulled = false;
		removeFromParent = vi.fn();
	}
	class MeshBasicMaterial {
		color = new Color();
		opacity = 1;
		transparent = false;
		polygonOffset = true;
		polygonOffsetFactor = 0;
		polygonOffsetUnits = 0;
		depthWrite = true;
		side = 0;
		dispose = vi.fn();
	}
	return {
		PlaneGeometry,
		ShaderMaterial,
		InstancedMesh,
		InstancedBufferAttribute: BufferAttribute,
		CanvasTexture,
		Color,
		Mesh,
		MeshBasicMaterial,
		DynamicDrawUsage: 35048,
		AdditiveBlending: Symbol("AdditiveBlending"),
		NormalBlending: Symbol("NormalBlending"),
		DoubleSide: Symbol("DoubleSide"),
	};
});

// Mock document for generateSmokeTexture
if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		createElement: vi.fn(() => {
			const canvas = {
				width: 0,
				height: 0,
				getContext: vi.fn(() => ({
					fillRect: vi.fn(),
					createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn(), fillStyle: "" })),
				})),
			};
			return canvas;
		}),
	} as unknown as Document;
}

import { VehicleEffects } from "./VehicleEffects.js";

// Expose private methods for testing
class TestVehicleEffects extends VehicleEffects {
	public testComputeWheelSlide(vehicle: Parameters<VehicleEffects["update"]>[1]): number[] {
		// @ts-expect-error -- accessing private method for testing
		return this.computeWheelSlide(vehicle);
	}

	public testScaleBySpeed(intensities: number[], speed: number): number[] {
		// @ts-expect-error -- accessing private method for testing
		return this.scaleBySpeed(intensities, speed);
	}

	public testComputeWheelOffRoad(vehicle: Parameters<VehicleEffects["update"]>[1]): boolean[] {
		// @ts-expect-error -- accessing private method for testing
		return this.computeWheelOffRoad(vehicle);
	}
}

function makeMockVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		state: { speed: 20 },
		tireDynState: null,
		burnoutActive: false,
		config: {
			drivetrain: "RWD",
			chassis: {
				wheelPositions: [
					{ x: 0.8, z: 1.4 },
					{ x: -0.8, z: 1.4 },
					{ x: 0.8, z: -1.4 },
					{ x: -0.8, z: -1.4 },
				],
			},
		},
		physicsBody: null,
		terrain: null,
		getWheelWorldPositions: () =>
			[
				[0, 0, 0],
				[0, 0, 0],
				[0, 0, 0],
				[0, 0, 0],
			] as [number, number, number][],
		...overrides,
	};
}

function makeMockScene(): Record<string, unknown> {
	const children: unknown[] = [];
	return {
		add: (child: unknown) => children.push(child),
		children,
	};
}

describe("VehicleEffects", () => {
	describe("computeWheelSlide", () => {
		it("returns all zeros when no tire dynamics and not drifting", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle() as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide).toEqual([0, 0, 0, 0]);
		});

		it("returns all zeros when speed below 0.5 and not burnout", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 0.3 },
				tireDynState: { isDrifting: true, driftFactor: 1 },
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide).toEqual([0, 0, 0, 0]);
		});

		it("sets rear wheel slide when drifting with RWD", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 10 },
				tireDynState: { isDrifting: true, driftFactor: 0.7 },
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[0]).toBe(0);
			expect(slide[1]).toBe(0);
			expect(slide[2]).toBe(0.7);
			expect(slide[3]).toBe(0.7);
		});

		it("clamps drift intensity to 1", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 10 },
				tireDynState: { isDrifting: true, driftFactor: 2.0 },
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[2]).toBe(1);
			expect(slide[3]).toBe(1);
		});

		it("sets burnout slide for RWD driven wheels at any speed", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 0 },
				burnoutActive: true,
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[0]).toBe(0);
			expect(slide[1]).toBe(0);
			expect(slide[2]).toBe(0.8);
			expect(slide[3]).toBe(0.8);
		});

		it("sets burnout slide for FWD front wheels", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 0 },
				burnoutActive: true,
				config: {
					drivetrain: "FWD",
					chassis: {
						wheelPositions: [
							{ x: 0.8, z: 1.4 },
							{ x: -0.8, z: 1.4 },
							{ x: 0.8, z: -1.4 },
							{ x: -0.8, z: -1.4 },
						],
					},
				},
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[0]).toBe(0.8);
			expect(slide[1]).toBe(0.8);
			expect(slide[2]).toBe(0);
			expect(slide[3]).toBe(0);
		});

		it("sets burnout slide for all AWD wheels", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 0 },
				burnoutActive: true,
				config: {
					drivetrain: "AWD",
					chassis: {
						wheelPositions: [
							{ x: 0.8, z: 1.4 },
							{ x: -0.8, z: 1.4 },
							{ x: 0.8, z: -1.4 },
							{ x: -0.8, z: -1.4 },
						],
					},
				},
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide).toEqual([0.8, 0.8, 0.8, 0.8]);
		});

		it("burnout does not override drift if drift is higher", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 10 },
				burnoutActive: true,
				tireDynState: { isDrifting: true, driftFactor: 1.0 },
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[2]).toBe(1.0);
			expect(slide[3]).toBe(1.0);
		});

		it("computes cornering intensity from angular velocity", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				tireDynState: { isDrifting: false, driftFactor: 0, slideAngle: 0 },
				state: { speed: 20 },
				physicsBody: {
					angvel: () => ({ x: 0, y: 1.5, z: 0 }),
				},
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			// latG = |1.5 * 20| / 9.81 = 3.06, > 0.3 threshold
			// cornerIntensity = min(0.6, (3.06 - 0.3) * 0.5) = min(0.6, 1.38) = 0.6
			// turning right (yawRate > 0) -> RR (index 3)
			expect(slide[3]).toBeGreaterThan(0);
		});

		it("sets cornering on left rear when turning left", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				tireDynState: { isDrifting: false, driftFactor: 0, slideAngle: 0 },
				state: { speed: 20 },
				physicsBody: {
					angvel: () => ({ x: 0, y: -1.5, z: 0 }),
				},
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			expect(slide[2]).toBeGreaterThan(0);
			expect(slide[3]).toBe(0);
		});

		it("ignores cornering when latG below threshold", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				state: { speed: 5 },
				physicsBody: {
					angvel: () => ({ x: 0, y: 0.1, z: 0 }),
				},
			}) as never;
			const slide = effects.testComputeWheelSlide(vehicle);
			// latG = |0.1 * 5| / 9.81 = 0.051, < 0.3
			expect(slide).toEqual([0, 0, 0, 0]);
		});

		it("returns all false when no physicsBody for off-road", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle() as never;
			const offRoad = effects.testComputeWheelOffRoad(vehicle);
			expect(offRoad).toEqual([false, false, false, false]);
		});

		it("returns all false when no terrain for off-road", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				physicsBody: {
					translation: () => ({ x: 0, y: 0, z: 0 }),
					rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
				},
			}) as never;
			const offRoad = effects.testComputeWheelOffRoad(vehicle);
			expect(offRoad).toEqual([false, false, false, false]);
		});

		it("returns all false when terrain has no getRoadBoundary", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				physicsBody: {
					translation: () => ({ x: 0, y: 0, z: 0 }),
					rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
				},
				terrain: { getRoadBoundary: undefined },
			}) as never;
			const offRoad = effects.testComputeWheelOffRoad(vehicle);
			expect(offRoad).toEqual([false, false, false, false]);
		});

		it("detects off-road wheels correctly", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				physicsBody: {
					translation: () => ({ x: 0, y: 0, z: 0 }),
					rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
				},
				terrain: {
					getRoadBoundary: (_wx: number, _wz: number) => ({ onRoad: false }),
				},
			}) as never;
			const offRoad = effects.testComputeWheelOffRoad(vehicle);
			expect(offRoad).toEqual([true, true, true, true]);
		});

		it("detects on-road wheels correctly", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const vehicle = makeMockVehicle({
				physicsBody: {
					translation: () => ({ x: 0, y: 0, z: 0 }),
					rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
				},
				terrain: {
					getRoadBoundary: (_wx: number, _wz: number) => ({ onRoad: true }),
				},
			}) as never;
			const offRoad = effects.testComputeWheelOffRoad(vehicle);
			expect(offRoad).toEqual([false, false, false, false]);
		});
	});

	describe("scaleBySpeed", () => {
		it("returns negative-scaled values when speed is below 0.5", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([0.5, 0.5, 0.5, 0.5], 0.3);
			// factor = (0.3 - 0.5) / 19.5 ≈ -0.01026
			expect(result).toEqual([(-0.5 * 0.2) / 19.5, (-0.5 * 0.2) / 19.5, (-0.5 * 0.2) / 19.5, (-0.5 * 0.2) / 19.5]);
		});

		it("scales linearly between 0.5 and 20 m/s", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([1, 1, 1, 1], 10.25);
			// factor = (10.25 - 0.5) / 19.5 = 0.5
			expect(result).toEqual([0.5, 0.5, 0.5, 0.5]);
		});

		it("reaches full scale at 20 m/s", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([0.8, 0.8, 0.8, 0.8], 20);
			expect(result).toEqual([0.8, 0.8, 0.8, 0.8]);
		});

		it("clamps factor to 1 at very high speed", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([1, 1, 1, 1], 100);
			expect(result).toEqual([1, 1, 1, 1]);
		});

		it("returns exact zero factor at speed 0.5", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([1, 1, 1, 1], 0.5);
			expect(result).toEqual([0, 0, 0, 0]);
		});

		it("preserves per-wheel intensity ratios", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([0.2, 0.5, 0.8, 1.0], 10.25);
			expect(result[0] / result[1]).toBeCloseTo(0.2 / 0.5);
			expect(result[2] / result[3]).toBeCloseTo(0.8 / 1.0);
		});

		it("handles empty-like input (all zeros)", () => {
			const effects = new TestVehicleEffects(makeMockScene() as never);
			const result = effects.testScaleBySpeed([0, 0, 0, 0], 20);
			expect(result).toEqual([0, 0, 0, 0]);
		});
	});
});
