#!/usr/bin/env python3
"""Car Metadata Pipeline - Populates car_metadata table from public APIs and reference data.

Sources:
  - nhtsa: US DOT Vehicle API (free, no key) - make/model/year listings
  - fueleconomy: US DOE fuel economy API (free, no key) - specs for US-market cars
  - reference: Hardcoded dataset for classic/JDM cars APIs don't cover

Usage:
  python car_metadata_pipeline.py                          # all sources, reference cars
  python car_metadata_pipeline.py --source nhtsa           # NHTSA only
  python car_metadata_pipeline.py --source fueleconomy --search "Honda Civic"
  python car_metadata_pipeline.py --dry-run                # preview without writing
  python car_metadata_pipeline.py --source reference --search "AE86"
  python car_metadata_pipeline.py --db /path/to/db.sqlite  # custom DB path
"""

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Reference dataset for classic/JDM cars not well-covered by US APIs
# ---------------------------------------------------------------------------
REFERENCE_CARS = [
    # Toyota AE86 (1983-1987)
    {
        "make": "Toyota", "model": "Corolla AE86 (Sprinter Trueno)", "year": 1986,
        "body_type": "coupe",
        "dimensions": {"length": 4.26, "width": 1.63, "height": 1.34, "wheelbase": 2.43, "track_width": 1.40, "ground_clearance": 0.15},
        "engine": {"displacement_l": 1.6, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 130, "torque_nm": 152, "max_rpm": 7600, "compression_ratio": 9.4},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 940, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 8.3, "top_speed_km_h": 190},
        "price": {"min_usd": 2500, "max_usd": 35000, "note": "original MSRP ~$9k; restored $15k-35k"},
        "confidence": 0.9, "source": "reference"
    },
    # Mazda MX-5 NA (1989-1997)
    {
        "make": "Mazda", "model": "MX-5 Miata NA", "year": 1990,
        "body_type": "roadster",
        "dimensions": {"length": 3.97, "width": 1.67, "height": 1.23, "wheelbase": 2.27, "track_width": 1.40, "ground_clearance": 0.14},
        "engine": {"displacement_l": 1.6, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 116, "torque_nm": 137, "max_rpm": 6500, "compression_ratio": 9.0},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 960, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 9.4, "top_speed_km_h": 183},
        "price": {"min_usd": 2000, "max_usd": 15000, "note": "original MSRP ~$14k; good ones $5k-15k"},
        "confidence": 0.9, "source": "reference"
    },
    {
        "make": "Mazda", "model": "MX-5 Miata NB", "year": 2000,
        "body_type": "roadster",
        "dimensions": {"length": 3.95, "width": 1.67, "height": 1.22, "wheelbase": 2.29, "track_width": 1.44, "ground_clearance": 0.14},
        "engine": {"displacement_l": 1.8, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 146, "torque_nm": 167, "max_rpm": 6800, "compression_ratio": 10.0},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1040, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.8, "top_speed_km_h": 200},
        "price": {"min_usd": 3000, "max_usd": 18000, "note": "original MSRP ~$21k"},
        "confidence": 0.9, "source": "reference"
    },
    # Honda Civic (multiple generations)
    {
        "make": "Honda", "model": "Civic EG6 (Si II)", "year": 1995,
        "body_type": "hatchback",
        "dimensions": {"length": 4.19, "width": 1.70, "height": 1.35, "wheelbase": 2.57, "track_width": 1.47, "ground_clearance": 0.15},
        "engine": {"displacement_l": 1.6, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 160, "torque_nm": 150, "max_rpm": 7800, "compression_ratio": 10.4},
        "drivetrain": "fwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1060, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.5, "top_speed_km_h": 210},
        "price": {"min_usd": 3000, "max_usd": 25000, "note": "JDM Si II, B16A engine"},
        "confidence": 0.85, "source": "reference"
    },
    {
        "make": "Honda", "model": "Civic EK9 (Type R)", "year": 1998,
        "body_type": "hatchback",
        "dimensions": {"length": 4.18, "width": 1.70, "height": 1.38, "wheelbase": 2.62, "track_width": 1.47, "ground_clearance": 0.15},
        "engine": {"displacement_l": 1.6, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 185, "torque_nm": 160, "max_rpm": 8200, "compression_ratio": 10.8},
        "drivetrain": "fwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1040, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.7, "top_speed_km_h": 215},
        "price": {"min_usd": 8000, "max_usd": 40000, "note": "JDM only, B16B engine"},
        "confidence": 0.85, "source": "reference"
    },
    # Nissan Silvia S13
    {
        "make": "Nissan", "model": "Silvia S13", "year": 1989,
        "body_type": "coupe",
        "dimensions": {"length": 4.47, "width": 1.69, "height": 1.29, "wheelbase": 2.47, "track_width": 1.46, "ground_clearance": 0.15},
        "engine": {"displacement_l": 1.8, "cylinders": 4, "configuration": "I4", "aspiration": "turbo",
                    "power_hp": 177, "torque_nm": 226, "max_rpm": 6800, "compression_ratio": 8.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1080, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.0, "top_speed_km_h": 215},
        "price": {"min_usd": 3000, "max_usd": 30000, "note": "CA18DET turbo; SR20DET in later S13"},
        "confidence": 0.85, "source": "reference"
    },
    {
        "make": "Nissan", "model": "Silvia S14 (Kouki)", "year": 1997,
        "body_type": "coupe",
        "dimensions": {"length": 4.50, "width": 1.73, "height": 1.31, "wheelbase": 2.52, "track_width": 1.48, "ground_clearance": 0.14},
        "engine": {"displacement_l": 2.0, "cylinders": 4, "configuration": "I4", "aspiration": "turbo",
                    "power_hp": 220, "torque_nm": 275, "max_rpm": 7000, "compression_ratio": 8.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1240, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.0, "top_speed_km_h": 235},
        "price": {"min_usd": 5000, "max_usd": 35000, "note": "SR20DET, JDM spec"},
        "confidence": 0.85, "source": "reference"
    },
    {
        "make": "Nissan", "model": "Silvia S15 Spec R", "year": 2002,
        "body_type": "coupe",
        "dimensions": {"length": 4.44, "width": 1.73, "height": 1.32, "wheelbase": 2.52, "track_width": 1.48, "ground_clearance": 0.14},
        "engine": {"displacement_l": 2.0, "cylinders": 4, "configuration": "I4", "aspiration": "turbo",
                    "power_hp": 247, "torque_nm": 275, "max_rpm": 7200, "compression_ratio": 8.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 6, "type": "manual"},
        "weight_kg": 1240, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 5.4, "top_speed_km_h": 245},
        "price": {"min_usd": 10000, "max_usd": 50000, "note": "SR20DET, JDM only"},
        "confidence": 0.85, "source": "reference"
    },
    # BMW M3 E30
    {
        "make": "BMW", "model": "M3 E30", "year": 1989,
        "body_type": "coupe",
        "dimensions": {"length": 4.33, "width": 1.68, "height": 1.37, "wheelbase": 2.57, "track_width": 1.41, "ground_clearance": 0.13},
        "engine": {"displacement_l": 2.3, "cylinders": 4, "configuration": "I4", "aspiration": "NA",
                    "power_hp": 200, "torque_nm": 240, "max_rpm": 7000, "compression_ratio": 10.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1200, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.7, "top_speed_km_h": 235},
        "price": {"min_usd": 30000, "max_usd": 150000, "note": "S14 engine, collector car"},
        "confidence": 0.9, "source": "reference"
    },
    # BMW M3 E36
    {
        "make": "BMW", "model": "M3 E36", "year": 1996,
        "body_type": "coupe",
        "dimensions": {"length": 4.43, "width": 1.71, "height": 1.35, "wheelbase": 2.70, "track_width": 1.43, "ground_clearance": 0.12},
        "engine": {"displacement_l": 3.2, "cylinders": 6, "configuration": "I6", "aspiration": "NA",
                    "power_hp": 321, "torque_nm": 350, "max_rpm": 7000, "compression_ratio": 10.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 5, "type": "manual"},
        "weight_kg": 1460, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 5.5, "top_speed_km_h": 250},
        "price": {"min_usd": 5000, "max_usd": 30000, "note": "US-spec 240hp; Euro 321hp shown here"},
        "confidence": 0.85, "source": "reference"
    },
    # BMW M3 E46
    {
        "make": "BMW", "model": "M3 E46", "year": 2003,
        "body_type": "coupe",
        "dimensions": {"length": 4.57, "width": 1.78, "height": 1.37, "wheelbase": 2.76, "track_width": 1.51, "ground_clearance": 0.11},
        "engine": {"displacement_l": 3.2, "cylinders": 6, "configuration": "I6", "aspiration": "NA",
                    "power_hp": 343, "torque_nm": 365, "max_rpm": 7900, "compression_ratio": 11.5},
        "drivetrain": "rwd", "transmission": {"gear_count": 6, "type": "manual"},
        "weight_kg": 1570, "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 4.8, "top_speed_km_h": 250},
        "price": {"min_usd": 8000, "max_usd": 50000, "note": "S54 engine, SMG or manual"},
        "confidence": 0.9, "source": "reference"
    },
]

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get_json(url, timeout=15):
    """GET a URL and return parsed JSON. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  [warn] API error for {url}: {e}")
        return None


def api_get_xml(url, timeout=15):
    """GET a URL and return parsed XML ElementTree root. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return ET.fromstring(resp.read().decode())
    except Exception as e:
        print(f"  [warn] API error for {url}: {e}")
        return None


# ---------------------------------------------------------------------------
# NHTSA source - US DOT Vehicle API
# ---------------------------------------------------------------------------

NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles"


def nhtsa_get_models(make, year=None):
    """Get models for a make from NHTSA."""
    url = f"{NHTSA_BASE}/getmodelsformake/{urllib.parse.quote(make)}?format=json"
    if year:
        url += f"&modelYear={year}"
    data = api_get_json(url)
    if data and data.get("Results"):
        return [(r["Make_Name"], r["Model_Name"]) for r in data["Results"]]
    return []


def nhtsa_source(search=None, dry_run=False):
    """Fetch car listings from NHTSA. Returns list of car dicts."""
    cars = []
    makes_models = []

    if search:
        parts = search.split()
        if len(parts) >= 2:
            makes_models = [(parts[0], " ".join(parts[1:]))]
        else:
            makes_models = [(search, None)]
    else:
        # Default: fetch models for popular makes
        for make in ["Toyota", "Honda", "Nissan", "Mazda", "BMW", "Ford", "Chevrolet"]:
            models = nhtsa_get_models(make)
            if models:
                makes_models.extend(models)
            time.sleep(0.3)  # rate limit courtesy

    for make, model in makes_models:
        if not model:
            # Make-only search: get all models
            models = nhtsa_get_models(make)
            for m, mdl in models:
                cars.append({
                    "make": m, "model": mdl, "year": 2020,
                    "body_type": None,
                    "dimensions": {}, "engine": {}, "performance": {},
                    "drivetrain": None, "transmission": {},
                    "weight_kg": None, "fuel_type": None,
                    "price": {}, "confidence": 0.3, "source": "nhtsa"
                })
            continue

        # Get specific model - try a few recent years
        for year in range(2024, 2018, -1):
            url = f"{NHTSA_BASE}/GetModelsForMakeYear/make/{urllib.parse.quote(make)}/modelyear/{year}?format=json"
            data = api_get_json(url)
            if data and data.get("Results"):
                for r in data["Results"]:
                    model_name = r.get("Model_Name", model)
                    # Filter to matching model if specific search
                    if model and model.lower() not in model_name.lower():
                        continue
                    cars.append({
                        "make": r.get("Make_Name", make).title(),
                        "model": model_name,
                        "year": year,
                        "body_type": None,
                        "dimensions": {},
                        "engine": {},
                        "performance": {},
                        "drivetrain": None,
                        "transmission": {},
                        "weight_kg": None,
                        "fuel_type": None,
                        "price": {},
                        "confidence": 0.3,
                        "source": "nhtsa"
                    })
                break
        time.sleep(0.3)

    return cars


# ---------------------------------------------------------------------------
# FuelEconomy.gov source
# ---------------------------------------------------------------------------

FE_BASE = "https://fueleconomy.gov/ws/rest/vehicle"


def fe_source(search=None, dry_run=False):
    """Fetch car specs from fueleconomy.gov API.

    Flow: make -> model (trim list) -> options (vehicle IDs) -> vehicle spec by ID.
    Each step is a separate XML menu API call.
    """
    cars = []
    year = 2020  # representative year for US-market cars

    if search:
        parts = search.split()
        make = parts[0] if parts else None
        model_filter = " ".join(parts[1:]) if len(parts) > 1 else None
        makes_to_fetch = [make] if make else []
    else:
        makes_to_fetch = ["Toyota", "Honda", "Nissan", "Mazda", "BMW"]

    for make in makes_to_fetch:
        # Step 1: get model/trim list for this make
        models_xml = api_get_xml(f"{FE_BASE}/menu/model?year={year}&make={urllib.parse.quote(make)}")
        if models_xml is None:
            continue

        models = [(item.find("text").text, item.find("value").text)
                  for item in models_xml.findall(".//menuItem")
                  if item.find("text") is not None and item.find("value") is not None]
        if model_filter:
            models = [(t, v) for t, v in models if model_filter.lower() in t.lower()]
        if not models:
            continue

        for trim_name, trim_value in models[:5]:
            # Step 2: get options -> vehicle IDs
            opts_xml = api_get_xml(
                f"{FE_BASE}/menu/options?year={year}&make={urllib.parse.quote(make)}&model={urllib.parse.quote(trim_value)}"
            )
            if opts_xml is None:
                continue

            options = [(item.find("text").text, item.find("value").text)
                       for item in opts_xml.findall(".//menuItem")
                       if item.find("text") is not None and item.find("value") is not None]

            # Step 3: fetch vehicle spec by ID
            for opt_text, vid in options[:2]:
                if not vid:
                    continue
                spec_xml = api_get_xml(f"{FE_BASE}/{vid}")
                if spec_xml is None:
                    continue

                car = _parse_fe_vehicle(spec_xml, make, trim_name)
                if car:
                    cars.append(car)

            time.sleep(0.5)

    return cars


def _parse_fe_vehicle(xml_root, make, model):
    """Parse a fueleconomy.gov vehicle XML response into a car dict."""
    def text(tag):
        el = xml_root.find(tag)
        return el.text.strip() if el is not None and el.text else None

    def num(tag, default=None):
        v = text(tag)
        if v:
            try:
                return float(v.replace(",", ""))
            except ValueError:
                pass
        return default

    try:
        year = int(text("year") or 2020)
    except (ValueError, TypeError):
        year = 2020

    engine = {}
    disp = num("displ")
    if disp:
        engine["displacement_l"] = disp
    cyl = text("cylinders")
    if cyl:
        try:
            engine["cylinders"] = int(cyl)
        except ValueError:
            pass
    engine["configuration"] = text("eng_dscr") or None
    power_hp = num("hpv")
    if power_hp:
        engine["power_hp"] = power_hp

    perf = {}
    speed = num("sCharger")  # not quite top speed, but we have limited data
    co2 = text("co2")
    if co2:
        perf["co2_grams_per_mile"] = float(co2)

    dims = {}
    # FuelEconomy doesn't have dimensions, but we take what we can

    # Drivetrain from transmission description
    drive_raw = text("trany") or ""
    drive = "awd" if "AWD" in drive_raw else ("rwd" if "RWD" in drive_raw else "fwd")

    weight = num("pv4", None)  # not always available
    fuel = text("fuelType1") or "gasoline"

    car = {
        "make": text("make") or make,
        "model": text("model") or model,
        "year": year,
        "body_type": None,
        "dimensions": dims,
        "engine": engine,
        "performance": perf,
        "drivetrain": drive,
        "transmission": {"type": drive_raw} if drive_raw else {},
        "weight_kg": int(weight) if weight else None,
        "fuel_type": fuel,
        "price": {},
        "confidence": 0.5,  # moderate - specs are real but incomplete
        "source": "fueleconomy"
    }
    return car


# ---------------------------------------------------------------------------
# Reference source
# ---------------------------------------------------------------------------

def reference_source(search=None, dry_run=False):
    """Return hardcoded reference cars, optionally filtered."""
    cars = REFERENCE_CARS
    if search:
        q = search.lower()
        cars = [c for c in cars if q in f"{c['make']} {c['model']}".lower()]
    return cars


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

DEFAULT_DB = "racing-game/game/data/game_assets.db"


def init_db(db_path):
    """Create car_metadata table if it doesn't exist."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS car_metadata (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
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
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_car_meta_unique
        ON car_metadata(make, model, year)
    """)
    conn.commit()
    return conn


def upsert_car(conn, car, dry_run=False):
    """Insert or update a car record. Deduplicates by make+model+year."""
    now = datetime.now(timezone.utc).isoformat()
    existing = conn.execute(
        "SELECT id, source, confidence FROM car_metadata WHERE make=? AND model=? AND year=?",
        (car["make"], car["model"], car["year"])
    ).fetchone()

    if existing:
        eid, old_source, old_conf = existing
        # Merge: keep higher confidence, combine data
        if car.get("confidence", 0.5) > old_conf:
            new_dims = _merge_json(conn, eid, "dimensions_json", car.get("dimensions", {}))
            new_eng = _merge_json(conn, eid, "engine_json", car.get("engine", {}))
            new_perf = _merge_json(conn, eid, "performance_json", car.get("performance", {}))
            new_price = _merge_json(conn, eid, "price_json", car.get("price", {}))
            new_trans = _merge_json(conn, eid, "transmission_json", car.get("transmission", {}))

            conn.execute("""
                UPDATE car_metadata SET
                    body_type=COALESCE(NULLIF(?, ''), body_type),
                    dimensions_json=?, engine_json=?, performance_json=?,
                    drivetrain=COALESCE(NULLIF(?, ''), drivetrain),
                    transmission_json=?,
                    weight_kg=COALESCE(?, weight_kg),
                    fuel_type=COALESCE(NULLIF(?, ''), fuel_type),
                    price_json=?,
                    source=?,
                    confidence=?,
                    updated_at=?
                WHERE id=?
            """, (
                car.get("body_type"), new_dims, new_eng, new_perf,
                car.get("drivetrain"), new_trans,
                car.get("weight_kg"), car.get("fuel_type"), new_price,
                car.get("source", "auto"), car.get("confidence", 0.5),
                now, eid
            ))
            return "updated"
    else:
        if not dry_run:
            conn.execute("""
                INSERT INTO car_metadata
                    (make, model, year, body_type, dimensions_json, engine_json,
                     performance_json, drivetrain, transmission_json, weight_kg,
                     fuel_type, price_json, source, confidence)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                car["make"], car["model"], car["year"],
                car.get("body_type"),
                json.dumps(car.get("dimensions", {})),
                json.dumps(car.get("engine", {})),
                json.dumps(car.get("performance", {})),
                car.get("drivetrain"),
                json.dumps(car.get("transmission", {})),
                car.get("weight_kg"),
                car.get("fuel_type"),
                json.dumps(car.get("price", {})),
                car.get("source", "auto"),
                car.get("confidence", 0.5),
            ))
        return "inserted"
    return "skipped"


def _merge_json(conn, car_id, col, new_data):
    """Merge new dict into existing JSON column."""
    row = conn.execute(f"SELECT {col} FROM car_metadata WHERE id=?", (car_id,)).fetchone()
    existing = json.loads(row[0]) if row and row[0] else {}
    merged = {**existing, **{k: v for k, v in new_data.items() if v is not None and v != {}}}
    return json.dumps(merged)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SOURCES = {
    "nhtsa": nhtsa_source,
    "fueleconomy": fe_source,
    "reference": reference_source,
}


def main():
    parser = argparse.ArgumentParser(description="Car Metadata Pipeline")
    parser.add_argument("--source", choices=list(SOURCES.keys()), help="Run specific source only")
    parser.add_argument("--search", help="Search filter (e.g. 'Toyota AE86' or 'Honda Civic')")
    parser.add_argument("--db", default=DEFAULT_DB, help="SQLite database path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--list", action="store_true", help="List current DB contents and exit")
    args = parser.parse_args()

    if args.list:
        conn = init_db(args.db)
        rows = conn.execute(
            "SELECT id, make, model, year, body_type, source, confidence FROM car_metadata ORDER BY make, model, year"
        ).fetchall()
        if not rows:
            print("No cars in database.")
        else:
            print(f"{'ID':>3} {'Make':<12} {'Model':<30} {'Year':>4} {'Body':<10} {'Src':<12} {'Conf'}")
            print("-" * 90)
            for r in rows:
                print(f"{r[0]:>3} {r[1]:<12} {r[2]:<30} {r[3]:>4} {(r[4] or '-'):<10} {r[5]:<12} {r[6]:.1f}")
        conn.close()
        return

    sources_to_run = [args.source] if args.source else list(SOURCES.keys())
    total_inserted = 0
    total_updated = 0

    conn = init_db(args.db)

    for src_name in sources_to_run:
        print(f"\n{'='*60}")
        print(f"  Source: {src_name}  (search: {args.search or 'all'})")
        print(f"{'='*60}")

        fetch_fn = SOURCES[src_name]
        cars = fetch_fn(search=args.search, dry_run=args.dry_run)

        if not cars:
            print("  No cars found.")
            continue

        print(f"  Found {len(cars)} car(s)")

        for car in cars:
            result = upsert_car(conn, car, dry_run=args.dry_run)
            status = f"[{result.upper()}]"
            name = f"{car['make']} {car['model']} ({car['year']})"
            conf = car.get("confidence", 0.5)
            if result == "inserted":
                total_inserted += 1
            elif result == "updated":
                total_updated += 1
            print(f"    {status} {name:<45} conf={conf:.1f}")

    if not args.dry_run:
        conn.commit()
        print(f"\n  Committed: {total_inserted} inserted, {total_updated} updated")

        # Summary
        count = conn.execute("SELECT COUNT(*) FROM car_metadata").fetchone()[0]
        print(f"  Total cars in DB: {count}")
    else:
        print(f"\n  [DRY RUN] Would insert {total_inserted}, update {total_updated}")

    conn.close()


if __name__ == "__main__":
    main()
