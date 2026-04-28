CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filepath` text NOT NULL,
	`sha256_hash` text NOT NULL,
	`source_url` text NOT NULL,
	`source_type` text DEFAULT 'sketchfab' NOT NULL,
	`license` text,
	`attribution` text,
	`original_name` text NOT NULL,
	`download_date` text DEFAULT 'datetime(''now'')' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata_json` text,
	`s3_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assets_source_url` ON `assets` (`source_url`);--> statement-breakpoint
CREATE INDEX `idx_assets_status` ON `assets` (`status`);--> statement-breakpoint
CREATE TABLE `attributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer,
	`car_config_id` integer,
	`source_type` text DEFAULT 'sketchfab' NOT NULL,
	`model_name` text,
	`author_name` text,
	`author_url` text,
	`license_label` text,
	`license_slug` text,
	`source_url` text,
	`license_url` text,
	`description` text,
	`notes` text,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`car_config_id`) REFERENCES `car_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attributions_asset` ON `attributions` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_attributions_config` ON `attributions` (`car_config_id`);--> statement-breakpoint
CREATE TABLE `car_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`car_metadata_id` integer,
	`config_json` text NOT NULL,
	`model_schema_json` text,
	`physics_overrides_json` text,
	`attribution` text,
	`created_date` text DEFAULT 'datetime(''now'')' NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`car_metadata_id`) REFERENCES `car_metadata`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_car_configs_asset` ON `car_configs` (`asset_id`);--> statement-breakpoint
CREATE TABLE `car_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer,
	`make` text,
	`model` text,
	`year` integer,
	`trim` text,
	`body_type` text,
	`dimensions_json` text,
	`engine_json` text,
	`performance_json` text,
	`drivetrain` text,
	`transmission_json` text,
	`brakes_json` text,
	`suspension_json` text,
	`tires_json` text,
	`aero_json` text,
	`weight_kg` real,
	`weight_front_pct` real,
	`fuel_type` text,
	`price_json` text,
	`eras` text,
	`tags` text,
	`source` text DEFAULT 'auto' NOT NULL,
	`confidence` real DEFAULT 0.5,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_car_metadata_asset` ON `car_metadata` (`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_car_meta_unique` ON `car_metadata` (`make`,`model`,`year`);