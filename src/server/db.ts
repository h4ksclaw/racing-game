/**
 * SQLite database manager for game assets and car metadata.
 *
 * Uses better-sqlite3 for synchronous, fast access.
 * DB path configurable via DB_PATH env var (default: ./data/game_assets.db).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, "data", "game_assets.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
	if (_db) return _db;

	const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	_db = new Database(dbPath);
	const db = _db;
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	// Init schema
	db.exec(`
		CREATE TABLE IF NOT EXISTS assets (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			filepath        TEXT NOT NULL,
			sha256_hash     TEXT NOT NULL,
			source_url      TEXT NOT NULL,
			source_type     TEXT NOT NULL DEFAULT 'sketchfab',
			license         TEXT,
			attribution     TEXT,
			original_name   TEXT NOT NULL,
			download_date   TEXT NOT NULL DEFAULT (datetime('now')),
			status          TEXT NOT NULL DEFAULT 'pending',
			metadata_json   TEXT,
			UNIQUE(source_url)
		);

		CREATE TABLE IF NOT EXISTS car_metadata (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_id        INTEGER REFERENCES assets(id),
			make            TEXT,
			model           TEXT,
			year            INTEGER,
			body_type       TEXT,
			dimensions_json TEXT,
			engine_json     TEXT,
			performance_json TEXT,
			drivetrain      TEXT,
			transmission_json TEXT,
			weight_kg       REAL,
			fuel_type       TEXT,
			price_json      TEXT,
			source          TEXT NOT NULL DEFAULT 'auto',
			confidence      REAL DEFAULT 0.5,
			created_at      TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS car_configs (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_id            INTEGER NOT NULL REFERENCES assets(id),
			car_metadata_id     INTEGER REFERENCES car_metadata(id),
			config_json         TEXT NOT NULL,
			model_schema_json   TEXT,
			created_date        TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);

	// Migrate: add missing columns to existing tables (idempotent)
	const migrateColumn = (table: string, col: string, def: string) => {
		try {
			db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
		} catch {
			/* column already exists */
		}
	};
	migrateColumn("car_metadata", "asset_id", "INTEGER REFERENCES assets(id)");

	// Create indexes (ignore if exists)
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_assets_source_url ON assets(source_url);
		CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
		CREATE INDEX IF NOT EXISTS idx_car_metadata_asset ON car_metadata(asset_id);
		CREATE INDEX IF NOT EXISTS idx_car_configs_asset ON car_configs(asset_id);
	`);

	// Create unique index for car_metadata (may fail if duplicate data exists)
	try {
		db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_car_meta_unique ON car_metadata(make, model, year)`);
	} catch {
		// Duplicate entries prevent unique index — non-critical for now
	}

	return db;
}

// ── Asset queries ──────────────────────────────────────────────────────

export interface AssetRow {
	id: number;
	filepath: string;
	sha256_hash: string;
	source_url: string;
	source_type: string;
	license: string | null;
	attribution: string | null;
	original_name: string;
	download_date: string;
	status: string;
	metadata_json: string | null;
}

export function getAssets(status?: string): AssetRow[] {
	const db = getDb();
	if (status) {
		return db.prepare("SELECT * FROM assets WHERE status = ? ORDER BY download_date DESC").all(status) as AssetRow[];
	}
	return db.prepare("SELECT * FROM assets ORDER BY download_date DESC").all() as AssetRow[];
}

export function getAssetById(id: number): AssetRow | undefined {
	return getDb().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
}

export function getAssetByHash(hash: string): AssetRow | undefined {
	return getDb().prepare("SELECT * FROM assets WHERE sha256_hash = ?").get(hash) as AssetRow | undefined;
}

export function insertAsset(asset: {
	filepath: string;
	sha256_hash: string;
	source_url: string;
	source_type: string;
	license?: string;
	attribution?: string;
	original_name: string;
	status?: string;
	metadata_json?: string;
}): number {
	const db = getDb();
	const result = db
		.prepare(`
		INSERT INTO assets (filepath, sha256_hash, source_url, source_type, license, attribution, original_name, status, metadata_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
		.run(
			asset.filepath,
			asset.sha256_hash,
			asset.source_url,
			asset.source_type,
			asset.license ?? null,
			asset.attribution ?? null,
			asset.original_name,
			asset.status ?? "pending",
			asset.metadata_json ?? null,
		);
	return result.lastInsertRowid as number;
}

export function updateAssetStatus(id: number, status: string, filepath?: string): void {
	const db = getDb();
	if (filepath) {
		db.prepare("UPDATE assets SET status = ?, filepath = ? WHERE id = ?").run(status, filepath, id);
	} else {
		db.prepare("UPDATE assets SET status = ? WHERE id = ?").run(status, id);
	}
}

// ── Car metadata queries ──────────────────────────────────────────────

export interface CarMetadataRow {
	id: number;
	asset_id: number | null;
	make: string;
	model: string;
	year: number | null;
	body_type: string | null;
	dimensions_json: string | null;
	engine_json: string | null;
	performance_json: string | null;
	drivetrain: string | null;
	transmission_json: string | null;
	weight_kg: number | null;
	fuel_type: string | null;
	price_json: string | null;
	source: string;
	confidence: number;
	created_at: string;
	updated_at: string;
}

/** Parse JSON column safely — returns parsed object or empty dict. */
function parseJson<T = Record<string, unknown>>(val: string | null): T {
	if (!val) return {} as T;
	try {
		return JSON.parse(val);
	} catch {
		return {} as T;
	}
}

export interface CarMetadata {
	id: number;
	make: string;
	model: string;
	year: number | null;
	bodyType: string | null;
	dimensions: Record<string, number>;
	engine: Record<string, number | string>;
	performance: Record<string, number>;
	drivetrain: string | null;
	transmission: Record<string, number | string>;
	weightKg: number | null;
	fuelType: string | null;
	price: Record<string, number | string>;
	source: string;
	confidence: number;
}

function rowToMeta(row: CarMetadataRow): CarMetadata {
	return {
		id: row.id,
		make: row.make,
		model: row.model,
		year: row.year,
		bodyType: row.body_type,
		dimensions: parseJson(row.dimensions_json),
		engine: parseJson(row.engine_json),
		performance: parseJson(row.performance_json),
		drivetrain: row.drivetrain,
		transmission: parseJson(row.transmission_json),
		weightKg: row.weight_kg,
		fuelType: row.fuel_type,
		price: parseJson(row.price_json),
		source: row.source,
		confidence: row.confidence,
	};
}

export function getAllCars(): CarMetadata[] {
	const rows = getDb().prepare("SELECT * FROM car_metadata ORDER BY make, model, year").all() as CarMetadataRow[];
	return rows.map(rowToMeta);
}

export function searchCars(query: string, limit = 20): CarMetadata[] {
	const db = getDb();
	const q = `%${query}%`;
	const rows = db
		.prepare("SELECT * FROM car_metadata WHERE make LIKE ? OR model LIKE ? ORDER BY confidence DESC LIMIT ?")
		.all(q, q, limit) as CarMetadataRow[];
	return rows.map(rowToMeta);
}

export function getCarById(id: number): CarMetadata | undefined {
	const row = getDb().prepare("SELECT * FROM car_metadata WHERE id = ?").get(id) as CarMetadataRow | undefined;
	return row ? rowToMeta(row) : undefined;
}

export function upsertCarMetadata(car: {
	make: string;
	model: string;
	year: number;
	body_type?: string;
	dimensions?: Record<string, number>;
	engine?: Record<string, number | string>;
	performance?: Record<string, number>;
	drivetrain?: string;
	transmission?: Record<string, number | string>;
	weight_kg?: number;
	fuel_type?: string;
	price?: Record<string, number | string>;
	source?: string;
	confidence?: number;
}): number {
	const db = getDb();
	const now = new Date().toISOString();

	const existing = db
		.prepare("SELECT id, confidence FROM car_metadata WHERE make = ? AND model = ? AND year = ?")
		.get(car.make, car.model, car.year) as { id: number; confidence: number } | undefined;

	if (existing && (car.confidence ?? 0.5) > existing.confidence) {
		// Merge: update only non-null fields
		const current = db.prepare("SELECT * FROM car_metadata WHERE id = ?").get(existing.id) as CarMetadataRow;
		const dims = { ...parseJson(current.dimensions_json), ...car.dimensions };
		const eng = { ...parseJson(current.engine_json), ...car.engine };
		const perf = { ...parseJson(current.performance_json), ...car.performance };
		const trans = { ...parseJson(current.transmission_json), ...car.transmission };
		const price = { ...parseJson(current.price_json), ...car.price };

		db.prepare(`
			UPDATE car_metadata SET
				body_type = COALESCE(NULLIF(?, body_type), body_type),
				dimensions_json = ?, engine_json = ?, performance_json = ?,
				drivetrain = COALESCE(NULLIF(?, drivetrain), drivetrain),
				transmission_json = ?, weight_kg = COALESCE(?, weight_kg),
				fuel_type = COALESCE(NULLIF(?, fuel_type), fuel_type),
				price_json = ?, source = ?, confidence = ?, updated_at = ?
			WHERE id = ?
		`).run(
			car.body_type ?? null,
			JSON.stringify(dims),
			JSON.stringify(eng),
			JSON.stringify(perf),
			car.drivetrain ?? null,
			JSON.stringify(trans),
			car.weight_kg ?? null,
			car.fuel_type ?? null,
			JSON.stringify(price),
			car.source ?? "manual",
			car.confidence ?? 0.5,
			now,
			existing.id,
		);
		return existing.id;
	}

	if (!existing) {
		const result = db
			.prepare(`
			INSERT INTO car_metadata (make, model, year, body_type, dimensions_json, engine_json,
				performance_json, drivetrain, transmission_json, weight_kg, fuel_type, price_json, source, confidence)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.run(
				car.make,
				car.model,
				car.year,
				car.body_type ?? null,
				JSON.stringify(car.dimensions ?? {}),
				JSON.stringify(car.engine ?? {}),
				JSON.stringify(car.performance ?? {}),
				car.drivetrain ?? null,
				JSON.stringify(car.transmission ?? {}),
				car.weight_kg ?? null,
				car.fuel_type ?? null,
				JSON.stringify(car.price ?? {}),
				car.source ?? "manual",
				car.confidence ?? 0.5,
			);
		return result.lastInsertRowid as number;
	}

	return existing.id;
}

// ── Car config queries ────────────────────────────────────────────────

export interface CarConfigRow {
	id: number;
	asset_id: number;
	car_metadata_id: number | null;
	config_json: string;
	model_schema_json: string | null;
	created_date: string;
}

export function saveCarConfig(
	assetId: number,
	configJson: string,
	modelSchemaJson?: string,
	carMetadataId?: number,
): number {
	const db = getDb();
	const result = db
		.prepare(`
		INSERT INTO car_configs (asset_id, car_metadata_id, config_json, model_schema_json)
		VALUES (?, ?, ?, ?)
	`)
		.run(assetId, carMetadataId ?? null, configJson, modelSchemaJson ?? null);

	// Mark asset as ready
	updateAssetStatus(assetId, "ready");

	return result.lastInsertRowid as number;
}

export function getCarConfigs(): CarConfigRow[] {
	return getDb().prepare("SELECT * FROM car_configs ORDER BY created_date DESC").all() as CarConfigRow[];
}

export function getCarConfigById(id: number): CarConfigRow | undefined {
	return getDb().prepare("SELECT * FROM car_configs WHERE id = ?").get(id) as CarConfigRow | undefined;
}

export function getCarConfigsByAsset(assetId: number): CarConfigRow[] {
	return getDb().prepare("SELECT * FROM car_configs WHERE asset_id = ?").all(assetId) as CarConfigRow[];
}

/** Close the database connection. */
export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}
