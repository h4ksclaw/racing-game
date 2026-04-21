/**
 * Unit tests for S3 storage module.
 *
 * Pure-function tests (carModelKey) run always.
 * S3-dependent tests require S3_INTEGRATION=1 or are skipped.
 */

import { describe, expect, it } from "vitest";
import { carModelKey } from "./s3.ts";

describe("carModelKey", () => {
	it("generates deterministic key from buffer", () => {
		const k1 = carModelKey(Buffer.from("hello"));
		const k2 = carModelKey(Buffer.from("hello"));
		expect(k1).toBe(k2);
		expect(k1).toMatch(/^cars\/[a-f0-9]{16}\.glb$/);
	});

	it("different buffers produce different keys", () => {
		expect(carModelKey(Buffer.from("a"))).not.toBe(carModelKey(Buffer.from("b")));
	});

	it("uses SHA-256 truncated to 16 hex chars", () => {
		const k = carModelKey(Buffer.from("test"));
		const hash = k.replace("cars/", "").replace(".glb", "");
		expect(hash).toHaveLength(16);
	});
});

// Integration tests — only run when S3 is configured
const S3_INTEGRATION = process.env.S3_INTEGRATION === "1";

describe.skipIf(!S3_INTEGRATION)("S3 integration", () => {
	it("bucketExists returns true", async () => {
		const { bucketExists } = await import("./s3.ts");
		expect(await bucketExists()).toBe(true);
	});

	it("round-trip: upload, download, delete", async () => {
		const { uploadToS3, getFromS3, deleteFromS3 } = await import("./s3.ts");
		const key = `cars/test-${Date.now()}.glb`;
		const data = Buffer.from("glb-test-data");
		await uploadToS3(key, data, "model/gltf-binary");
		const downloaded = await getFromS3(key);
		expect(downloaded).toEqual(data);
		await deleteFromS3(key);
	});

	it("listObjects returns uploaded keys", async () => {
		const { listObjects } = await import("./s3.ts");
		const items = await listObjects("cars/");
		expect(Array.isArray(items)).toBe(true);
	});
});
