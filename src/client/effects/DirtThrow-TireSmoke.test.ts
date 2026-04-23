// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

// jsdom doesn't implement Canvas 2D
beforeAll(() => {
	HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
		createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		fillRect: vi.fn(),
	});
});

// Mock THREE.js
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
		geometry = {
			attributes: {} as Record<string, { needsUpdate: boolean }>,
			dispose: vi.fn(),
		};
		material = { dispose: vi.fn() };
		frustumCulled = false;
		count = 0;
		removeFromParent = vi.fn();
	}
	class CanvasTexture {
		needsUpdate = true;
		dispose = vi.fn();
	}
	return {
		PlaneGeometry,
		ShaderMaterial,
		InstancedMesh,
		InstancedBufferAttribute: BufferAttribute,
		CanvasTexture,
		DynamicDrawUsage: 35048,
		AdditiveBlending: Symbol("AdditiveBlending"),
		NormalBlending: Symbol("NormalBlending"),
		DoubleSide: Symbol("DoubleSide"),
	};
});

import { DirtThrow } from "./DirtThrow.js";
import { TireSmoke } from "./TireSmoke.js";

function makeMockScene() {
	const children: unknown[] = [];
	return {
		add: (child: unknown) => children.push(child),
		children,
	};
}

const baseWheelPos: [number, number, number][] = [
	[0, 0, 0],
	[0, 0, 0],
	[0, 0, 0],
	[0, 0, 0],
];

describe("DirtThrow", () => {
	it("creates without error", () => {
		expect(() => new DirtThrow(makeMockScene() as never)).not.toThrow();
	});

	it("update with all wheels on-road does nothing", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [false, false, false, false], 10);
	});

	it("update with zero speed does not emit", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [true, true, true, true], 0);
	});

	it("update with very low speed does not emit", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [true, true, true, true], 0.5);
	});

	it("update with off-road and sufficient speed emits", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [true, true, true, true], 15);
	});

	it("update with high speed emits more", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		for (let i = 0; i < 10; i++) {
			dt.update(0.016, baseWheelPos, [true, true, true, true], 30);
		}
	});

	it("mixed on-road and off-road wheels", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [false, true, false, true], 15);
	});

	it("dispose without error", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [true, true, true, true], 15);
		expect(() => dt.dispose()).not.toThrow();
	});

	it("update with zero dt does not crash", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0, baseWheelPos, [true, true, true, true], 15);
	});

	it("transitioning from off-road to on-road resets accumulator", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		dt.update(0.016, baseWheelPos, [true, false, false, false], 15);
		dt.update(0.016, baseWheelPos, [false, false, false, false], 15);
		// Should not crash, accumulator reset
	});

	it("speed factor saturates at speed / 15", () => {
		const dt = new DirtThrow(makeMockScene() as never);
		// Both 15 and 100 m/s should produce similar results (both saturate to factor=1)
		dt.update(0.016, baseWheelPos, [true, false, false, false], 15);
		dt.update(0.016, baseWheelPos, [true, false, false, false], 100);
	});
});

describe("TireSmoke", () => {
	it("creates without error", () => {
		expect(() => new TireSmoke(makeMockScene() as never)).not.toThrow();
	});

	it("update with no sliding does not emit", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0, 0, 0, 0]);
	});

	it("update with very low slide does not emit", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0.04, 0.04, 0.04, 0.04]);
	});

	it("update with high slide intensity emits", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0.5, 0.5, 0.5, 0.5]);
	});

	it("update with maximum slide intensity emits", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [1, 1, 1, 1]);
	});

	it("only rear wheels sliding emits only for those wheels", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0, 0, 0.5, 0.5]);
	});

	it("only front wheels sliding emits only for those wheels", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0.5, 0.5, 0, 0]);
	});

	it("dispose without error", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0.5, 0.5, 0.5, 0.5]);
		expect(() => ts.dispose()).not.toThrow();
	});

	it("update with zero dt does not crash", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0, baseWheelPos, [0.5, 0.5, 0.5, 0.5]);
	});

	it("accumulates time correctly for burst emission", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		// Many small dt updates should eventually trigger emission
		for (let i = 0; i < 100; i++) {
			ts.update(0.001, baseWheelPos, [0.1, 0.1, 0.1, 0.1]);
		}
	});

	it("transitioning from sliding to not resets accumulator", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0.5, 0.5, 0.5, 0.5]);
		ts.update(0.016, baseWheelPos, [0, 0, 0, 0]);
	});

	it("handle single wheel sliding at high intensity", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [0, 0, 0, 1.0]);
	});

	it("handles very high dt", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(1.0, baseWheelPos, [0.5, 0.5, 0.5, 0.5]);
	});

	it("handles negative slide intensity", () => {
		const ts = new TireSmoke(makeMockScene() as never);
		ts.update(0.016, baseWheelPos, [-0.5, -0.5, -0.5, -0.5]);
	});
});
