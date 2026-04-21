import { beforeEach, describe, expect, it, vi } from "vitest";

// AudioBus is a singleton that calls `new AudioContext()`.
// In Node.js there's no global AudioContext, so we mock the constructor.
// We must set it before the first import.

class MockAudioContext {
	state = "running";
	currentTime = 0;
	refCount = 0;
	listener = {
		positionX: { setTargetAtTime: vi.fn() },
		positionY: { setTargetAtTime: vi.fn() },
		positionZ: { setTargetAtTime: vi.fn() },
		forwardX: { setTargetAtTime: vi.fn() },
		forwardY: { setTargetAtTime: vi.fn() },
		forwardZ: { setTargetAtTime: vi.fn() },
		upX: { setTargetAtTime: vi.fn() },
		upY: { setTargetAtTime: vi.fn() },
		upZ: { setTargetAtTime: vi.fn() },
	};
	resume = vi.fn();
	close = vi.fn();
	createGain = vi.fn(() => ({ gain: { value: 0 } }));
	createBiquadFilter = vi.fn(() => ({
		frequency: { value: 0, setTargetAtTime: vi.fn() },
		Q: { value: 0, setTargetAtTime: vi.fn() },
		type: "",
	}));
}

// @ts-expect-error no global AudioContext in Node
globalThis.AudioContext = MockAudioContext;

beforeEach(() => {
	vi.resetModules();
});

describe("AudioBus", () => {
	it("getInstance returns singleton", async () => {
		const { AudioBus } = await import("./AudioBus.ts");
		const a = AudioBus.getInstance();
		const b = AudioBus.getInstance();
		expect(a).toBe(b);
	});

	it("acquire increments refCount", async () => {
		const { AudioBus } = await import("./AudioBus.ts");
		// @ts-expect-error
		AudioBus.instance = null;
		const bus = AudioBus.getInstance();
		bus.acquire();
		bus.acquire();
		// @ts-expect-error
		expect(bus.refCount).toBe(2);
	});

	it("release decrements refCount", async () => {
		const { AudioBus } = await import("./AudioBus.ts");
		// @ts-expect-error
		AudioBus.instance = null;
		const bus = AudioBus.getInstance();
		bus.acquire();
		bus.release();
		// @ts-expect-error
		expect(bus.refCount).toBe(0);
	});

	it("dispose resets refCount and context", async () => {
		const { AudioBus } = await import("./AudioBus.ts");
		// @ts-expect-error
		AudioBus.instance = null;
		const bus = AudioBus.getInstance();
		bus.acquire();
		bus.dispose();
		// @ts-expect-error
		expect(bus.refCount).toBe(0);
		// @ts-expect-error
		expect(bus.ctx).toBeNull();
	});

	it("updateListener does nothing when no context", async () => {
		const { AudioBus } = await import("./AudioBus.ts");
		// @ts-expect-error
		AudioBus.instance = null;
		const bus = AudioBus.getInstance();
		bus.updateListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
	});
});
