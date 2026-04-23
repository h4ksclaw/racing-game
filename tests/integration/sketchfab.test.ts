/**
 * Sketchfab API integration tests.
 *
 * Hits the real Sketchfab API using SKETCHFAB_API_KEY from .env.
 * Skipped in CI (no key) but runs locally.
 */

import { beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import path from "node:path";
import {
	searchModels,
	getModelDetails,
	getDownloadUrl,
	downloadModel,
	isCcLicense,
} from "../../src/server/sketchfab.ts";

// Load .env so API key is available
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const API_KEY = process.env.SKETCHFAB_API_KEY;

// Skip entire suite if no API key
const describeIf = API_KEY ? describe : describe.skip;

describeIf("Sketchfab API (integration)", () => {
	let testUid: string;

	beforeAll(async () => {
		// Find a real downloadable model with a small vertex count
		const results = await searchModels("car", { limit: 24 });
		const small = results.results
			.filter((r) => r.downloadable && r.vertexCount > 0 && r.vertexCount < 100_000)
			.sort((a, b) => a.vertexCount - b.vertexCount)[0];
		if (!small) throw new Error("No small downloadable model found for integration test");
		testUid = small.uid;
		console.log(`[sketchfab] Using model ${small.name} (${testUid}, ${small.vertexCount} verts)`);
	});

	it("searches models and returns expected fields", async () => {
		const data = await searchModels("car", { limit: 3 });

		expect(data.results.length).toBeGreaterThan(0);
		expect(data.results.length).toBeLessThanOrEqual(3);

		for (const r of data.results) {
			expect(r.uid).toBeTruthy();
			expect(r.name).toBeTruthy();
			expect(r.license).toBeTruthy();
			expect(r.author).toBeTruthy();
			expect(r.url).toContain("sketchfab.com");
			expect(r.downloadable).toBe(true);
			// vertexCount and faceCount should be numbers
			expect(typeof r.vertexCount).toBe("number");
			expect(typeof r.faceCount).toBe("number");
		}
	});

	it("searches with sort options", async () => {
		const data = await searchModels("car", { limit: 2, sort_by: "-likeCount" });
		expect(data.results.length).toBeGreaterThan(0);
	});

	it("get model details", async () => {
		const details = await getModelDetails(testUid);

		expect(details.uid).toBe(testUid);
		expect(details.name).toBeTruthy();
		expect(details.license).toBeTruthy();
		expect(details.license.label).toBeTruthy();
		expect(details.license.slug).toBeTruthy();
		expect(details.user).toBeTruthy();
		expect(details.isDownloadable).toBe(true);
		expect(typeof details.vertexCount).toBe("number");
		expect(typeof details.faceCount).toBe("number");
	});

	it("get download URL (v3 API)", async () => {
		const dl = await getDownloadUrl(testUid);

		expect(dl.url).toBeTruthy();
		expect(dl.url).toContain("https://");
		expect(dl.format).toMatch(/^(glb|gltf)$/);
		expect(typeof dl.size).toBe("number");
	});

	it("download model (full pipeline)", async () => {
		// This is the real end-to-end test: details → URL → download → validate GLB
		const result = await downloadModel(testUid);

		expect(result.buffer.length).toBeGreaterThan(100); // at least a tiny GLB
		expect(result.filename).toBeTruthy();
		expect(result.size).toBe(result.buffer.length);
		expect(result.attribution.uid).toBe(testUid);
		expect(result.attribution.name).toBeTruthy();
		expect(result.attribution.author).toBeTruthy();
		expect(result.attribution.license).toBeTruthy();
		expect(result.attribution.sourceUrl).toContain(testUid);

		// Validate GLB magic bytes
		const magic = result.buffer.toString("ascii", 0, 4);
		expect(magic).toBe("glTF");
	}, 30_000); // 30s timeout for actual download

	it("rejects invalid UID gracefully", async () => {
		await expect(getModelDetails("nonexistent0000000000000000")).rejects.toThrow();
		await expect(getDownloadUrl("nonexistent0000000000000000")).rejects.toThrow();
	});

	it("isCcLicense identifies CC licenses", () => {
		// These are the actual UIDs from the Sketchfab API
		expect(isCcLicense("322a749bcfa841b29dff1e8a1bb74b0b")).toBe(true);  // CC BY
		expect(isCcLicense("bbfe3f7dbcdd4122b966b85b9786a989")).toBe(true);  // CC BY-NC
		expect(isCcLicense("")).toBe(false);
		expect(isCcLicense("nonexistent")).toBe(false);
		expect(isCcLicense("by")).toBe(false);  // slug, not UID
	});
});
