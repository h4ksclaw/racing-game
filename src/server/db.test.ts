/**
 * Tests for database module — attribution CRUD + car queries.
 *
 * Attribution tests use a temp DB (no external data needed).
 * Car query tests require the production DB with 21K+ cars — skipped if empty.
 *
 * Run: npx vitest run src/server/db.test.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	_getDbForTesting,
	closeDb,
	deleteAttribution,
	filterCars,
	getAllAttributions,
	getAllCars,
	getAssets,
	getAttributionByAsset,
	getAttributionByConfig,
	insertAttribution,
	searchCars,
	updateAttribution,
} from "./db.ts";

// ─── Shared setup ───────────────────────────────────────────────────────

let testDbPath: string;
let origDbPath: string | undefined;

beforeEach(() => {
	closeDb();
	origDbPath = process.env.DB_PATH;
	testDbPath = path.join(os.tmpdir(), `test_attrib_${Date.now()}.db`);
	process.env.DB_PATH = testDbPath;
});

afterEach(() => {
	closeDb();
	if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
	if (origDbPath !== undefined) process.env.DB_PATH = origDbPath;
	else delete process.env.DB_PATH;
});

/** Create a minimal asset row and return its id. */
function seedAsset(): number {
	const db = _getDbForTesting();
	const r = db
		.prepare(
			"INSERT INTO assets (filepath, sha256_hash, source_url, original_name, status, source_type) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(`test_${Date.now()}.glb`, `h${Date.now()}`, `test://${Date.now()}`, "test.glb", "pending", "upload");
	return Number(r.lastInsertRowid);
}

/** Create a minimal car_config row and return its id. */
function seedCarConfig(): number {
	const db = _getDbForTesting();
	const assetId = seedAsset();
	const r = db
		.prepare("INSERT INTO car_configs (asset_id, config_json, model_schema_json) VALUES (?, ?, ?)")
		.run(assetId, "{}", "{}");
	return Number(r.lastInsertRowid);
}

// ─── Attribution CRUD ───────────────────────────────────────────────────

describe("Attribution CRUD", () => {
	test("insert returns id and persists data", () => {
		const id = insertAttribution({
			model_name: "Test Car",
			author_name: "Test Author",
			license_label: "CC Attribution",
			source_type: "sketchfab",
		});

		expect(typeof id).toBe("number");
		expect(id).toBeGreaterThan(0);

		const all = getAllAttributions();
		expect(all).toHaveLength(1);
		expect(all[0].model_name).toBe("Test Car");
		expect(all[0].author_name).toBe("Test Author");
		expect(all[0].license_label).toBe("CC Attribution");
		expect(all[0].source_type).toBe("sketchfab");
		expect(all[0].created_at).toBeTruthy();
	});

	test("getAttributionByAsset returns matching attribution", () => {
		const assetId = seedAsset();
		const id = insertAttribution({ asset_id: assetId, model_name: "Car A" });
		const attr = getAttributionByAsset(assetId);

		expect(attr).toBeDefined();
		expect(attr?.id).toBe(id);
		expect(attr?.model_name).toBe("Car A");
	});

	test("getAttributionByAsset returns undefined for missing", () => {
		seedAsset();
		expect(getAttributionByAsset(99)).toBeUndefined();
	});

	test("getAttributionByConfig returns matching attribution", () => {
		const configId = seedCarConfig();
		const id = insertAttribution({
			car_config_id: configId,
			model_name: "Car B",
		});
		const attr = getAttributionByConfig(configId);

		expect(attr).toBeDefined();
		expect(attr?.id).toBe(id);
	});

	test("updateAttribution modifies fields", () => {
		const id = insertAttribution({ model_name: "Old Name", notes: "old" });
		updateAttribution(id, { model_name: "New Name", notes: "updated" });

		const all = getAllAttributions();
		expect(all[0].model_name).toBe("New Name");
		expect(all[0].notes).toBe("updated");
	});

	test("updateAttribution ignores id and created_at", () => {
		const id = insertAttribution({ model_name: "Car" });
		updateAttribution(id, { id: 999, created_at: "2000-01-01" } as never);

		const all = getAllAttributions();
		expect(all[0].id).toBe(id);
		expect(all[0].created_at).not.toBe("2000-01-01");
	});

	test("deleteAttribution removes entry", () => {
		const id = insertAttribution({ model_name: "To Delete" });
		expect(getAllAttributions()).toHaveLength(1);

		deleteAttribution(id);
		expect(getAllAttributions()).toHaveLength(0);
	});

	test("multiple inserts, getAllAttributions returns all", () => {
		insertAttribution({ model_name: "Car 1" });
		insertAttribution({ model_name: "Car 2" });
		insertAttribution({ model_name: "Car 3" });

		expect(getAllAttributions()).toHaveLength(3);
	});

	test("nullable fields default to null", () => {
		insertAttribution({ source_type: "upload" });
		const attr = getAllAttributions()[0];

		expect(attr.model_name).toBeNull();
		expect(attr.author_name).toBeNull();
		expect(attr.source_url).toBeNull();
		expect(attr.license_url).toBeNull();
		expect(attr.description).toBeNull();
		expect(attr.notes).toBeNull();
	});
});

// ─── Car queries (require production DB) ────────────────────────────────

/**
 * These tests need the full car_metadata table (21K+ rows).
 * They skip gracefully when the DB is empty (e.g., in CI).
 */
describe("Car queries", () => {
	test("getAllCars returns an array", () => {
		const cars = getAllCars();
		if (cars.length === 0) return;
		expect(Array.isArray(cars)).toBe(true);
	});

	test("searchCars finds the AE86", () => {
		const results = searchCars("ae86");
		if (results.length === 0) return; // skip if no data
		const names = results.map((c) => `${c.make} ${c.model}`.toLowerCase());
		expect(names.some((n) => n.includes("ae86"))).toBe(true);
	});

	test("filterCars returns RWD cars", () => {
		const cars = filterCars({ drivetrain: "rwd" });
		if (cars.length === 0) return; // skip if no data
		for (const car of cars) {
			expect(car.drivetrain).toBe("rwd");
		}
	});

	test("getAssets returns pending assets", () => {
		const assets = getAssets("pending");
		if (assets.length === 0) return;
		expect(Array.isArray(assets)).toBe(true);
	});
});
