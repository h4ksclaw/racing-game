import { describe, expect, it } from "vitest";
import { type AutoDetectResult, autoDetect } from "./auto-detect.ts";

/**
 * Mock THREE.Group for auto-detect tests.
 * Creates a minimal mock that satisfies the traverse/isMesh/getWorldPosition contract.
 */
function createMockModel(
	meshes: {
		name: string;
		position: { x: number; y: number; z: number };
		bboxSize: { x: number; y: number; z: number };
		isEmissive?: boolean;
		emissiveBrightness?: number;
	}[],
) {
	const modelBox = {
		min: { x: -1, y: 0, z: -1.5 },
		max: { x: 1, y: 0.5, z: 1.5 },
		getCenter: () => ({ x: 0, y: 0.25, z: 0 }),
	};

	const mockMeshes = meshes.map((m) => {
		const geometry = {
			computeBoundingBox: () => {},
			boundingBox: {
				getSize: () => m.bboxSize,
			},
		};
		const mesh = {
			isMesh: true,
			name: m.name,
			geometry,
			material: m.isEmissive
				? {
						emissive: { r: 1, g: 0.8, b: 0 },
						emissiveIntensity: 1,
						constructor: { name: "MeshStandardMaterial" },
						// For instanceof check
						__proto__: {},
					}
				: null,
			getWorldPosition: () => m.position,
			isLight: false,
		};
		return mesh;
	});

	return {
		traverse: (fn: (child: any) => void) => {
			mockMeshes.forEach(fn);
		},
		// For Box3.setFromObject
		__mockMeshes: mockMeshes,
		__modelBox: modelBox,
	};
}

// Mock THREE for the module
vi.mock("three", () => ({
	Vector3: class {
		x = 0;
		y = 0;
		z = 0;
		constructor(x?: number, y?: number, z?: number) {
			this.x = x ?? 0;
			this.y = y ?? 0;
			this.z = z ?? 0;
		}
		clone() {
			return new (this.constructor as any)(this.x, this.y, this.z);
		}
	},
	Box3: class {
		min = { x: -1, y: 0, z: -1.5 };
		max = { x: 1, y: 0.5, z: 1.5 };
		setFromObject() {
			return this;
		}
		getCenter() {
			return { x: 0, y: 0.25, z: 0 };
		}
	},
	Group: class {},
	Mesh: class {},
	Material: class {},
	MeshStandardMaterial: class {},
}));

import { vi } from "vitest";

describe("autoDetect", () => {
	it("detects wheels by name pattern", () => {
		const model = createMockModel([
			{ name: "wheel_fl", position: { x: -0.7, y: 0, z: 1 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
			{ name: "wheel_fr", position: { x: 0.7, y: 0, z: 1 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
			{ name: "body", position: { x: 0, y: 0.2, z: 0 }, bboxSize: { x: 1.8, y: 0.5, z: 3 } },
		]) as any;
		const result: AutoDetectResult = autoDetect(model as any);
		expect(result.wheels.length).toBeGreaterThanOrEqual(2);
	});

	it("detects exhaust by name", () => {
		const model = createMockModel([
			{ name: "exhaust_pipe", position: { x: -0.3, y: 0.1, z: -1.2 }, bboxSize: { x: 0.1, y: 0.1, z: 0.4 } },
		]) as any;
		const result = autoDetect(model as any);
		expect(result.exhausts.length).toBeGreaterThanOrEqual(1);
		expect(result.exhausts[0].type).toContain("Exhaust");
	});

	it("returns empty arrays for empty model", () => {
		const model = createMockModel([]) as any;
		const result = autoDetect(model as any);
		expect(result.wheels).toEqual([]);
		expect(result.lights).toEqual([]);
		expect(result.exhausts).toEqual([]);
	});

	it("detects 4 named wheels", () => {
		const model = createMockModel([
			{ name: "wheel_FL", position: { x: -0.7, y: 0, z: 1.2 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
			{ name: "wheel_FR", position: { x: 0.7, y: 0, z: 1.2 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
			{ name: "wheel_RL", position: { x: -0.7, y: 0, z: -1.2 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
			{ name: "wheel_RR", position: { x: 0.7, y: 0, z: -1.2 }, bboxSize: { x: 0.3, y: 0.6, z: 0.6 } },
		]) as any;
		const result = autoDetect(model as any);
		expect(result.wheels.length).toBe(4);
		// All should have Wheel_ prefix
		for (const w of result.wheels) expect(w.type).toMatch(/^Wheel_/);
	});

	it("non-wheel meshes with low score are excluded", () => {
		const model = createMockModel([
			{ name: "big_box", position: { x: 0, y: 0, z: 0 }, bboxSize: { x: 1.5, y: 0.8, z: 3 } },
		]) as any;
		const result = autoDetect(model as any);
		expect(result.wheels.length).toBe(0);
	});
});
