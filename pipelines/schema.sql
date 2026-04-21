-- Asset Pipeline Schema
-- SQLite database for racing game 3D assets and car metadata
-- Run via: sqlite3 data/game_assets.db < pipelines/schema.sql
-- Or let the pipeline/scripts auto-migrate via ALTER TABLE ADD COLUMN

-- ── Assets (GLB files, pending or ready) ──────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath        TEXT NOT NULL,
    sha256_hash     TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    source_type     TEXT NOT NULL DEFAULT 'sketchfab',  -- sketchfab, upload, poly_pizza, etc.
    license         TEXT,                               -- e.g. "CC BY 4.0", "CC0"
    attribution     TEXT,                               -- author + license string
    original_name   TEXT NOT NULL,
    download_date   TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'pending',    -- pending, ready, imported, failed
    metadata_json   TEXT,                               -- full source metadata as JSON
    UNIQUE(source_url)
);

-- ── Car metadata (real-world vehicle specs) ────────────────────────────

CREATE TABLE IF NOT EXISTS car_metadata (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id        INTEGER REFERENCES assets(id),     -- nullable: metadata can exist without asset
    make            TEXT NOT NULL,
    model           TEXT NOT NULL,
    year            INTEGER NOT NULL,
    trim            TEXT,                               -- e.g. "GT-Apex", "Spec R", "Type R"
    body_type       TEXT,                               -- sedan, coupe, hatchback, suv, truck, roadster
    dimensions_json TEXT,                               -- {"length": 4.5, "width": 1.8, "height": 1.4, "wheelbase": 2.6, ...}
    engine_json     TEXT,                               -- {"displacement_l": 2.0, "cylinders": 4, "power_hp": 200, "torque_nm": 275, ...}
    performance_json TEXT,                              -- {"0_100_km_h": 5.2, "top_speed_km_h": 250, "lateral_g": 0.92}
    drivetrain      TEXT,                               -- fwd, rwd, awd
    transmission_json TEXT,                             -- {"gear_count": 6, "type": "manual", "final_drive": 3.62}
    brakes_json     TEXT,                               -- {"front_type": "ventilated_disc", "rear_type": "disc", "front_diameter_mm": 345}
    suspension_json TEXT,                               -- {"front_type": "macpherson", "rear_type": "multilink"}
    tires_json      TEXT,                               -- {"front_size": "225/40R19", "rear_size": "255/35R19", "width_mm": 225}
    aero_json       TEXT,                               -- {"drag_coefficient": 0.35, "downforce_kg": 35}
    weight_kg       REAL,                               -- curb weight in kg
    weight_front_pct REAL,                              -- front weight distribution (50-60 typical)
    fuel_type       TEXT,                               -- gasoline, diesel, hybrid, electric
    price_json      TEXT,                               -- {"min_usd": 5000, "max_usd": 15000, "avg_usd": 10000}
    eras            TEXT,                               -- comma-separated: "80s,90s" or "2000s"
    tags            TEXT,                               -- comma-separated: "jdm,drift,turbo,classic"
    source          TEXT NOT NULL DEFAULT 'auto',       -- nhtsa, fueleconomy, reference, manual
    confidence      REAL DEFAULT 0.5,                   -- 0-1, data quality score
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Car configs (game-ready presets linking asset + metadata + physics) ─

CREATE TABLE IF NOT EXISTS car_configs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id            INTEGER NOT NULL REFERENCES assets(id),
    car_metadata_id     INTEGER REFERENCES car_metadata(id),
    config_json         TEXT NOT NULL,                  -- CarConfig as JSON
    model_schema_json   TEXT,                           -- CarModelSchema as JSON (marker mapping)
    created_date        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_car_meta_unique ON car_metadata(make, model, year);
CREATE INDEX IF NOT EXISTS idx_assets_source_url ON assets(source_url);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_car_metadata_asset ON car_metadata(asset_id);
CREATE INDEX IF NOT EXISTS idx_car_metadata_drivetrain ON car_metadata(drivetrain);
CREATE INDEX IF NOT EXISTS idx_car_configs_asset ON car_configs(asset_id);
CREATE INDEX IF NOT EXISTS idx_car_configs_metadata ON car_configs(car_metadata_id);
