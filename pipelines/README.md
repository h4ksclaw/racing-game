# Asset Pipeline

Scripts and database schema for acquiring and managing 3D game assets.

## Quick Start

```bash
export SKETCHFAB_API_KEY=your_key_here
python pipelines/sketchfab_scraper.py --dry-run
```

## Sketchfab Scraper

Searches the Sketchfab API for free downloadable car models, downloads GLB files, and stores metadata with proper attribution in SQLite.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKETCHFAB_API_KEY` | *(required)* | Sketchfab API token from https://sketchfab.com/settings/oauth |
| `ASSET_DIR` | `./assets/glb` | Where to save downloaded GLB files |
| `DB_PATH` | `./data/game_assets.db` | SQLite database path |

### Usage

```bash
# Dry run — search and log without downloading
python pipelines/sketchfab_scraper.py --dry-run

# Download up to 50 CC0 car models
python pipelines/sketchfab_scraper.py --limit 50

# Search for specific types
python pipelines/sketchfab_scraper.py --query "jdm sports car" --limit 20

# Any downloadable license (not just CC0)
python pipelines/sketchfab_scraper.py --license "" --limit 10
```

### Features

- **Incremental** — skips models already in the database
- **Rate limited** — 0.5s between requests, exponential backoff on 429/5xx
- **Attribution tracking** — every asset stores license and attribution text
- **Dry-run mode** — preview what would be downloaded without using bandwidth
- **SQLite storage** — asset metadata, car metadata, and game configs

### Database Schema

Three tables defined in `schema.sql`:

- **`assets`** — all 3D assets with source info, license, hash, and status
- **`car_metadata`** — make/model/year/body type for car assets
- **`car_configs`** — game-specific CarConfig JSON linked to assets

### Adding Car Metadata

After downloading, you can populate car metadata manually:

```sql
INSERT INTO car_metadata (asset_id, make, model, year, body_type)
VALUES (1, 'Toyota', 'AE86', 1986, 'coupe');
```

Or link game configs:

```sql
INSERT INTO car_configs (asset_id, car_metadata_id, config_json)
VALUES (1, 1, '{"maxSpeed": 180, "acceleration": 0.8, "handling": 0.7}');
```

## Car Metadata Pipeline

Populates the `car_metadata` table with real-world car specifications from public APIs and a curated reference dataset.

### Sources

| Source | Auth Required | Coverage | Quality |
|--------|:---:|---|---|
| `nhtsa` | No | US makes/models (1970s+) | Low (make/model/year only) |
| `fueleconomy` | No | US-market cars (1984+) | Medium (engine, fuel, weight) |
| `reference` | No | Curated JDM/classic cars | High (full specs) |

### Usage

```bash
# Import all reference cars (AE86, MX-5, Civic, Silvia, M3)
python3 car_metadata_pipeline.py --source reference

# Search NHTSA for a specific car
python3 car_metadata_pipeline.py --source nhtsa --search "Toyota Supra"

# Fetch from fueleconomy.gov
python3 car_metadata_pipeline.py --source fueleconomy --search "Honda Civic"

# Run all sources
python3 car_metadata_pipeline.py

# Preview without writing
python3 car_metadata_pipeline.py --source reference --dry-run

# List current DB contents
python3 car_metadata_pipeline.py --list

# Custom database path
python3 car_metadata_pipeline.py --db /path/to/cars.db
```

### Schema (car_metadata)

The table stores JSON blobs for dimensions, engine, performance, transmission, and pricing. Records are deduplicated by `(make, model, year)` — higher-confidence sources update lower ones.

```bash
# Query example
sqlite3 data/game_assets.db "SELECT make, model, year, json_extract(engine_json, '$.power_hp') as hp FROM car_metadata;"
```

### Dependencies

- Python 3.8+ with stdlib only (no pip required)
- `requests` not needed — uses `urllib`
