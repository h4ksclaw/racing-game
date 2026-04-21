/**
 * Tests for asset storage module — hashing, paths, promotion.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureAssetDirs, getAssetPath, getPendingPath, getReadyPath, hashBuffer, promoteAsset } from "./assets.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-test-"));
	process.env.ASSET_DIR = tmpDir;
	ensureAssetDirs();
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.ASSET_DIR;
});

describe("hashBuffer", () => {
	it("produces a 64-char hex string", () => {
		const buf = Buffer.from("test data");
		const hash = hashBuffer(buf);
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("matches known SHA256", () => {
		const buf = Buffer.from("hello");
		const hash = hashBuffer(buf);
		expect(hash).toBe(crypto.createHash("sha256").update(buf).digest("hex"));
	});
});

describe("getAssetPath", () => {
	it("returns correct pending path by default", () => {
		const p = getAssetPath("abc123", "pending");
		expect(p).toContain("pending");
		expect(p).toContain("abc123.glb");
	});

	it("returns correct ready path", () => {
		const p = getAssetPath("abc123", "ready");
		expect(p).toContain("ready");
		expect(p).toContain("abc123.glb");
	});

	it("defaults to ready status", () => {
		const p = getAssetPath("abc123");
		expect(p).toContain("ready");
	});
});

describe("promoteAsset", () => {
	it("moves file from pending to ready", () => {
		const hash = "a".repeat(64);
		const pendingPath = getPendingPath(hash);
		const readyPath = getReadyPath(hash);

		fs.writeFileSync(pendingPath, Buffer.from("fake glb"));
		expect(fs.existsSync(pendingPath)).toBe(true);
		expect(fs.existsSync(readyPath)).toBe(false);

		const result = promoteAsset(hash);
		expect(result).toBe(readyPath);
		expect(fs.existsSync(pendingPath)).toBe(false);
		expect(fs.existsSync(readyPath)).toBe(true);
	});
});
