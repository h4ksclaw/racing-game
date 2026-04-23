/**
 * Tests for object-manager.ts — autoSetupLightMaterial.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("three", () => ({
	Vector3: class {
		x = 0;
		y = 0;
		z = 0;
	},
	Mesh: class {
		isMesh = true;
		material: any;
		userData: any = {};
		constructor() {
			this.material = {
				clone: vi.fn(() => {
					const m: any = {
						name: "",
						emissive: { set: vi.fn() },
						emissiveIntensity: 0,
					};
					m.clone = vi.fn(() => ({ ...m }));
					return m;
				}),
			};
		}
	},
	Group: class {},
	Material: class {},
	MeshStandardMaterial: class {},
}));

import { autoSetupLightMaterial } from "./object-manager.js";

describe("autoSetupLightMaterial", () => {
	it("returns null for non-mesh objects", () => {
		const result = autoSetupLightMaterial({ isMesh: false } as any, "headlight");
		expect(result).toBeNull();
	});

	it("clones material and sets emissive for headlight", () => {
		const obj: any = {
			isMesh: true,
			name: "headlight_L",
			material: {
				clone: vi.fn(() => ({
					name: "",
					emissive: { set: vi.fn() },
					emissiveIntensity: 0,
				})),
			},
			userData: {},
		};
		const result = autoSetupLightMaterial(obj, "headlight");
		expect(result).not.toBeNull();
		expect(result!.name).toMatch(/Headlight/);
		expect((result as any).emissive.set).toHaveBeenCalledWith(0xffffff);
		expect((result as any).emissiveIntensity).toBe(1.0);
	});

	it("sets red emissive for taillight", () => {
		const obj: any = {
			isMesh: true,
			name: "taillight_R",
			material: {
				clone: vi.fn(() => ({
					name: "",
					emissive: { set: vi.fn() },
					emissiveIntensity: 0,
				})),
			},
			userData: {},
		};
		const result = autoSetupLightMaterial(obj, "taillight");
		expect((result as any).emissive.set).toHaveBeenCalledWith(0xff2222);
	});

	it("stores bloomMaterial in userData", () => {
		const obj: any = {
			isMesh: true,
			material: {
				clone: vi.fn(() => ({
					name: "",
					emissive: { set: vi.fn() },
					emissiveIntensity: 0,
				})),
			},
			userData: {},
		};
		autoSetupLightMaterial(obj, "headlight");
		expect(obj.userData.bloomMaterial).toBeDefined();
	});
});
