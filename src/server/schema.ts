/**
 * Drizzle ORM schema definitions for the racing game database.
 *
 * Tables: assets, car_metadata, car_configs, attributions
 * Matches the existing DDL in the original db.ts.
 */

import { relations } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── assets ──────────────────────────────────────────────────────────────

export const assets = sqliteTable(
	"assets",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		filepath: text("filepath").notNull(),
		sha256Hash: text("sha256_hash").notNull(),
		sourceUrl: text("source_url").notNull(),
		sourceType: text("source_type").notNull().default("sketchfab"),
		license: text("license"),
		attribution: text("attribution"),
		originalName: text("original_name").notNull(),
		downloadDate: text("download_date").notNull().default("datetime('now')"),
		status: text("status").notNull().default("pending"),
		metadataJson: text("metadata_json"),
		s3Key: text("s3_key"),
	},
	(table) => [uniqueIndex("idx_assets_source_url").on(table.sourceUrl), index("idx_assets_status").on(table.status)],
);

// ── car_metadata ────────────────────────────────────────────────────────

export const carMetadata = sqliteTable(
	"car_metadata",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		assetId: integer("asset_id").references(() => assets.id),
		make: text("make"),
		model: text("model"),
		year: integer("year"),
		trim: text("trim"),
		bodyType: text("body_type"),
		dimensionsJson: text("dimensions_json"),
		engineJson: text("engine_json"),
		performanceJson: text("performance_json"),
		drivetrain: text("drivetrain"),
		transmissionJson: text("transmission_json"),
		brakesJson: text("brakes_json"),
		suspensionJson: text("suspension_json"),
		tiresJson: text("tires_json"),
		aeroJson: text("aero_json"),
		weightKg: real("weight_kg"),
		weightFrontPct: real("weight_front_pct"),
		fuelType: text("fuel_type"),
		priceJson: text("price_json"),
		eras: text("eras"),
		tags: text("tags"),
		source: text("source").notNull().default("auto"),
		confidence: real("confidence").default(0.5),
		createdAt: text("created_at").notNull().default("datetime('now')"),
		updatedAt: text("updated_at").notNull().default("datetime('now')"),
	},
	(table) => [
		index("idx_car_metadata_asset").on(table.assetId),
		uniqueIndex("idx_car_meta_unique").on(table.make, table.model, table.year),
	],
);

// ── car_configs ─────────────────────────────────────────────────────────

export const carConfigs = sqliteTable(
	"car_configs",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		assetId: integer("asset_id")
			.notNull()
			.references(() => assets.id),
		carMetadataId: integer("car_metadata_id").references(() => carMetadata.id),
		configJson: text("config_json").notNull(),
		modelSchemaJson: text("model_schema_json"),
		physicsOverridesJson: text("physics_overrides_json"),
		attribution: text("attribution"),
		createdDate: text("created_date").notNull().default("datetime('now')"),
	},
	(table) => [index("idx_car_configs_asset").on(table.assetId)],
);

// ── attributions ────────────────────────────────────────────────────────

export const attributions = sqliteTable(
	"attributions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		assetId: integer("asset_id").references(() => assets.id),
		carConfigId: integer("car_config_id").references(() => carConfigs.id),
		sourceType: text("source_type").notNull().default("sketchfab"),
		modelName: text("model_name"),
		authorName: text("author_name"),
		authorUrl: text("author_url"),
		licenseLabel: text("license_label"),
		licenseSlug: text("license_slug"),
		sourceUrl: text("source_url"),
		licenseUrl: text("license_url"),
		description: text("description"),
		notes: text("notes"),
		createdAt: text("created_at").notNull().default("datetime('now')"),
	},
	(table) => [
		index("idx_attributions_asset").on(table.assetId),
		index("idx_attributions_config").on(table.carConfigId),
	],
);

// ── Relations ───────────────────────────────────────────────────────────

export const assetsRelations = relations(assets, ({ many }) => ({
	carConfigs: many(carConfigs),
	carMetadata: many(carMetadata),
	attributions: many(attributions),
}));

export const carMetadataRelations = relations(carMetadata, ({ one, many }) => ({
	asset: one(assets, {
		fields: [carMetadata.assetId],
		references: [assets.id],
	}),
	carConfigs: many(carConfigs),
}));

export const carConfigsRelations = relations(carConfigs, ({ one, many }) => ({
	asset: one(assets, {
		fields: [carConfigs.assetId],
		references: [assets.id],
	}),
	carMetadata: one(carMetadata, {
		fields: [carConfigs.carMetadataId],
		references: [carMetadata.id],
	}),
	attributions: many(attributions),
}));

export const attributionsRelations = relations(attributions, ({ one }) => ({
	asset: one(assets, {
		fields: [attributions.assetId],
		references: [assets.id],
	}),
	carConfig: one(carConfigs, {
		fields: [attributions.carConfigId],
		references: [carConfigs.id],
	}),
}));
