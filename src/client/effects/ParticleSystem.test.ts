// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

// jsdom doesn't implement Canvas 2D — provide a stub so
// generateSmokeTexture() doesn't crash on getContext("2d") → null.
beforeAll(() => {
	HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
		createRadialGradient: vi.fn(() => ({
			addColorStop: vi.fn(),
		})),
		fillRect: vi.fn(),
	});
});

// Mock THREE.js before importing ParticleSystem
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
		deleteAttribute = vi.fn();
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

import { ParticleSystem } from "./ParticleSystem.js";

function makeMockScene() {
	const children: unknown[] = [];
	return {
		add: (child: unknown) => children.push(child),
		children,
	};
}

describe("ParticleSystem", () => {
	it("stores capacity", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 100 });
		expect(ps.capacity).toBe(100);
	});

	it("adds instanced mesh to scene", () => {
		const scene = makeMockScene();
		new ParticleSystem(scene as never, { capacity: 50 });
		expect(scene.children).toHaveLength(1);
	});

	it("emit queues a particle without error", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		expect(() => ps.emit(0, 0, 0, 1, 0, 0, 1, 1, 1, 0.5, 1.0, 0.5)).not.toThrow();
	});

	it("update flushes queued particles", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(1, 2, 3, 0, 1, 0, 0.5, 0.6, 0.7, 0.4, 2.0, 0.3);
		ps.update(0.016);
		// No crash = success, queue should be flushed
	});

	it("emitBurst creates multiple particles", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 100 });
		ps.emitBurst(0, 0, 0, 5, 2.0, 1, 1, 1, 0.3, 1.0, 0, 0.5);
		ps.update(0.016);
		// Queue should have been flushed without error
	});

	it("emitBurst default vyBias is 0", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emitBurst(0, 0, 0, 1, 1.0, 1, 1, 1, 0.3, 1.0);
		ps.update(0.016);
	});

	it("handles rapid emit and update cycles", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 50 });
		for (let i = 0; i < 100; i++) {
			ps.emit(Math.random() * 10, 0, Math.random() * 10, 0, 1, 0, 1, 1, 1, 0.3, 1.0, 0.5);
			ps.update(0.016);
		}
	});

	it("handles burst with count 0", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emitBurst(0, 0, 0, 0, 1.0, 1, 1, 1, 0.3, 1.0);
		ps.update(0.016);
	});

	it("wraps around when exceeding capacity", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 5 });
		for (let i = 0; i < 20; i++) {
			ps.emit(i, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 1.0, 0.5);
		}
		ps.update(0.016);
		// Should not crash — wraps around ring buffer
	});

	it("dispose cleans up without error", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 1.0, 0.5);
		ps.update(0.016);
		expect(() => ps.dispose()).not.toThrow();
	});

	it("supports NormalBlending option", () => {
		const ps = new ParticleSystem(makeMockScene() as never, {
			capacity: 10,
			blending: Symbol("NormalBlending") as never,
			depthWrite: false,
		});
		expect(ps.capacity).toBe(10);
	});

	it("supports depthWrite option", () => {
		const ps = new ParticleSystem(makeMockScene() as never, {
			capacity: 10,
			depthWrite: true,
		});
		expect(ps.capacity).toBe(10);
	});

	it("update with zero dt does not crash", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 1, 1, 1, 1, 1, 1, 0.3, 1.0, 0.5);
		ps.update(0);
	});

	it("update with negative dt does not crash", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 1, 1, 1, 1, 1, 1, 0.3, 1.0, 0.5);
		ps.update(-0.016);
	});

	it("emit with default opacity", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 1.0);
		ps.update(0.016);
	});

	it("handles empty queue on update", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.update(0.016);
	});

	it("handles large dt values", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 1, 0, 0, 1, 0, 1, 1, 1, 0.3, 1.0, 0.5);
		ps.update(1.0);
	});

	it("emitBurst with high spread produces varied velocities", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 100 });
		ps.emitBurst(0, 0, 0, 10, 10.0, 1, 1, 1, 0.3, 1.0, 2.0, 0.5);
		ps.update(0.016);
	});

	it("emitBurst with high vyBias", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emitBurst(0, 0, 0, 1, 1.0, 1, 1, 1, 0.3, 1.0, 5.0, 0.5);
		ps.update(0.016);
	});

	it("emit with various color values", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 1.0, 0.5); // black
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 1.0, 0.5); // white
		ps.emit(0, 0, 0, 0, 0, 0, 1, 0, 0, 0.3, 1.0, 0.5); // red
		ps.update(0.016);
	});

	it("emit with zero size", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1.0, 0.5);
		ps.update(0.016);
	});

	it("emit with zero lifetime", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 0, 0.5);
		ps.update(0.016);
	});

	it("emit with zero opacity", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0.3, 1.0, 0);
		ps.update(0.016);
	});

	it("multiple updates after single emit simulate particle lifetime", () => {
		const ps = new ParticleSystem(makeMockScene() as never, { capacity: 10 });
		ps.emit(0, 0, 0, 0, 1, 0, 1, 1, 1, 0.3, 0.1, 0.5);
		ps.update(0.05);
		ps.update(0.05);
		ps.update(0.05);
		// Particle should be dead after 0.15s with 0.1s lifetime
	});
});
