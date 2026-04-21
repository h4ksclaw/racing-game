# Car Metadata Pipeline

Populates the `car_metadata` table with real-world car specifications from five sources: CarQuery, AutoSpecs, FuelEconomy.gov, NHTSA, and a hand-curated reference dataset.

**Current DB: ~21K unique cars.**

## Quick Start

```bash
# Import all sources in parallel
python3 pipelines/cli.py --source all --parallel

# Run cross-source enrichment (fills gaps)
python3 pipelines/cli.py --enrich

# Deduplicate and normalize
python3 pipelines/cli.py --cleanup

# List DB contents
python3 pipelines/cli.py --list
```

## Sources

| Source | Coverage | Confidence | Key Data |
|--------|----------|:----------:|----------|
| CarQuery | ~18K trims, 155 makes | 0.4 | Dimensions, engine, weight, performance |
| AutoSpecs | ~764 cars | 0.7 | Tire sizes, top speed, drivetrain |
| FuelEconomy.gov | ~40K US-market (1984+) | 0.3 | Engine, fuel economy, weight |
| NHTSA | ~60K US makes/models | 0.2 | Make, model, year, body type |
| Reference | ~50 JDM/classic cars | 0.9 | Full specs (hand-verified) |

## CLI Options

```bash
python3 pipelines/cli.py [OPTIONS]

  --source {nhtsa,fueleconomy,reference,autospecs,carquery,all}
  --search TEXT          Search filter (e.g. "Toyota AE86")
  --db PATH              SQLite database path (default: data/game_assets.db)
  --dry-run              Preview without writing
  --list                 List current DB contents
  --parallel             Run sources concurrently
  --workers N            Worker threads for parallel mode (default: 4)
  --cleanup              Deduplicate and re-normalize existing data
  --enrich               Run cross-source enrichment
  --makes TEXT           Comma-separated makes (carquery only)
  --limit N              Max cars per make (carquery only)
  --checkpoint PATH      Checkpoint file for resume (carquery only)
```

## Data Flow

Sources → Normalize → Upsert (merge) → Cross-Source Enrich → Dedup

See [`aidocs/car-data-pipeline.md`](../aidocs/car-data-pipeline.md) for detailed architecture, unit conventions, known data issues, and instructions for adding new sources.

## Dependencies

Python 3.8+ with stdlib only. No pip packages required.
