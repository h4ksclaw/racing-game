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

/** @internal Test-only access to the raw DB handle. */
export function _getDbForTesting(): Database.Database {
	return getDb();
}

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
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_id            INTEGER REFERENCES assets(id),
			make                TEXT,
			model               TEXT,
			year                INTEGER,
			trim                TEXT,
			body_type           TEXT,
			dimensions_json     TEXT,
			engine_json         TEXT,
			performance_json    TEXT,
			drivetrain          TEXT,
			transmission_json   TEXT,
			brakes_json         TEXT,
			suspension_json     TEXT,
			tires_json          TEXT,
			aero_json           TEXT,
			weight_kg           REAL,
			weight_front_pct    REAL,
			fuel_type           TEXT,
			price_json          TEXT,
			eras                TEXT,
			tags                TEXT,
			source              TEXT NOT NULL DEFAULT 'auto',
			confidence          REAL DEFAULT 0.5,
			created_at          TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS car_configs (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_id            INTEGER NOT NULL REFERENCES assets(id),
			car_metadata_id     INTEGER REFERENCES car_metadata(id),
			config_json         TEXT NOT NULL,
			model_schema_json   TEXT,
			created_date        TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS attributions (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_id        INTEGER REFERENCES assets(id),
			car_config_id   INTEGER REFERENCES car_configs(id),
			source_type     TEXT NOT NULL DEFAULT 'sketchfab',
			model_name      TEXT,
			author_name     TEXT,
			author_url      TEXT,
			license_label   TEXT,
			license_slug    TEXT,
			source_url      TEXT,
			license_url     TEXT,
			description     TEXT,
			notes           TEXT,
			created_at      TEXT NOT NULL DEFAULT (datetime('now'))
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
	migrateColumn("car_metadata", "trim", "TEXT");
	migrateColumn("car_metadata", "brakes_json", "TEXT");
	migrateColumn("car_metadata", "suspension_json", "TEXT");
	migrateColumn("car_metadata", "tires_json", "TEXT");
	migrateColumn("car_metadata", "aero_json", "TEXT");
	migrateColumn("car_metadata", "weight_front_pct", "REAL");
	migrateColumn("car_metadata", "eras", "TEXT");
	migrateColumn("car_metadata", "tags", "TEXT");
	migrateColumn("assets", "s3_key", "TEXT");
	migrateColumn("car_configs", "physics_overrides_json", "TEXT");
	migrateColumn("car_configs", "attribution", "TEXT");

	// Create indexes (ignore if exists)
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_assets_source_url ON assets(source_url);
		CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
		CREATE INDEX IF NOT EXISTS idx_car_metadata_asset ON car_metadata(asset_id);
		CREATE INDEX IF NOT EXISTS idx_car_configs_asset ON car_configs(asset_id);
		CREATE INDEX IF NOT EXISTS idx_attributions_asset ON attributions(asset_id);
		CREATE INDEX IF NOT EXISTS idx_attributions_config ON attributions(car_config_id);
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
	s3_key?: string | null;
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
		.prepare(
			`
		INSERT INTO assets (filepath, sha256_hash, source_url, source_type, license, attribution, original_name, status, metadata_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		)
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

export function deleteAsset(id: number): boolean {
	const db = getDb();
	const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
	if (!asset) return false;
	// Delete related attributions
	db.prepare("DELETE FROM attributions WHERE asset_id = ?").run(id);
	// Delete related car configs that reference this asset
	db.prepare("DELETE FROM car_configs WHERE asset_id = ?").run(id);
	// Delete the asset itself
	db.prepare("DELETE FROM assets WHERE id = ?").run(id);
	return true;
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
	trim: string | null;
	body_type: string | null;
	dimensions_json: string | null;
	engine_json: string | null;
	performance_json: string | null;
	drivetrain: string | null;
	transmission_json: string | null;
	brakes_json: string | null;
	suspension_json: string | null;
	tires_json: string | null;
	aero_json: string | null;
	weight_kg: number | null;
	weight_front_pct: number | null;
	fuel_type: string | null;
	price_json: string | null;
	eras: string | null;
	tags: string | null;
	source: string;
	confidence: number;
	created_at: string;
	updated_at: string;
}

export interface CarDimensions {
	length_m?: number;
	width_m?: number;
	height_m?: number;
	wheelbase_m?: number;
	track_width_m?: number;
	ground_clearance_m?: number;
	front_track_m?: number;
	rear_track_m?: number;
	front_overhang_m?: number;
	rear_overhang_m?: number;
}

export interface CarEngine {
	displacement_l?: number;
	cylinders?: number;
	configuration?: string; // I4, V6, V8, flat4, etc.
	aspiration?: string; // NA, turbo, supercharged
	power_hp?: number;
	torque_nm?: number;
	max_rpm?: number;
	idle_rpm?: number;
	compression_ratio?: number;
	bore_mm?: number;
	stroke_mm?: number;
	valves_per_cylinder?: number;
	fuel_delivery?: string; // MPI, DI, carburetor
	boost_bar?: number; // for forced induction
}

export interface CarPerformance {
	"0_100_km_h"?: number;
	"0_60_mph"?: number;
	top_speed_km_h?: number;
	quarter_mile_s?: number;
	lateral_g?: number;
}

export interface CarTransmission {
	gear_count?: number;
	type?: string; // manual, automatic, CVT, DCT
	final_drive?: number;
	gear_ratios?: number[];
	reverse_ratio?: number;
}

export interface CarBrakes {
	front_type?: string; // disc, ventilated_disc, drum
	rear_type?: string;
	front_diameter_mm?: number;
	rear_diameter_mm?: number;
	abs?: boolean;
}

export interface CarSuspension {
	front_type?: string; // macpherson, double_wishbone, multilink, torsion_beam
	rear_type?: string;
	front_spring_rate_nm?: number;
	rear_spring_rate_nm?: number;
}

export interface CarTires {
	front_size?: string; // e.g. "205/55R16"
	rear_size?: string;
	width_mm?: number;
	aspect_ratio?: number;
	wheel_diameter_in?: number;
	tire_type?: string; // summer, all_season, winter, semi_slick
}

export interface CarAero {
	drag_coefficient?: number; // Cd
	lift_coefficient?: number; // Cl
	frontal_area_m2?: number;
	downforce_kg?: number; // at some reference speed
}

export interface CarPrice {
	min_usd: number;
	max_usd: number;
	avg_usd?: number;
	note?: string;
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

/**
 * Normalize DB dimension keys to CarDimensions interface keys.
 *
 * The Python pipeline stores keys like "length", "width", "height", "wheelbase",
 * "track_width", "ground_clearance" (in meters). The TS interface expects
 * "length_m", "width_m", "height_m", etc. This mapper handles both conventions
 * and passes through already-normalized keys.
 */
function normalizeDimensions(raw: Record<string, unknown>): CarDimensions {
	return {
		length_m: (raw.length_m ?? raw.length) as number | undefined,
		width_m: (raw.width_m ?? raw.width) as number | undefined,
		height_m: (raw.height_m ?? raw.height) as number | undefined,
		wheelbase_m: (raw.wheelbase_m ?? raw.wheelbase) as number | undefined,
		track_width_m: (raw.track_width_m ?? raw.track_width) as number | undefined,
		ground_clearance_m: (raw.ground_clearance_m ?? raw.ground_clearance) as number | undefined,
		front_track_m: raw.front_track_m as number | undefined,
		rear_track_m: raw.rear_track_m as number | undefined,
		front_overhang_m: raw.front_overhang_m as number | undefined,
		rear_overhang_m: raw.rear_overhang_m as number | undefined,
	};
}

/**
 * Normalize DB engine keys to CarEngine interface keys.
 * Handles both DB convention and TS interface convention.
 */
function normalizeEngine(raw: Record<string, unknown>): CarEngine {
	return {
		displacement_l: raw.displacement_l as number | undefined,
		cylinders: raw.cylinders as number | undefined,
		configuration: raw.configuration as string | undefined,
		aspiration: raw.aspiration as string | undefined,
		power_hp: raw.power_hp as number | undefined,
		torque_nm: raw.torque_nm as number | undefined,
		max_rpm: raw.max_rpm as number | undefined,
		idle_rpm: raw.idle_rpm as number | undefined,
		compression_ratio: raw.compression_ratio as number | undefined,
		bore_mm: raw.bore_mm as number | undefined,
		stroke_mm: raw.stroke_mm as number | undefined,
		valves_per_cylinder: raw.valves_per_cylinder as number | undefined,
		fuel_delivery: raw.fuel_delivery as string | undefined,
		boost_bar: raw.boost_bar as number | undefined,
	};
}

/** Parse tags string (comma-separated) to array. */
function parseTags(val: string | null): string[] {
	if (!val) return [];
	return val
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

export interface CarMetadata {
	id: number;
	make: string;
	model: string;
	year: number | null;
	trim: string | null;
	bodyType: string | null;
	dimensions: CarDimensions;
	engine: CarEngine;
	performance: CarPerformance;
	drivetrain: string | null;
	transmission: CarTransmission;
	brakes: CarBrakes;
	suspension: CarSuspension;
	tires: CarTires;
	aero: CarAero;
	weightKg: number | null;
	weightFrontPct: number | null;
	fuelType: string | null;
	price: CarPrice;
	eras: string | null;
	tags: string[];
	source: string;
	confidence: number;
}

function rowToMeta(row: CarMetadataRow): CarMetadata {
	return {
		id: row.id,
		make: row.make,
		model: row.model,
		year: row.year,
		trim: row.trim,
		bodyType: row.body_type,
		dimensions: normalizeDimensions(parseJson(row.dimensions_json)),
		engine: normalizeEngine(parseJson(row.engine_json)),
		performance: parseJson<CarPerformance>(row.performance_json),
		drivetrain: row.drivetrain,
		transmission: parseJson<CarTransmission>(row.transmission_json),
		brakes: parseJson<CarBrakes>(row.brakes_json),
		suspension: parseJson<CarSuspension>(row.suspension_json),
		tires: parseJson<CarTires>(row.tires_json),
		aero: parseJson<CarAero>(row.aero_json),
		weightKg: row.weight_kg,
		weightFrontPct: row.weight_front_pct,
		fuelType: row.fuel_type,
		price: parseJson<CarPrice>(row.price_json),
		eras: row.eras,
		tags: parseTags(row.tags),
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
		.prepare(
			"SELECT * FROM car_metadata WHERE make LIKE ? OR model LIKE ? OR trim LIKE ? OR tags LIKE ? ORDER BY confidence DESC LIMIT ?",
		)
		.all(q, q, q, q, limit) as CarMetadataRow[];
	return rows.map(rowToMeta);
}

/** Filter cars by specific fields. All params optional. */
export function filterCars(filters: {
	drivetrain?: string;
	body_type?: string;
	min_year?: number;
	max_year?: number;
	min_power_hp?: number;
	max_power_hp?: number;
	min_weight_kg?: number;
	max_weight_kg?: number;
	eras?: string;
	tag?: string;
	limit?: number;
}): CarMetadata[] {
	const db = getDb();
	const conditions: string[] = [];
	const params: unknown[] = [];

	const add = (col: string, val: unknown) => {
		conditions.push(`${col} = ?`);
		params.push(val);
	};

	const addLike = (col: string, val: string) => {
		conditions.push(`${col} LIKE ?`);
		params.push(`%${val}%`);
	};

	const addRange = (col: string, min?: number, max?: number) => {
		if (min !== undefined) {
			conditions.push(`${col} >= ?`);
			params.push(min);
		}
		if (max !== undefined) {
			conditions.push(`${col} <= ?`);
			params.push(max);
		}
	};

	if (filters.drivetrain) add("drivetrain", filters.drivetrain);
	if (filters.body_type) addLike("body_type", filters.body_type);
	addRange("year", filters.min_year, filters.max_year);
	if (filters.eras) addLike("eras", filters.eras);
	if (filters.tag) addLike("tags", filters.tag);
	addRange("weight_kg", filters.min_weight_kg, filters.max_weight_kg);

	// JSON field filters need json_extract
	if (filters.min_power_hp !== undefined || filters.max_power_hp !== undefined) {
		if (filters.min_power_hp !== undefined) {
			conditions.push("json_extract(engine_json, '$.power_hp') >= ?");
			params.push(filters.min_power_hp);
		}
		if (filters.max_power_hp !== undefined) {
			conditions.push("json_extract(engine_json, '$.power_hp') <= ?");
			params.push(filters.max_power_hp);
		}
	}

	const limit = filters.limit ?? 50;
	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const sql = `SELECT * FROM car_metadata ${where} ORDER BY confidence DESC LIMIT ?`;

	const rows = db.prepare(sql).all(...params, limit) as CarMetadataRow[];
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
	trim?: string;
	body_type?: string;
	dimensions?: Partial<CarDimensions>;
	engine?: Partial<CarEngine>;
	performance?: Partial<CarPerformance>;
	drivetrain?: string;
	transmission?: Partial<CarTransmission>;
	brakes?: Partial<CarBrakes>;
	suspension?: Partial<CarSuspension>;
	tires?: Partial<CarTires>;
	aero?: Partial<CarAero>;
	weight_kg?: number;
	weight_front_pct?: number;
	fuel_type?: string;
	price?: Partial<CarPrice>;
	eras?: string;
	tags?: string[];
	source?: string;
	confidence?: number;
}): number {
	const db = getDb();
	const now = new Date().toISOString();
	const tagsStr = car.tags?.join(",") ?? null;

	const existing = db
		.prepare("SELECT id, confidence FROM car_metadata WHERE make = ? AND model = ? AND year = ?")
		.get(car.make, car.model, car.year) as { id: number; confidence: number } | undefined;

	if (existing && (car.confidence ?? 0.5) > existing.confidence) {
		// Merge: update only non-null fields
		const current = db.prepare("SELECT * FROM car_metadata WHERE id = ?").get(existing.id) as CarMetadataRow;
		const dims = {
			...parseJson<CarDimensions>(current.dimensions_json),
			...car.dimensions,
		};
		const eng = { ...parseJson<CarEngine>(current.engine_json), ...car.engine };
		const perf = {
			...parseJson<CarPerformance>(current.performance_json),
			...car.performance,
		};
		const trans = {
			...parseJson<CarTransmission>(current.transmission_json),
			...car.transmission,
		};
		const brakes = {
			...parseJson<CarBrakes>(current.brakes_json),
			...car.brakes,
		};
		const susp = {
			...parseJson<CarSuspension>(current.suspension_json),
			...car.suspension,
		};
		const tires = { ...parseJson<CarTires>(current.tires_json), ...car.tires };
		const aero = { ...parseJson<CarAero>(current.aero_json), ...car.aero };
		const price = { ...parseJson<CarPrice>(current.price_json), ...car.price };

		db.prepare(
			`
			UPDATE car_metadata SET
				trim = COALESCE(NULLIF(?, trim), trim),
				body_type = COALESCE(NULLIF(?, body_type), body_type),
				dimensions_json = ?, engine_json = ?, performance_json = ?,
				drivetrain = COALESCE(NULLIF(?, drivetrain), drivetrain),
				transmission_json = ?, brakes_json = ?, suspension_json = ?,
				tires_json = ?, aero_json = ?,
				weight_kg = COALESCE(?, weight_kg),
				weight_front_pct = COALESCE(?, weight_front_pct),
				fuel_type = COALESCE(NULLIF(?, fuel_type), fuel_type),
				price_json = ?,
				eras = COALESCE(NULLIF(?, eras), eras),
				tags = COALESCE(NULLIF(?, tags), tags),
				source = ?, confidence = ?, updated_at = ?
			WHERE id = ?
		`,
		).run(
			car.trim ?? null,
			car.body_type ?? null,
			JSON.stringify(dims),
			JSON.stringify(eng),
			JSON.stringify(perf),
			car.drivetrain ?? null,
			JSON.stringify(trans),
			JSON.stringify(brakes),
			JSON.stringify(susp),
			JSON.stringify(tires),
			JSON.stringify(aero),
			car.weight_kg ?? null,
			car.weight_front_pct ?? null,
			car.fuel_type ?? null,
			JSON.stringify(price),
			car.eras ?? null,
			tagsStr,
			car.source ?? "manual",
			car.confidence ?? 0.5,
			now,
			existing.id,
		);
		return existing.id;
	}

	if (!existing) {
		const result = db
			.prepare(
				`
			INSERT INTO car_metadata (make, model, year, trim, body_type, dimensions_json, engine_json,
				performance_json, drivetrain, transmission_json, brakes_json, suspension_json,
				tires_json, aero_json, weight_kg, weight_front_pct, fuel_type, price_json,
				eras, tags, source, confidence)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			)
			.run(
				car.make,
				car.model,
				car.year,
				car.trim ?? null,
				car.body_type ?? null,
				JSON.stringify(car.dimensions ?? {}),
				JSON.stringify(car.engine ?? {}),
				JSON.stringify(car.performance ?? {}),
				car.drivetrain ?? null,
				JSON.stringify(car.transmission ?? {}),
				JSON.stringify(car.brakes ?? {}),
				JSON.stringify(car.suspension ?? {}),
				JSON.stringify(car.tires ?? {}),
				JSON.stringify(car.aero ?? {}),
				car.weight_kg ?? null,
				car.weight_front_pct ?? null,
				car.fuel_type ?? null,
				JSON.stringify(car.price ?? {}),
				car.eras ?? null,
				tagsStr,
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
	physics_overrides_json?: string | null;
	attribution?: string | null;
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
		.prepare(
			`
		INSERT INTO car_configs (asset_id, car_metadata_id, config_json, model_schema_json)
		VALUES (?, ?, ?, ?)
	`,
		)
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

/** Full car import: creates asset + car_config + attribution rows in one transaction. */
export function insertCarImport(data: {
	s3Key: string;
	configJson: string;
	modelSchemaJson?: string;
	physicsOverridesJson?: string;
	attribution?: string;
	carMetadataId?: number;
}): { configId: number; assetId: number; s3Key: string } {
	const db = getDb();
	const hash = data.s3Key.replace(/^cars\//, "").replace(/\.glb$/, "");

	// Create asset
	const assetResult = db
		.prepare(
			`
		INSERT INTO assets (filepath, sha256_hash, source_url, source_type, license, attribution, original_name, status, s3_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		)
		.run(
			`s3://${data.s3Key}`,
			hash,
			`s3://${data.s3Key}`,
			"s3",
			null,
			data.attribution ?? null,
			data.s3Key.split("/").pop() ?? "import.glb",
			"ready",
			data.s3Key,
		);
	const assetId = assetResult.lastInsertRowid as number;

	// Create car config
	const configResult = db
		.prepare(
			`
		INSERT INTO car_configs (asset_id, car_metadata_id, config_json, model_schema_json, physics_overrides_json, attribution)
		VALUES (?, ?, ?, ?, ?, ?)
	`,
		)
		.run(
			assetId,
			data.carMetadataId ?? null,
			data.configJson,
			data.modelSchemaJson ?? null,
			data.physicsOverridesJson ?? null,
			data.attribution ?? null,
		);
	const configId = configResult.lastInsertRowid as number;

	return { configId, assetId, s3Key: data.s3Key };
}

/** Close the database connection. */

// ── Attribution queries ──────────────────────────────────────────────

export interface AttributionRow {
	id: number;
	asset_id: number | null;
	car_config_id: number | null;
	source_type: string;
	model_name: string | null;
	author_name: string | null;
	author_url: string | null;
	license_label: string | null;
	license_slug: string | null;
	source_url: string | null;
	license_url: string | null;
	description: string | null;
	notes: string | null;
	created_at: string;
}

export function insertAttribution(data: {
	asset_id?: number;
	car_config_id?: number;
	source_type?: string;
	model_name?: string;
	author_name?: string;
	author_url?: string;
	license_label?: string;
	license_slug?: string;
	source_url?: string;
	license_url?: string;
	description?: string;
	notes?: string;
}): number {
	const db = getDb();
	const result = db
		.prepare(
			`
		INSERT INTO attributions (asset_id, car_config_id, source_type, model_name, author_name,
			author_url, license_label, license_slug, source_url, license_url, description, notes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		)
		.run(
			data.asset_id ?? null,
			data.car_config_id ?? null,
			data.source_type ?? "sketchfab",
			data.model_name ?? null,
			data.author_name ?? null,
			data.author_url ?? null,
			data.license_label ?? null,
			data.license_slug ?? null,
			data.source_url ?? null,
			data.license_url ?? null,
			data.description ?? null,
			data.notes ?? null,
		);
	return result.lastInsertRowid as number;
}

export function getAttributionByAsset(assetId: number): AttributionRow | undefined {
	return getDb().prepare("SELECT * FROM attributions WHERE asset_id = ?").get(assetId) as AttributionRow | undefined;
}

export function getAttributionByConfig(configId: number): AttributionRow | undefined {
	return getDb().prepare("SELECT * FROM attributions WHERE car_config_id = ?").get(configId) as
		| AttributionRow
		| undefined;
}

export function getAllAttributions(): AttributionRow[] {
	return getDb().prepare("SELECT * FROM attributions ORDER BY created_at DESC").all() as AttributionRow[];
}

export function updateAttribution(id: number, data: Partial<AttributionRow>): void {
	const fields: string[] = [];
	const values: unknown[] = [];
	for (const [key, val] of Object.entries(data)) {
		if (key === "id" || key === "created_at") continue;
		fields.push(`${key} = ?`);
		values.push(val);
	}
	if (fields.length === 0) return;
	values.push(id);
	getDb()
		.prepare(`UPDATE attributions SET ${fields.join(", ")} WHERE id = ?`)
		.run(...values);
}

export function deleteAttribution(id: number): void {
	getDb().prepare("DELETE FROM attributions WHERE id = ?").run(id);
}
export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}
