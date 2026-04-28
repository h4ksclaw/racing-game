/**
 * SQLite database manager for game assets and car metadata.
 *
 * Uses Drizzle ORM (with better-sqlite3 driver) for type-safe queries.
 * DB path configurable via DB_PATH env var (default: ./data/game_assets.db).
 *
 * The underlying better-sqlite3 handle is available via _getDbForTesting()
 * for cases that need raw SQL (e.g. complex joins).
 */

import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { getDrizzle, getRawDb, resetDrizzle } from "./drizzle.js";
import { assets, attributions, carConfigs, carMetadata } from "./schema.js";

// ── Internal: ensure schema exists (idempotent, mirrors original db.ts) ──

let _initialized = false;

function ensureSchema() {
	if (_initialized) return;
	const db = getRawDb();

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

	_initialized = true;
}

/** Lazy-initialize the schema on first query access. */
function db() {
	ensureSchema();
	return getDrizzle();
}

/** @internal Test-only access to the raw DB handle. */
export function _getDbForTesting() {
	ensureSchema();
	return getRawDb();
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
	const d = db();
	if (status) {
		return d
			.select()
			.from(assets)
			.where(eq(assets.status, status))
			.orderBy(desc(assets.downloadDate))
			.all() as unknown as AssetRow[];
	}
	return d.select().from(assets).orderBy(desc(assets.downloadDate)).all() as unknown as AssetRow[];
}

export function getAssetById(id: number): AssetRow | undefined {
	const row = db().select().from(assets).where(eq(assets.id, id)).get();
	return row ? (row as unknown as AssetRow) : undefined;
}

export function getAssetByHash(hash: string): AssetRow | undefined {
	const row = db().select().from(assets).where(eq(assets.sha256Hash, hash)).get();
	return row ? (row as unknown as AssetRow) : undefined;
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
	const result = db()
		.insert(assets)
		.values({
			filepath: asset.filepath,
			sha256Hash: asset.sha256_hash,
			sourceUrl: asset.source_url,
			sourceType: asset.source_type,
			license: asset.license ?? null,
			attribution: asset.attribution ?? null,
			originalName: asset.original_name,
			status: asset.status ?? "pending",
			metadataJson: asset.metadata_json ?? null,
		})
		.run();
	return Number(result.lastInsertRowid);
}

export function deleteAsset(id: number): boolean {
	const d = db();
	const asset = getAssetById(id);
	if (!asset) return false;
	// Delete related attributions
	d.delete(attributions).where(eq(attributions.assetId, id)).run();
	// Delete related car configs that reference this asset
	d.delete(carConfigs).where(eq(carConfigs.assetId, id)).run();
	// Delete the asset itself
	d.delete(assets).where(eq(assets.id, id)).run();
	return true;
}

export function updateAssetStatus(id: number, status: string, filepath?: string): void {
	const d = db();
	if (filepath) {
		d.update(assets).set({ status, filepath }).where(eq(assets.id, id)).run();
	} else {
		d.update(assets).set({ status }).where(eq(assets.id, id)).run();
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

/** Convert a Drizzle car_metadata row to the CarMetadata interface. */
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

/** Convert a Drizzle schema row to CarMetadataRow (snake_case). */
function toMetaRow(row: typeof carMetadata.$inferSelect): CarMetadataRow {
	return {
		id: row.id,
		asset_id: row.assetId,
		make: row.make ?? "",
		model: row.model ?? "",
		year: row.year,
		trim: row.trim,
		body_type: row.bodyType,
		dimensions_json: row.dimensionsJson,
		engine_json: row.engineJson,
		performance_json: row.performanceJson,
		drivetrain: row.drivetrain,
		transmission_json: row.transmissionJson,
		brakes_json: row.brakesJson,
		suspension_json: row.suspensionJson,
		tires_json: row.tiresJson,
		aero_json: row.aeroJson,
		weight_kg: row.weightKg,
		weight_front_pct: row.weightFrontPct,
		fuel_type: row.fuelType,
		price_json: row.priceJson,
		eras: row.eras,
		tags: row.tags,
		source: row.source,
		confidence: row.confidence ?? 0.5,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
	};
}

export function getAllCars(): CarMetadata[] {
	const rows = db()
		.select()
		.from(carMetadata)
		.orderBy(asc(carMetadata.make), asc(carMetadata.model), asc(carMetadata.year))
		.all();
	return rows.map((r) => rowToMeta(toMetaRow(r)));
}

export function searchCars(query: string, limit = 20): CarMetadata[] {
	const q = `%${query}%`;
	const rows = db()
		.select()
		.from(carMetadata)
		.where(
			or(like(carMetadata.make, q), like(carMetadata.model, q), like(carMetadata.trim, q), like(carMetadata.tags, q)),
		)
		.orderBy(desc(carMetadata.confidence))
		.limit(limit)
		.all();
	return rows.map((r) => rowToMeta(toMetaRow(r)));
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
	const d = db();
	const conditions = [];

	if (filters.drivetrain) {
		conditions.push(eq(carMetadata.drivetrain, filters.drivetrain));
	}
	if (filters.body_type) {
		conditions.push(like(carMetadata.bodyType, `%${filters.body_type}%`));
	}
	if (filters.min_year !== undefined) {
		conditions.push(sql`${carMetadata.year} >= ${filters.min_year}`);
	}
	if (filters.max_year !== undefined) {
		conditions.push(sql`${carMetadata.year} <= ${filters.max_year}`);
	}
	if (filters.eras) {
		conditions.push(like(carMetadata.eras, `%${filters.eras}%`));
	}
	if (filters.tag) {
		conditions.push(like(carMetadata.tags, `%${filters.tag}%`));
	}
	if (filters.min_weight_kg !== undefined) {
		conditions.push(sql`${carMetadata.weightKg} >= ${filters.min_weight_kg}`);
	}
	if (filters.max_weight_kg !== undefined) {
		conditions.push(sql`${carMetadata.weightKg} <= ${filters.max_weight_kg}`);
	}
	if (filters.min_power_hp !== undefined) {
		conditions.push(sql`json_extract(${carMetadata.engineJson}, '$.power_hp') >= ${filters.min_power_hp}`);
	}
	if (filters.max_power_hp !== undefined) {
		conditions.push(sql`json_extract(${carMetadata.engineJson}, '$.power_hp') <= ${filters.max_power_hp}`);
	}

	const limit = filters.limit ?? 50;
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const rows = d.select().from(carMetadata).where(where).orderBy(desc(carMetadata.confidence)).limit(limit).all();
	return rows.map((r) => rowToMeta(toMetaRow(r)));
}

export function getCarById(id: number): CarMetadata | undefined {
	const row = db().select().from(carMetadata).where(eq(carMetadata.id, id)).get();
	return row ? rowToMeta(toMetaRow(row)) : undefined;
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
	const d = db();
	const rawDb = getRawDb();
	const now = new Date().toISOString();
	const tagsStr = car.tags?.join(",") ?? null;

	const existing = rawDb
		.prepare("SELECT id, confidence FROM car_metadata WHERE make = ? AND model = ? AND year = ?")
		.get(car.make, car.model, car.year) as { id: number; confidence: number } | undefined;

	if (existing && (car.confidence ?? 0.5) > existing.confidence) {
		// Merge: update only non-null fields
		const current = d.select().from(carMetadata).where(eq(carMetadata.id, existing.id)).get()!;
		const curRow = toMetaRow(current);
		const dims = {
			...parseJson<CarDimensions>(curRow.dimensions_json),
			...car.dimensions,
		};
		const eng = { ...parseJson<CarEngine>(curRow.engine_json), ...car.engine };
		const perf = {
			...parseJson<CarPerformance>(curRow.performance_json),
			...car.performance,
		};
		const trans = {
			...parseJson<CarTransmission>(curRow.transmission_json),
			...car.transmission,
		};
		const brakes = {
			...parseJson<CarBrakes>(curRow.brakes_json),
			...car.brakes,
		};
		const susp = {
			...parseJson<CarSuspension>(curRow.suspension_json),
			...car.suspension,
		};
		const tires = { ...parseJson<CarTires>(curRow.tires_json), ...car.tires };
		const aero = { ...parseJson<CarAero>(curRow.aero_json), ...car.aero };
		const price = { ...parseJson<CarPrice>(curRow.price_json), ...car.price };

		d.update(carMetadata)
			.set({
				trim: car.trim ?? null,
				bodyType: car.body_type ?? null,
				dimensionsJson: JSON.stringify(dims),
				engineJson: JSON.stringify(eng),
				performanceJson: JSON.stringify(perf),
				drivetrain: car.drivetrain ?? null,
				transmissionJson: JSON.stringify(trans),
				brakesJson: JSON.stringify(brakes),
				suspensionJson: JSON.stringify(susp),
				tiresJson: JSON.stringify(tires),
				aeroJson: JSON.stringify(aero),
				weightKg: car.weight_kg ?? null,
				weightFrontPct: car.weight_front_pct ?? null,
				fuelType: car.fuel_type ?? null,
				priceJson: JSON.stringify(price),
				eras: car.eras ?? null,
				tags: tagsStr,
				source: car.source ?? "manual",
				confidence: car.confidence ?? 0.5,
				updatedAt: now,
			})
			.where(eq(carMetadata.id, existing.id))
			.run();
		return existing.id;
	}

	if (!existing) {
		const result = d
			.insert(carMetadata)
			.values({
				make: car.make,
				model: car.model,
				year: car.year,
				trim: car.trim ?? null,
				bodyType: car.body_type ?? null,
				dimensionsJson: JSON.stringify(car.dimensions ?? {}),
				engineJson: JSON.stringify(car.engine ?? {}),
				performanceJson: JSON.stringify(car.performance ?? {}),
				drivetrain: car.drivetrain ?? null,
				transmissionJson: JSON.stringify(car.transmission ?? {}),
				brakesJson: JSON.stringify(car.brakes ?? {}),
				suspensionJson: JSON.stringify(car.suspension ?? {}),
				tiresJson: JSON.stringify(car.tires ?? {}),
				aeroJson: JSON.stringify(car.aero ?? {}),
				weightKg: car.weight_kg ?? null,
				weightFrontPct: car.weight_front_pct ?? null,
				fuelType: car.fuel_type ?? null,
				priceJson: JSON.stringify(car.price ?? {}),
				eras: car.eras ?? null,
				tags: tagsStr,
				source: car.source ?? "manual",
				confidence: car.confidence ?? 0.5,
			})
			.run();
		return Number(result.lastInsertRowid);
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

/** Convert a Drizzle car_configs row to CarConfigRow (snake_case). */
function toConfigRow(row: typeof carConfigs.$inferSelect): CarConfigRow {
	return {
		id: row.id,
		asset_id: row.assetId,
		car_metadata_id: row.carMetadataId,
		config_json: row.configJson,
		model_schema_json: row.modelSchemaJson,
		physics_overrides_json: row.physicsOverridesJson,
		attribution: row.attribution,
		created_date: row.createdDate,
	};
}

export function saveCarConfig(
	assetId: number,
	configJson: string,
	modelSchemaJson?: string,
	carMetadataId?: number,
): number {
	const result = db()
		.insert(carConfigs)
		.values({
			assetId,
			carMetadataId: carMetadataId ?? null,
			configJson,
			modelSchemaJson: modelSchemaJson ?? null,
		})
		.run();

	// Mark asset as ready
	updateAssetStatus(assetId, "ready");

	return Number(result.lastInsertRowid);
}

export function getCarConfigs(): CarConfigRow[] {
	const rows = db().select().from(carConfigs).orderBy(desc(carConfigs.createdDate)).all();
	return rows.map(toConfigRow);
}

export function getCarConfigById(id: number): CarConfigRow | undefined {
	const row = db().select().from(carConfigs).where(eq(carConfigs.id, id)).get();
	return row ? toConfigRow(row) : undefined;
}

export function getCarConfigsByAsset(assetId: number): CarConfigRow[] {
	const rows = db().select().from(carConfigs).where(eq(carConfigs.assetId, assetId)).all();
	return rows.map(toConfigRow);
}

/** Delete a car config by ID. Returns the associated asset for S3 cleanup. */
export function deleteCarConfig(configId: number): { s3Key: string | null; assetId: number } | null {
	const config = getCarConfigById(configId);
	if (!config) return null;
	const asset = getAssetById(config.asset_id);
	const s3Key = asset?.s3_key ?? null;
	// Delete config row
	db().delete(carConfigs).where(eq(carConfigs.id, configId)).run();
	// Also delete the asset if no other configs reference it
	const remaining = getCarConfigsByAsset(config.asset_id);
	if (remaining.length === 0 && config.asset_id) {
		deleteAsset(config.asset_id);
	}
	return { s3Key, assetId: config.asset_id };
}

/** Full car import: creates asset + car_config rows in one transaction. */
export function insertCarImport(data: {
	s3Key: string;
	configJson: string;
	modelSchemaJson?: string;
	physicsOverridesJson?: string;
	attribution?: string;
	carMetadataId?: number;
}): { configId: number; assetId: number; s3Key: string } {
	const rawDb = getRawDb();
	const hash = data.s3Key.replace(/^cars\//, "").replace(/\.glb$/, "");

	// Use a transaction via the raw DB for atomicity (Drizzle's better-sqlite3
	// transaction helper requires a callback, which is more complex here).
	rawDb.exec("BEGIN");

	try {
		// Create asset
		const assetResult = rawDb
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
		const assetId = Number(assetResult.lastInsertRowid);

		// Create car config
		const configResult = rawDb
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
		const configId = Number(configResult.lastInsertRowid);

		// Mark any existing asset with the same hash as "imported" (no longer pending)
		rawDb.prepare("UPDATE assets SET status = 'imported' WHERE sha256_hash = ? AND status = 'pending'").run(hash);

		rawDb.exec("COMMIT");
		return { configId, assetId, s3Key: data.s3Key };
	} catch (err) {
		rawDb.exec("ROLLBACK");
		throw err;
	}
}

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

/** Convert a Drizzle attributions row to AttributionRow (snake_case). */
function toAttrRow(row: typeof attributions.$inferSelect): AttributionRow {
	return {
		id: row.id,
		asset_id: row.assetId,
		car_config_id: row.carConfigId,
		source_type: row.sourceType,
		model_name: row.modelName,
		author_name: row.authorName,
		author_url: row.authorUrl,
		license_label: row.licenseLabel,
		license_slug: row.licenseSlug,
		source_url: row.sourceUrl,
		license_url: row.licenseUrl,
		description: row.description,
		notes: row.notes,
		created_at: row.createdAt,
	};
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
	const result = db()
		.insert(attributions)
		.values({
			assetId: data.asset_id ?? null,
			carConfigId: data.car_config_id ?? null,
			sourceType: data.source_type ?? "sketchfab",
			modelName: data.model_name ?? null,
			authorName: data.author_name ?? null,
			authorUrl: data.author_url ?? null,
			licenseLabel: data.license_label ?? null,
			licenseSlug: data.license_slug ?? null,
			sourceUrl: data.source_url ?? null,
			licenseUrl: data.license_url ?? null,
			description: data.description ?? null,
			notes: data.notes ?? null,
		})
		.run();
	return Number(result.lastInsertRowid);
}

export function getAttributionByAsset(assetId: number): AttributionRow | undefined {
	const row = db().select().from(attributions).where(eq(attributions.assetId, assetId)).get();
	return row ? toAttrRow(row) : undefined;
}

export function getAttributionByConfig(configId: number): AttributionRow | undefined {
	const row = db().select().from(attributions).where(eq(attributions.carConfigId, configId)).get();
	return row ? toAttrRow(row) : undefined;
}

export function getAllAttributions(): AttributionRow[] {
	const rows = db().select().from(attributions).orderBy(desc(attributions.createdAt)).all();
	return rows.map(toAttrRow);
}

export function updateAttribution(id: number, data: Partial<AttributionRow>): void {
	const fields: Partial<typeof attributions.$inferInsert> = {};
	for (const [key, val] of Object.entries(data)) {
		if (key === "id" || key === "created_at") continue;
		// Map snake_case to camelCase
		const mapping: Record<string, keyof typeof fields> = {
			asset_id: "assetId",
			car_config_id: "carConfigId",
			source_type: "sourceType",
			model_name: "modelName",
			author_name: "authorName",
			author_url: "authorUrl",
			license_label: "licenseLabel",
			license_slug: "licenseSlug",
			source_url: "sourceUrl",
			license_url: "licenseUrl",
			description: "description",
			notes: "notes",
		};
		const mapped = mapping[key];
		if (mapped) {
			(fields as Record<string, unknown>)[mapped] = val;
		}
	}
	if (Object.keys(fields).length === 0) return;
	db().update(attributions).set(fields).where(eq(attributions.id, id)).run();
}

export function deleteAttribution(id: number): void {
	db().delete(attributions).where(eq(attributions.id, id)).run();
}

/** Close the database connection and reset the singleton. */
export function closeDb(): void {
	resetDrizzle();
	_initialized = false;
}
