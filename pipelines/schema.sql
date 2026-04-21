-- Asset Pipeline Schema
-- SQLite database for racing game 3D assets

CREATE TABLE IF NOT EXISTS assets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath        TEXT NOT NULL,
    sha256_hash     TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    source_type     TEXT NOT NULL DEFAULT 'sketchfab',  -- sketchfab, custom, poly_pizza, etc.
    license         TEXT,
    attribution     TEXT,
    original_name   TEXT NOT NULL,
    download_date   TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'pending',    -- pending, ready, imported, failed
    metadata_json   TEXT,                               -- full source metadata as JSON
    UNIQUE(source_url)
);

CREATE TABLE IF NOT EXISTS car_metadata (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id        INTEGER REFERENCES assets(id),     -- nullable: metadata can exist without asset
    make            TEXT,
    model           TEXT,
    year            INTEGER,
    body_type       TEXT,                               -- sedan, coupe, hatchback, suv, truck, roadster
    dimensions_json TEXT,                               -- {"length": 4.5, "width": 1.8, "height": 1.4, "wheelbase": 2.6, ...}
    engine_json     TEXT,                               -- {"displacement_l": 2.0, "cylinders": 4, "power_hp": 200, ...}
    performance_json TEXT,                              -- {"0_100_km_h": 5.2, "top_speed_km_h": 250}
    drivetrain      TEXT,                               -- fwd, rwd, awd
    transmission_json TEXT,                             -- {"gear_count": 6, "type": "manual"}
    weight_kg       REAL,
    fuel_type       TEXT,                               -- gasoline, diesel, hybrid, electric
    price_json      TEXT,                               -- {"min_usd": 5000, "max_usd": 15000}
    source          TEXT NOT NULL DEFAULT 'auto',       -- nhtsa, fueleconomy, reference, manual
    confidence      REAL DEFAULT 0.5,                   -- 0-1, data quality score
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_car_meta_unique ON car_metadata(make, model, year);

CREATE TABLE IF NOT EXISTS car_configs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id            INTEGER NOT NULL REFERENCES assets(id),
    car_metadata_id     INTEGER REFERENCES car_metadata(id),
    config_json         TEXT NOT NULL,                  -- CarConfig as JSON
    created_date        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (asset_id) REFERENCES assets(id),
    FOREIGN KEY (car_metadata_id) REFERENCES car_metadata(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_source_url ON assets(source_url);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_car_metadata_asset ON car_metadata(asset_id);
CREATE INDEX IF NOT EXISTS idx_car_configs_asset ON car_configs(asset_id);
