# Car Data Pipeline

## Overview

The car data pipeline imports real-world car specifications from five public sources into a local SQLite database. This data feeds the racing game's car browser and physics prediction system — each car record stores raw metadata (dimensions, engine specs, performance figures) that the game's predictor converts to physics parameters at query time.

Current DB: ~21K unique cars across all sources.

## Architecture

```
Sources (5) → Normalize → Upsert (merge/gap-fill) → Cross-Source Enrich → Dedup → Clean
```

1. **Sources** fetch raw data from APIs, scraped pages, and static datasets
2. **Normalize** converts units, standardizes field names, filters body types
3. **Upsert** inserts new cars or merges into existing rows (gap-fill mode)
4. **Enrich** cross-references matching cars across sources to fill missing fields
5. **Dedup** removes duplicate (make, model, year, source) entries, keeping the most complete

Each source has a confidence score (0–1). Higher-confidence sources take priority as the base record during enrichment.

## Data Sources

| Source | URL / Origin | Coverage | Key Fields | Confidence | Limitations |
|--------|-------------|----------|------------|:----------:|-------------|
| **CarQuery** | [GitHub mirror](https://github.com/imamhossain94/car-make-model-trim-data) (pre-shutdown API) | ~18K trims (155 makes) | Dimensions, engine, transmission, weight, performance, fuel economy | 0.4 | Weight is mixed kg/lbs; torque mislabeled as Nm (actually lb-ft); gear count mostly unavailable |
| **AutoSpecs** | [autospecs.com](https://www.autospecs.com/) (scraped) | ~764 cars | Tire sizes, dimensions, top speed, drivetrain, body type | 0.7 | Small dataset; scraping-dependent |
| **FuelEconomy** | [fueleconomy.gov API](https://fueleconomy.gov/) | ~40K US-market (1984+) | Engine, fuel economy, cylinders, transmission, weight | 0.3 | US-only; sparse performance data; no dimensions |
| **NHTSA** | [NHTSA VPIC API](https://vpic.nhtsa.dot.gov/) | ~60K US makes/models | Make, model, year, body type, drivetrain | 0.2 | Specs-only; no engine/performance data |
| **Reference** | Hand-curated JSON | ~50 JDM/classic cars | Full specs (hand-verified) | 0.9 | Tiny dataset; manual maintenance |

## Unit Conventions

All values in the database use these units:

| Field | Unit | Notes |
|-------|------|-------|
| Weight | kg | CarQuery values converted from lbs where needed |
| Power | hp | Converted from PS (× 0.98632) at source |
| Torque | Nm | CarQuery values converted from lb-ft (× 1.35582) |
| Dimensions | meters | Converted from mm (÷ 1000) |
| Speed | km/h | Top speed as-is from source |
| Displacement | liters | Converted from cc (÷ 1000) |
| Acceleration | seconds | 0-100 km/h |

## Known Data Issues

- **CarQuery weight** is mixed-unit (kg and lbs) with no per-record indicator. A clustering heuristic groups trims by (model, year) to detect which are kg vs lbs. Ambiguous single-value records use a US-market heuristic.
- **CarQuery torque** is labeled "Nm" in the dataset but is actually lb-ft. Converted at ingestion time using × 1.35582.
- **Gear count** is fundamentally unavailable from CarQuery (only 5.1% recoverable from trim string parsing). Most cars will have `transmission.type` but no `gear_count`.
- **Tire sizes** only available from AutoSpecs (764 cars, ~3.3% of DB). Most cars have no tire data.
- **Top speed** and **0-100 km/h** data are sparse (26% and 14% of DB respectively). Enrichment helps fill some gaps from cross-source matching.

## Pipeline Usage

```bash
# Import from a single source
python3 pipelines/cli.py --source carquery
python3 pipelines/cli.py --source autospecs
python3 pipelines/cli.py --source fueleconomy --search "Honda Civic"

# Import all sources in parallel
python3 pipelines/cli.py --source all --parallel

# Run cross-source enrichment (fills gaps across sources)
python3 pipelines/cli.py --enrich

# Deduplicate and re-normalize existing data
python3 pipelines/cli.py --cleanup

# List current DB contents
python3 pipelines/cli.py --list

# Dry run (preview without writing)
python3 pipelines/cli.py --source carquery --dry-run

# Carquery-specific: limit makes, set checkpoint for resume
python3 pipelines/cli.py --source carquery --makes toyota,honda --limit 100 --checkpoint data/carquery_checkpoint.json
```

## Game Integration

The pipeline produces metadata only — no physics predictions. Data flows into the game like this:

1. **SQLite DB** (`data/game_assets.db`) stores raw car metadata
2. **Express API** (`/api/cars?predict=true`) reads metadata and runs the predictor on-the-fly
3. **Predictor** converts metadata (weight, power, torque, drivetrain) into CarConfig physics values
4. **CarConfig presets** in `configs.ts` are the final physics engine input
5. **Metadata → CarConfig mapping** is not yet automated (planned as `derive_physics.py`)

## Adding a New Source

1. Create `pipelines/sources/newsource.py` with a fetch function returning `list[dict]` where each dict has: `make`, `model`, `year`, plus any spec fields
2. Register the import function in `pipelines/sources/__init__.py`
3. Add to `SOURCES` dict in `pipelines/cli.py`
4. Run `python3 pipelines/cli.py --source newsource --dry-run` to verify
5. Run for real and check coverage with `--list`
6. Consider adding field trust rules to `pipelines/enrichment.py` `FIELD_TRUST` for cross-source enrichment
