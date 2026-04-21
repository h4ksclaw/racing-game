import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock AudioContext globally for Node.js environment
class MockAudioContext {
	state = "running";
	currentTime = 0;
	sampleRate = 44100;
	destination = {};
	resume = vi.fn();
	close = vi.fn();
	createBufferSource = vi.fn();
	createBiquadFilter = vi.fn();
	createGain = vi.fn();
	createBuffer = vi.fn((_ch: number, len: number) => ({
		getChannelData: () => new Float32Array(len),
	}));
}

// @ts-expect-error no global AudioContext in Node
globalThis.AudioContext = MockAudioContext;

beforeEach(() => {
	vi.resetModules();
});

describe("SkidAudio", () => {
	it("can be constructed without throwing", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		expect(() => new SkidAudio(bus as any)).not.toThrow();
	});

	it("dispose without starting does not throw", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		expect(() => skid.dispose()).not.toThrow();
	});

	it("update with intensity 0 does not acquire context", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		skid.update(0);
		expect(bus.acquire).not.toHaveBeenCalled();
	});

	it("update with negative intensity is clamped to 0", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		skid.update(-5);
		expect(bus.acquire).not.toHaveBeenCalled();
	});

	it("update with intensity > 1 is clamped", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		skid.update(5);
		expect(bus.acquire).toHaveBeenCalled();
	});

	it("update acquires context when intensity > 0.01", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		skid.update(0.5);
		expect(bus.acquire).toHaveBeenCalledTimes(1);
	});

	it("update with high then low intensity exercises lifecycle", async () => {
		const { SkidAudio } = await import("./SkidAudio.ts");
		const bus = { acquire: vi.fn(), release: vi.fn() };
		const skid = new SkidAudio(bus as any);
		// Start
		skid.update(0.5);
		expect(bus.acquire).toHaveBeenCalled();
		// Multiple updates while playing
		skid.update(0.8);
		skid.update(0.3);
		// Stop
		skid.update(0);
		skid.dispose();
	});
});
