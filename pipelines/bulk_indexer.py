#!/usr/bin/env python3
"""Bulk Car Metadata Indexer - Mass-import car specs from public APIs.

Sources:
  - fueleconomy: FuelEconomy.gov API (all makes/models, 2000-2024)
  - nhtsa: NHTSA vPIC API (body class data to merge)
  - wikidata: Wikidata SPARQL (weight, dimensions, aero enrichment)
  - all: Run all three in sequence

Usage:
  python bulk_indexer.py --source fueleconomy --year-range 2010 2024
  python bulk_indexer.py --source nhtsa --year-range 2010 2024
  python bulk_indexer.py --source wikidata
  python bulk_indexer.py --source all --year-range 2000 2024
  python bulk_indexer.py --source fueleconomy --dry-run
  python bulk_indexer.py --source fueleconomy --body-filter passenger
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

# Unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

sys.path.insert(0, os.path.dirname(__file__))
from car_metadata_pipeline import (
    init_db, upsert_car, DEFAULT_DB,
    api_get_json, api_get_xml,
)

# ---------------------------------------------------------------------------
# Constants & Mappings
# ---------------------------------------------------------------------------

PASSENGER_BODY_TYPES = {"sedan", "coupe", "hatchback", "roadster", "convertible", "wagon"}

VCLASS_MAP = {
    "Compact Cars": "sedan",
    "Midsize Cars": "sedan",
    "Large Cars": "sedan",
    "Two Seaters": "coupe",
    "Subcompact Cars": "hatchback",
    "Minicompact Cars": "hatchback",
    "Midsize-Large Station Wagons": "wagon",
    "Midsize Station Wagons": "wagon",
    "Small Station Wagons": "wagon",
}

# Anything not in VCLASS_MAP is excluded (SUVs, trucks, vans, etc.)

DRIVE_MAP = {
    "Front-Wheel Drive": "fwd",
    "Rear-Wheel Drive": "rwd",
    "All-Wheel Drive": "awd",
    "4-Wheel Drive": "awd",
    "Part-time 4-Wheel Drive": "awd",
    "Front-wheel Drive": "fwd",
    "Rear-wheel Drive": "rwd",
    "All-wheel Drive": "awd",
    "4-wheel Drive": "awd",
    "2-Wheel Drive": "fwd",
    "2-Wheel Drive, Front": "fwd",
    "2-Wheel Drive, Rear": "rwd",
}

FE_BASE = "https://fueleconomy.gov/ws/rest/vehicle"
NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

# Rate limiting: FuelEconomy.gov seems tolerant, 50ms between spec fetches
FE_SPEC_DELAY = 0.05
FE_MENU_DELAY = 0.1
FE_MAKE_WORKERS = 8  # parallel makes per year


def fe_get(path, max_retries=3, backoff=2.0):
    """Fetch FuelEconomy XML endpoint with retries."""
    url = f"{FE_BASE}{path}"
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return ET.fromstring(resp.read().decode())
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff * (2 ** attempt)
                print(f"  [retry] {url} - {e}, retrying in {wait:.1f}s")
                time.sleep(wait)
            else:
                print(f"  [warn] {e}")
                return None


def parse_transmission(trany_str):
    """Parse FuelEconomy trany field like 'Automatic (AV-S10)' or 'Manual (M6)'."""
    if not trany_str:
        return {}
    result = {}
    low = trany_str.lower()
    if low.startswith("auto"):
        result["type"] = "automatic"
    elif low.startswith("manual"):
        result["type"] = "manual"
    elif "cvt" in low or "variable" in low:
        result["type"] = "cvt"
    else:
        result["type"] = "automatic"
    m = re.search(r'(\d+)', trany_str)
    if m:
        result["gear_count"] = int(m.group(1))
    result["raw"] = trany_str
    return result


def parse_drive(raw):
    """Map FuelEconomy drive string to our drivetrain enum."""
    if not raw:
        return None
    mapped = DRIVE_MAP.get(raw)
    if mapped:
        return mapped
    low = raw.lower()
    if "front" in low:
        return "fwd"
    if "rear" in low:
        return "rwd"
    if "all" in low or "4" in low or "awd" in low:
        return "awd"
    return None


def parse_body(vclass):
    """Map VClass to body_type. Returns None for excluded types."""
    if not vclass:
        return None
    mapped = VCLASS_MAP.get(vclass)
    if mapped:
        return mapped
    # Not in map = excluded (SUV, truck, van, etc.)
    return None


def parse_fe_spec(xml_root, make, model, year):
    """Parse FuelEconomy vehicle XML into car dict. Returns None if excluded."""
    def text(tag):
        el = xml_root.find(tag)
        return el.text.strip() if el is not None and el.text else None

    def num(tag):
        v = text(tag)
        if v:
            try:
                return float(v.replace(",", ""))
            except ValueError:
                pass
        return None

    try:
        actual_year = int(text("year") or year)
    except (ValueError, TypeError):
        actual_year = year

    body_type = parse_body(text("VClass"))
    if body_type is None:
        return None

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
    eng_dscr = text("eng_dscr")
    if eng_dscr:
        engine["configuration"] = eng_dscr

    transmission = parse_transmission(text("trany") or "")

    perf = {}
    for tag, key in [("co2", "co2_grams_per_mile"), ("city08", "city_mpg"),
                     ("highway08", "highway_mpg"), ("comb08", "combined_mpg")]:
        v = num(tag)
        if v:
            perf[key] = v

    return {
        "make": text("make") or make,
        "model": text("model") or model,
        "year": actual_year,
        "trim": None,
        "body_type": body_type,
        "dimensions": {},
        "engine": engine,
        "performance": perf,
        "drivetrain": parse_drive(text("drive")),
        "transmission": transmission,
        "weight_kg": None,
        "fuel_type": text("fuelType1") or "gasoline",
        "confidence": 0.3,
        "source": "fueleconomy",
    }


# ---------------------------------------------------------------------------
# FuelEconomy bulk indexer
# ---------------------------------------------------------------------------

def _process_make_fe(year, make_name, make_val, dry_run, conn, db_lock, max_cars, counter):
    """Process all models/options for a single make within a year.
    Thread-safe: uses db_lock for writes, counter (thread-safe list) for totals.
    """
    make_count = 0
    make_skipped = 0

    models_xml = fe_get(f"/menu/model?year={year}&make={urllib.parse.quote(make_val)}")
    if models_xml is None:
        return
    models = [(i.find("text").text, i.find("value").text)
              for i in models_xml.findall(".//menuItem")
              if i.find("text").text and i.find("value").text]
    time.sleep(FE_MENU_DELAY)

    for model_name, model_val in models:
        if max_cars and counter[0] >= max_cars:
            break

        opts_xml = fe_get(
            f"/menu/options?year={year}&make={urllib.parse.quote(make_val)}"
            f"&model={urllib.parse.quote(model_val)}"
        )
        if opts_xml is None:
            continue
        options = [(i.find("text").text, i.find("value").text)
                   for i in opts_xml.findall(".//menuItem")
                   if i.find("value").text]

        for opt_text, vid in options:
            if not vid:
                continue
            if max_cars and counter[0] >= max_cars:
                break

            spec_xml = fe_get(f"/{vid}")
            if spec_xml is None:
                time.sleep(FE_SPEC_DELAY)
                continue

            car = parse_fe_spec(spec_xml, make_name, model_name, year)
            if car is None:
                make_skipped += 1
                time.sleep(FE_SPEC_DELAY)
                continue

            make_count += 1
            counter[0] += 1
            if counter[0] % 100 == 0:
                print(f"    ... {counter[0]} cars (year {year}, {make_name})")

            if not dry_run and conn:
                with db_lock:
                    upsert_car(conn, car, merge_mode=True)

            time.sleep(FE_SPEC_DELAY)

    counter[1] += make_skipped


def fueleconomy_bulk(year_start, year_end, dry_run=False, body_filter=None,
                     conn=None, max_cars=None, resume_year=None):
    """Iterate all makes/models/years from FuelEconomy.gov and upsert.
    
    If resume_year is set, skips years before that value.
    Commits after each year for checkpointing.
    Parallelizes makes within each year (FE_MAKE_WORKERS threads).
    """
    total = 0
    skipped = 0
    import concurrent.futures

    for year in range(year_start, year_end + 1):
        if resume_year and year < resume_year:
            continue
        if max_cars and total >= max_cars:
            break

        makes_xml = fe_get(f"/menu/make?year={year}")
        if makes_xml is None:
            continue

        makes = [(i.find("text").text, i.find("value").text)
                 for i in makes_xml.findall(".//menuItem")
                 if i.find("text").text and i.find("value").text]
        time.sleep(FE_MENU_DELAY)

        # Process makes in parallel within each year
        db_lock = threading.Lock()
        # counter = [total_count, skipped_count] — mutable list for thread safety
        counter = [0, 0]

        with concurrent.futures.ThreadPoolExecutor(max_workers=FE_MAKE_WORKERS) as executor:
            futures = []
            for make_name, make_val in makes:
                if max_cars and counter[0] >= max_cars:
                    break
                futures.append(executor.submit(
                    _process_make_fe, year, make_name, make_val,
                    dry_run, conn, db_lock, max_cars, counter
                ))
            concurrent.futures.wait(futures)

        total += counter[0]
        skipped += counter[1]
        print(f"  Year {year} done: {len(makes)} makes processed")

        # Checkpoint: commit after each year
        if not dry_run and conn:
            conn.commit()

    print(f"\n  FuelEconomy: {total} cars indexed, {skipped} excluded (SUVs/trucks/etc)")
    return total


# ---------------------------------------------------------------------------
# NHTSA vPIC bulk indexer
# ---------------------------------------------------------------------------

def nhtsa_bulk(year_start, year_end, dry_run=False, body_filter=None,
               conn=None, max_cars=None):
    """Fetch all makes/models from NHTSA vPIC."""
    total = 0

    makes_data = api_get_json(f"{NHTSA_BASE}/GetAllMakes?format=json")
    if not makes_data or not makes_data.get("Results"):
        print("  [warn] No makes from NHTSA")
        return 0

    makes = [(r["Make_Name"], r["Make_ID"]) for r in makes_data["Results"]
             if r.get("Make_Name")]
    print(f"  NHTSA: {len(makes)} makes to process")

    for make_name, make_id in makes:
        for year in range(year_start, year_end + 1):
            if max_cars and total >= max_cars:
                break

            data = api_get_json(
                f"{NHTSA_BASE}/GetModelsForMakeYear/make/"
                f"{urllib.parse.quote(make_name)}/modelyear/{year}?format=json"
            )
            if not data or not data.get("Results"):
                time.sleep(0.1)
                continue

            for r in data["Results"]:
                model_name = r.get("Model_Name", "")
                if not model_name:
                    continue

                total += 1
                if total % 500 == 0:
                    print(f"    ... {total} models processed")

                if not dry_run and conn:
                    upsert_car(conn, {
                        "make": make_name,
                        "model": model_name,
                        "year": year,
                        "trim": None,
                        "body_type": None,
                        "dimensions": {},
                        "engine": {},
                        "performance": {},
                        "drivetrain": None,
                        "transmission": {},
                        "weight_kg": None,
                        "fuel_type": None,
                        "confidence": 0.2,
                        "source": "nhtsa",
                    })

            time.sleep(0.1)

        if max_cars and total >= max_cars:
            break

    print(f"\n  NHTSA: {total} models indexed")
    return total


# ---------------------------------------------------------------------------
# Wikidata enricher
# ---------------------------------------------------------------------------

def wikidata_enrich(dry_run=False, conn=None, max_cars=None):
    """Query Wikidata for cars in our DB, merge specs."""
    rows = conn.execute(
        "SELECT id, make, model, year FROM car_metadata ORDER BY make, model, year"
    ).fetchall()

    if not rows:
        print("  No cars in DB to enrich.")
        return 0

    enriched = 0
    print(f"  Wikidata: {len(rows)} cars to check")

    for car_id, make, model, year in rows:
        if max_cars and enriched >= max_cars:
            break

        model_search = model.split("(")[0].strip()
        model_escaped = model_search.replace("\\", "\\\\").replace("'", "\\'")
        make_escaped = make.replace("\\", "\\\\").replace("'", "\\'")

        query = """
        SELECT ?item ?itemLabel ?weight ?wheelbase ?drag ?length ?width ?height
               ?power ?topSpeed ?engineDisp ?cylinders
        WHERE {
            { { ?item wdt:P31/wdt:P279* wd:Q4310 . }
              UNION { ?item wdt:P31/wdt:P279* wd:Q59773381 . }
              UNION { ?item wdt:P31/wdt:P279* wd:Q3231690 . } }
            ?item rdfs:label ?itemLabel .
            FILTER(CONTAINS(LCASE(STR(?itemLabel)), "%(model_lower)s"))
            FILTER(CONTAINS(LCASE(STR(?itemLabel)), "%(make_lower)s"))
            OPTIONAL { ?item wdt:P2067 ?weight . }
            OPTIONAL { ?item wdt:P2063 ?wheelbase . }
            OPTIONAL { ?item wdt:P1751 ?drag . }
            OPTIONAL { ?item wdt:P2043 ?length . }
            OPTIONAL { ?item wdt:P2047 ?width . }
            OPTIONAL { ?item wdt:P2048 ?height . }
            OPTIONAL { ?item wdt:P1297 ?power . }
            OPTIONAL { ?item wdt:P2078 ?topSpeed . }
            OPTIONAL { ?item wdt:P1089 ?engineDisp . }
            OPTIONAL { ?item wdt:P1104 ?cylinders . }
        }
        LIMIT 1
        """ % {"model_lower": model_escaped.lower(), "make_lower": make_escaped.lower()}

        encoded = urllib.parse.urlencode({"query": query, "format": "json"})
        req = urllib.request.Request(
            f"{WIKIDATA_SPARQL}?{encoded}",
            headers={"User-Agent": "CarMetadataPipeline/1.0",
                     "Accept": "application/sparql-results+json"},
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    [warn] SPARQL error for {make} {model}: {e}")
            time.sleep(1)
            continue

        bindings = data.get("results", {}).get("bindings", [])
        if not bindings:
            time.sleep(1)
            continue

        b = bindings[0]

        def get_val(key):
            v = b.get(key, {}).get("value")
            if v:
                try:
                    return float(v)
                except ValueError:
                    pass
            return None

        weight = get_val("weight")
        wheelbase = get_val("wheelbase")
        length = get_val("length")
        width = get_val("width")
        height = get_val("height")
        drag = get_val("drag")
        power = get_val("power")
        top_speed = get_val("topSpeed")
        disp = get_val("engineDisp")
        cylinders = get_val("cylinders")

        if not any([weight, wheelbase, length, width, height, drag, power, top_speed, disp, cylinders]):
            time.sleep(1)
            continue

        if not dry_run:
            # Update scalar fields
            updates = {}
            if weight:
                updates["weight_kg"] = weight

            if updates:
                set_clauses = []
                params = []
                for k, v in updates.items():
                    set_clauses.append(f"{k}=?")
                    params.append(v)
                params.append(car_id)
                conn.execute(
                    f"UPDATE car_metadata SET {', '.join(set_clauses)}, "
                    f"confidence=0.5, updated_at=datetime('now') WHERE id=?",
                    params,
                )

            # Merge JSON fields
            json_fields = {
                "dimensions_json": {},
                "aero_json": {},
                "engine_json": {},
                "performance_json": {},
            }
            if wheelbase:
                json_fields["dimensions_json"]["wheelbase"] = wheelbase
            if length:
                json_fields["dimensions_json"]["length"] = length
            if width:
                json_fields["dimensions_json"]["width"] = width
            if height:
                json_fields["dimensions_json"]["height"] = height
            if drag:
                json_fields["aero_json"]["drag_coefficient"] = drag
            if power:
                json_fields["engine_json"]["power_hp"] = power
            if top_speed:
                json_fields["performance_json"]["top_speed_km_h"] = top_speed
            if disp:
                json_fields["engine_json"]["displacement_l"] = disp
            if cylinders:
                json_fields["engine_json"]["cylinders"] = int(cylinders)

            for col, new_data in json_fields.items():
                if not new_data:
                    continue
                row = conn.execute(
                    f"SELECT {col} FROM car_metadata WHERE id=?", (car_id,)
                ).fetchone()
                existing = json.loads(row[0]) if row and row[0] else {}
                merged = {**existing, **new_data}
                conn.execute(
                    f"UPDATE car_metadata SET {col}=?, updated_at=datetime('now') WHERE id=?",
                    (json.dumps(merged), car_id),
                )

        enriched += 1
        if enriched % 10 == 0:
            print(f"    ... {enriched} cars enriched")
        time.sleep(1)

    print(f"\n  Wikidata: {enriched}/{len(rows)} cars enriched")
    return enriched


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def print_stats(conn):
    total = conn.execute("SELECT COUNT(*) FROM car_metadata").fetchone()[0]
    full = conn.execute(
        "SELECT COUNT(*) FROM car_metadata WHERE engine_json IS NOT NULL "
        "AND engine_json != '{}' AND weight_kg IS NOT NULL"
    ).fetchone()[0]
    partial = conn.execute(
        "SELECT COUNT(*) FROM car_metadata WHERE "
        "(engine_json IS NOT NULL AND engine_json != '{}') OR weight_kg IS NOT NULL"
    ).fetchone()[0]
    by_source = conn.execute(
        "SELECT source, COUNT(*) FROM car_metadata GROUP BY source ORDER BY COUNT(*) DESC"
    ).fetchall()
    by_body = conn.execute(
        "SELECT body_type, COUNT(*) FROM car_metadata GROUP BY body_type ORDER BY COUNT(*) DESC"
    ).fetchall()

    print(f"\n{'='*60}")
    print(f"  DATABASE STATS")
    print(f"{'='*60}")
    print(f"  Total cars:         {total}")
    print(f"  Full specs:         {full}")
    print(f"  Partial specs:      {partial}")
    print(f"  Minimal/no specs:   {total - partial}")
    print(f"\n  By source:")
    for src, cnt in by_source:
        print(f"    {src:<15} {cnt}")
    print(f"\n  By body type:")
    for bt, cnt in by_body:
        print(f"    {(bt or 'null'):<15} {cnt}")
    print(f"{'='*60}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Bulk Car Metadata Indexer")
    parser.add_argument("--source", required=True,
                        choices=["fueleconomy", "nhtsa", "wikidata", "all"])
    parser.add_argument("--year-range", nargs=2, type=int, default=[2000, 2024])
    parser.add_argument("--body-filter", choices=["passenger"])
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-cars", type=int, default=None,
                        help="Stop after this many cars (for testing)")
    parser.add_argument("--predict", action="store_true",
                        help="After indexing, predict missing specs and print summary")
    parser.add_argument("--resume-year", type=int, default=None,
                        help="Skip years before this (for resuming interrupted runs)")
    args = parser.parse_args()

    year_start, year_end = args.year_range

    print(f"Bulk Indexer — source: {args.source}, years: {year_start}-{year_end}, "
          f"body_filter: {args.body_filter or 'none'}, dry_run: {args.dry_run}"
          f"{', max_cars: ' + str(args.max_cars) if args.max_cars else ''}")

    conn = init_db(args.db)

    sources = [args.source] if args.source != "all" else ["fueleconomy", "nhtsa", "wikidata"]

    for src in sources:
        print(f"\n{'='*60}")
        print(f"  Running: {src}")
        print(f"{'='*60}")

        if src == "fueleconomy":
            # Parallel year processing with 8 workers
            import concurrent.futures
            db_lock = threading.Lock()
            year_results = {}

            def process_year_fe(year):
                fe_conn = init_db(args.db)
                count = fueleconomy_bulk(year, year, dry_run=args.dry_run,
                                        body_filter=args.body_filter, conn=fe_conn,
                                        max_cars=args.max_cars,
                                        resume_year=args.resume_year)
                with db_lock:
                    fe_conn.commit()
                    fe_conn.close()
                return year, count

            years_to_process = [y for y in range(year_start, year_end + 1)
                                if not args.resume_year or y >= args.resume_year]

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                futures = {executor.submit(process_year_fe, y): y for y in years_to_process}
                for future in concurrent.futures.as_completed(futures):
                    year, count = future.result()
                    year_results[year] = count

            total_fe = sum(year_results.values())
            print(f"\n  FuelEconomy parallel complete: {total_fe} cars across {len(years_to_process)} years")
        elif src == "nhtsa":
            nhtsa_bulk(year_start, year_end, dry_run=args.dry_run,
                       body_filter=args.body_filter, conn=conn,
                       max_cars=args.max_cars)
            conn.commit()
        elif src == "wikidata":
            wikidata_enrich(dry_run=args.dry_run, conn=conn,
                            max_cars=args.max_cars)
            conn.commit()

    print_stats(conn)

    if args.predict:
        from car_predictor import predict_specs
        rows = conn.execute(
            "SELECT id, make, model, year, body_type, drivetrain, dimensions_json, "
            "engine_json, aero_json, suspension_json, weight_front_pct "
            "FROM car_metadata"
        ).fetchall()
        total = len(rows)
        cd_pred = wb_pred = wd_pred = gear_pred = 0
        cd_existing = wb_existing = wd_existing = gear_existing = 0

        for row in rows:
            car = {
                "year": row[3], "body_type": row[4], "drivetrain": row[5],
                "dimensions_json": row[6], "engine_json": row[7],
                "aero_json": row[8], "suspension_json": row[9],
                "weight_front_pct": row[10],
            }
            pred = predict_specs(car)
            if "cd" in pred:
                cd_pred += 1
            else:
                cd_existing += 1
            if "wheelbase_m" in pred:
                wb_pred += 1
            else:
                wb_existing += 1
            if "weight_front_pct" in pred:
                wd_pred += 1
            else:
                wd_existing += 1
            if "gear_ratios" in pred:
                gear_pred += 1
            else:
                gear_existing += 1

        print(f"\nPredicted specs for {total} cars:")
        print(f"  - Cd: {cd_pred} predicted, {cd_existing} already had values")
        print(f"  - Wheelbase: {wb_pred} predicted, {wb_existing} already had values")
        print(f"  - Weight distribution: {wd_pred} predicted, {wd_existing} already had values")
        print(f"  - Gear ratios: {gear_pred} predicted, {gear_existing} already had values")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
