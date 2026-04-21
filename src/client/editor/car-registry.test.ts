/**
 * Tests for car-registry and model-loader.
 * Run: npx vitest run src/client/editor/car-registry.test.ts
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock globals for model-loader (THREE + GLTFLoader) ──────────────

const mockScene = { isGroup: true };
const mockLoadAsync = vi.fn().mockResolvedValue({ scene: mockScene });

vi.mock("three", () => ({
	Group: class Group {},
}));

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class MockGLTFLoader {
		loadAsync = mockLoadAsync;
	},
}));

// ── car-registry tests ──────────────────────────────────────────────

describe("car-registry", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("fetchGameCars calls /api/cars/game and caches", async () => {
		const { fetchGameCars, invalidateCarCache } = await import("./car-registry.js");

		const entries = [
			{
				configId: 1,
				assetId: 10,
				config_json: "{}",
				model_schema_json: null,
				physics_overrides_json: null,
				s3_key: "cars/test.glb",
			},
		];
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(entries),
		});

		const result1 = await fetchGameCars();
		expect(result1).toEqual(entries);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		// Second call should be cached
		const result2 = await fetchGameCars();
		expect(result2).toBe(result1);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		invalidateCarCache();
	});

	test("fetchGameCars throws on non-ok response", async () => {
		const { fetchGameCars } = await import("./car-registry.js");
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 500,
		});

		await expect(fetchGameCars()).rejects.toThrow("500");
	});
});

// ── model-loader tests ──────────────────────────────────────────────

describe("model-loader", () => {
	beforeEach(() => {
		mockLoadAsync.mockClear();
	});

	test("loadModelFromS3 loads GLB from S3 proxy URL", async () => {
		const { loadModelFromS3 } = await import("./model-loader.js");
		const result = await loadModelFromS3("cars/test.glb");
		expect(result).toBe(mockScene);
		expect(mockLoadAsync).toHaveBeenCalledWith("/api/s3/cars%2Ftest.glb");
	});

	test("loadModelFromS3 deduplicates concurrent requests", async () => {
		const { loadModelFromS3 } = await import("./model-loader.js");
		const p1 = loadModelFromS3("cars/dup.glb");
		const p2 = loadModelFromS3("cars/dup.glb");
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe(r2);
		expect(mockLoadAsync).toHaveBeenCalledTimes(1);
	});

	test("loadModelFromS3 retries after first completes", async () => {
		const { loadModelFromS3 } = await import("./model-loader.js");
		await loadModelFromS3("cars/retry.glb");
		await loadModelFromS3("cars/retry.glb");
		expect(mockLoadAsync).toHaveBeenCalledTimes(2);
	});
});
