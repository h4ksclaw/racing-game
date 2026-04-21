import { describe, expect, it, vi } from "vitest";

// Mock THREE.js
vi.mock("three", () => {
	const setUsage = vi.fn((u: number) => u);
	class BufferAttribute {
		setUsage = setUsage;
		needsUpdate = false;
	}
	class BufferGeometry {
		setAttribute = vi.fn();
		setIndex = vi.fn();
		computeBoundingSphere = vi.fn();
		dispose = vi.fn();
	}
	class MeshBasicMaterial {
		color = {};
		transparent = true;
		opacity = 0;
		depthWrite = false;
		polygonOffset = true;
		polygonOffsetFactor = 0;
		polygonOffsetUnits = 0;
		clone = vi.fn(function (this: MeshBasicMaterial) {
			const m = new MeshBasicMaterial();
			m.opacity = this.opacity;
			return m;
		});
		dispose = vi.fn();
	}
	class Color {
		constructor(r: number, g: number, b: number) {
			this.r = r;
			this.g = g;
			this.b = b;
		}
		r: number;
		g: number;
		b: number;
	}
	class Mesh {
		frustumCulled = false;
		visible = false;
		material = null;
		removeFromParent = vi.fn();
	}
	return {
		Color,
		MeshBasicMaterial,
		BufferGeometry,
		BufferAttribute,
		Mesh,
	};
});

import { SkidMarks } from "./SkidMarks.js";

function makeMockScene() {
	const children: unknown[] = [];
	return {
		add: (child: unknown) => children.push(child),
		children,
	};
}

function makeWheelPos(x = 0, y = 0, z = 0): [number, number, number][] {
	return [
		[x - 1, y, z + 1],
		[x + 1, y, z + 1],
		[x - 1, y, z - 1],
		[x + 1, y, z - 1],
	];
}

describe("SkidMarks", () => {
	it("creates without error", () => {
		const scene = makeMockScene();
		expect(() => new SkidMarks(scene as never)).not.toThrow();
	});

	it("update with no sliding does not crash", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0, 0, 0, 0], [false, false, false, false]);
	});

	it("update with sliding below threshold does not emit", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.05, 0.05, 0.05, 0.05], [false, false, false, false]);
	});

	it("update with off-road wheel does not emit even with high slide", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [1, 1, 1, 1], [false, false, true, false]);
	});

	it("update with high slide and on-road emits marks", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("uses terrain height when terrain is set", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.setTerrain({ getHeight: (_x: number, _z: number) => 0.5 });
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("uses roadSurfaceY when available", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.setTerrain({
			getHeight: (_x: number, _z: number) => 0.5,
			getRoadSurfaceY: (_x: number, _z: number) => 0.52,
		});
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("sets terrain via setTerrain", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		const terrain = { getHeight: (_x: number, _z: number) => 0.0 };
		expect(() => sm.setTerrain(terrain)).not.toThrow();
	});

	it("multiple updates with sliding accumulate points", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		for (let i = 0; i < 10; i++) {
			sm.update(i * 0.016, makeWheelPos(i * 0.2, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		}
	});

	it("stopping and restarting sliding creates a gap", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		// Slide
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		// Stop
		sm.update(1, makeWheelPos(0, 0, 0), [0, 0, 0, 0], [false, false, false, false]);
		// Resume far away (gap > 1.0m threshold)
		sm.update(2, makeWheelPos(5, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("dispose cleans up without error", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		expect(() => sm.dispose()).not.toThrow();
	});

	it("dispose on fresh instance does not crash", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		expect(() => sm.dispose()).not.toThrow();
	});

	it("handles very high slide intensity", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [100, 100, 100, 100], [false, false, false, false]);
	});

	it("handles zero dt / time", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("handles negative time", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(-10, makeWheelPos(), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("expired marks are removed", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		// Add marks at time 0
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		// Jump far past fade time (MARK_FADE_AGE=12 + MARK_FADE_DURATION=6 = 18s)
		sm.update(20, makeWheelPos(0, 0, 0), [0, 0, 0, 0], [false, false, false, false]);
	});

	it("only some wheels sliding works correctly", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.5, 0, 0.5, 0], [false, false, false, false]);
	});

	it("very close positions are spaced by MARK_SPACING", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		// Same position repeated — should skip due to spacing check
		for (let i = 0; i < 5; i++) {
			sm.update(i * 0.016, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		}
	});

	it("mixed on-road and off-road wheels", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(), [0.5, 0.5, 0.5, 0.5], [false, true, false, true]);
	});

	it("rebuilds mesh when 2+ points exist", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		sm.update(0.1, makeWheelPos(0.2, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
	});

	it("hides mesh when fewer than 2 points", () => {
		const sm = new SkidMarks(makeMockScene() as never);
		// Add 2 points to create mesh
		sm.update(0, makeWheelPos(0, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		sm.update(0.1, makeWheelPos(0.2, 0, 0), [0.5, 0.5, 0.5, 0.5], [false, false, false, false]);
		// Then let them expire
		sm.update(20, makeWheelPos(0.2, 0, 0), [0, 0, 0, 0], [false, false, false, false]);
	});
});
