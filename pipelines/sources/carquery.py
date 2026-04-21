"""CarQuery dataset source - 78K+ trims from imamhossain94/car-make-model-trim-data.

This dataset was extracted from the CarQuery API before it shut down.
Hosted on GitHub: https://github.com/imamhossain94/car-make-model-trim-data

Data is organized as per-make JSON files under web_data/details/{make_id}.json.
Each trim has 39 fields including dimensions, engine specs, performance, fuel economy.

Usage:
    from sources.carquery import carquery_import, set_db_upsert
    from db import upsert_car
    set_db_upsert(upsert_car)
    carquery_import(conn, dry_run=False, makes=None, limit=None)

Fields available per trim:
    model_id, model_make_id, model_name, model_trim, model_year, model_body,
    model_engine_position, model_engine_cc, model_engine_cyl, model_engine_type,
    model_engine_valves_per_cyl, model_engine_power_ps, model_engine_power_rpm,
    model_engine_torque_nm, model_engine_torque_rpm, model_engine_bore_mm,
    model_engine_stroke_mm, model_engine_compression, model_engine_fuel,
    model_top_speed_kph, model_0_to_100_kph, model_drive, model_transmission_type,
    model_seats, model_doors, model_weight_kg, model_length_mm, model_width_mm,
    model_height_mm, model_wheelbase_mm, model_lkm_hwy, model_lkm_mixed,
    model_lkm_city, model_fuel_cap_l, model_sold_in_us, model_co2,
    model_make_display, make_display, make_country
"""

import json
import os
import re
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Module-level DB upsert function (set by caller to avoid circular imports)
DB_UPSERT = None


def set_db_upsert(fn):
    """Set the database upsert function. Must be called before carquery_import()."""
    global DB_UPSERT
    DB_UPSERT = fn


BASE_URL = "https://raw.githubusercontent.com/imamhossain94/car-make-model-trim-data/main/web_data"

# Body type normalization
BODY_MAP = {
    # Direct types
    "sedan": "sedan",
    "coupe": "coupe",
    "convertible": "convertible",
    "cabriolet": "convertible",
    "roadster": "roadster",
    "hatchback": "hatchback",
    "wagon": "wagon",
    "estate": "wagon",
    "station wagon": "wagon",
    "saloon": "sedan",
    "liftback": "hatchback",
    "fastback": "coupe",
    # US EPA classifications (from CarQuery model_body)
    "compact cars": "sedan",
    "midsize cars": "sedan",
    "large cars": "sedan",
    "subcompact cars": "hatchback",
    "small station wagons": "wagon",
    "midsize station wagons": "wagon",
    "two seaters": "coupe",
    # Excluded types
    "minivan": None,
    "pick-up": None,
    "pickup": None,
    "van": None,
    "suv": None,
    "crossover": None,
    "sport utility vehicles": None,
    "small sport utility vehicles": None,
    "cargo vans": None,
    "passenger vans": None,
    "panel van": None,
    "small pickup trucks": None,
    "standard pickup trucks": None,
}

# Drivetrain normalization
DRIVE_MAP = {
    "front": "fwd",
    "rear": "rwd",
    "all": "awd",
    "4wd": "awd",
    "awd": "awd",
    "front-wheel drive": "fwd",
    "rear-wheel drive": "rwd",
    "all-wheel drive": "awd",
    "four-wheel drive": "awd",
}

# Transmission normalization (ordered longest-first to avoid substring matches)
TRANS_MAP = [
    ("automated manual", "automated_manual"),
    ("dual-clutch", "dual_clutch"),
    ("shiftable automatic", "automatic"),
    ("automatic", "automatic"),
    ("manual", "manual"),
    ("cvt", "cvt"),
    ("dsg", "dual_clutch"),
]


def _download_make(make_id, timeout=30):
    """Download a single make's detail JSON from GitHub."""
    url = f"{BASE_URL}/details/{make_id}.json"
    req = urllib.request.Request(url, headers={
        "User-Agent": "CarMetadataPipeline/1.0 (carquery import)",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  [warn] Failed to download {make_id}: {e}")
        return None


def _fetch_make_list():
    """Fetch the index.json to get all make IDs."""
    url = "https://raw.githubusercontent.com/imamhossain94/car-make-model-trim-data/main/web_data/index.json"
    req = urllib.request.Request(url, headers={
        "User-Agent": "CarMetadataPipeline/1.0 (carquery import)",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            # index.json is a list of make dicts, not a dict with "makes" key
            if isinstance(data, list):
                return data
            return data.get("makes", [])
    except Exception as e:
        print(f"  [warn] Failed to fetch make list: {e}")
        return []


def _parse_body(body_str):
    """Normalize body type string. Returns None for excluded types."""
    if not body_str:
        return None
    low = body_str.strip().lower()
    # Direct map
    if low in BODY_MAP:
        return BODY_MAP[low]
    # Fuzzy: check if any key is contained
    for key, val in BODY_MAP.items():
        if key in low:
            return val
    # If we don't recognize it, skip it
    return None


def _parse_drive(drive_str):
    """Normalize drivetrain string."""
    if not drive_str:
        return None
    low = drive_str.strip().lower()
    if low in DRIVE_MAP:
        return DRIVE_MAP[low]
    for key, val in DRIVE_MAP.items():
        if key in low:
            return val
    return None


def _parse_transmission(trans_str, trim_str=""):
    """Parse transmission into structured dict."""
    if not trans_str:
        return {}
    result = {}
    low = trans_str.strip().lower()
    # Map type (check longest keys first)
    for key, val in TRANS_MAP:
        if key in low:
            result["type"] = val
            break
    if "type" not in result:
        result["type"] = "automatic" if "auto" in low else "manual"

    # Extract gear count from transmission type string (e.g. "6-speed automatic")
    gear_match = re.search(r'(\d+)-speed', low)
    if gear_match:
        result["gear_count"] = int(gear_match.group(1))
    else:
        # Fallback: try trim string patterns like "5M", "6AT", "6-speed"
        gear_match = re.search(r'(\d+)[- ]?(?:speed|spd|mt|at|amt|dct|dsg|cvt)', trim_str.lower())
        if gear_match:
            result["gear_count"] = int(gear_match.group(1))

    return result


def _parse_num(val):
    """Parse a numeric string to float, return None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _ps_to_hp(ps):
    """Convert PS (metric horsepower, aka Pferdestärke) to mechanical HP.
    1 PS = 0.98632 HP."""
    if ps is None:
        return None
    return round(ps * 0.98632, 1)


def _classify_era(year):
    """Classify a car year into a decade-era string for tagging/filtering."""
    if year is None:
        return None
    try:
        y = int(year)
    except (ValueError, TypeError):
        return None
    if y < 1970:
        return "classic"
    elif y < 1990:
        return "classic"
    elif y < 2000:
        return "90s"
    elif y < 2010:
        return "2000s"
    elif y < 2020:
        return "2010s"
    else:
        return "2020s"


def _normalize_weights(details_by_make):
    """Normalize weight values for all trims of a make.

    For each (model, year) group, cluster weight values to determine which are kg
    and which are lbs, then convert lbs to kg in-place on the detail dicts.
    """
    # Group weight values by (model, year)
    groups = defaultdict(list)
    for trim_id, detail in details_by_make.items():
        model = detail.get("model_name", "")
        year = detail.get("model_year", "")
        weight_raw = _parse_num(detail.get("model_weight_kg"))
        if weight_raw is not None and weight_raw > 0:
            groups[(model, year)].append((trim_id, detail, weight_raw))

    for (model, year), entries in groups.items():
        weights = [w for _, _, w in entries]

        if len(entries) == 1:
            # Single value — use US-market heuristic for ambiguous zone
            w = weights[0]
            if 1400 <= w <= 2200:
                sold_in_us = entries[0][1].get("model_sold_in_us") == "1"
                if sold_in_us:
                    entries[0][1]["_normalized_weight_kg"] = round(w / 2.205, 1)
                else:
                    entries[0][1]["_normalized_weight_kg"] = w
            elif w < 600:
                entries[0][1]["_normalized_weight_kg"] = None  # too light, skip
            elif w > 3000:
                entries[0][1]["_normalized_weight_kg"] = round(w / 2.205, 1)  # must be lbs
            elif w > 2200:
                entries[0][1]["_normalized_weight_kg"] = round(w / 2.205, 1)
            else:
                entries[0][1]["_normalized_weight_kg"] = w
            continue

        # Multiple values — cluster
        below = [w for w in weights if w < 1600]
        above = [w for w in weights if w >= 1600]

        if not below:
            # All are lbs
            for trim_id, detail, w in entries:
                detail["_normalized_weight_kg"] = round(w / 2.205, 1)
        elif not above:
            # All are kg
            for trim_id, detail, w in entries:
                detail["_normalized_weight_kg"] = w
        else:
            # Mixed — find biggest gap to determine split point
            sorted_weights = sorted(set(weights))
            max_gap = 0
            split_point = 1600
            for i in range(len(sorted_weights) - 1):
                gap = sorted_weights[i + 1] - sorted_weights[i]
                if gap > max_gap:
                    max_gap = gap
                    split_point = (sorted_weights[i] + sorted_weights[i + 1]) / 2

            for trim_id, detail, w in entries:
                if w >= split_point:
                    detail["_normalized_weight_kg"] = round(w / 2.205, 1)
                else:
                    detail["_normalized_weight_kg"] = w


def _trim_to_car(detail, source_confidence=0.4):
    """Convert a CarQuery detail dict to our car dict format.

    Returns None if the car should be skipped (non-passenger body type,
    missing essential fields, etc.)
    """
    make = detail.get("model_make_display") or detail.get("make_display") or detail.get("model_make_id", "")
    model = detail.get("model_name", "")
    year_str = detail.get("model_year", "")
    trim = detail.get("model_trim", "")

    if not make or not model or not year_str:
        return None

    try:
        year = int(year_str)
    except (ValueError, TypeError):
        return None

    # Filter to reasonable year range
    if year < 1940 or year > 2026:
        return None

    # Body type filter
    body_type = _parse_body(detail.get("model_body"))
    if body_type is None:
        # Unrecognized or missing — check for explicit exclusions, then infer from doors
        raw_body = (detail.get("model_body") or "").strip().lower()
        if any(w in raw_body for w in ["suv", "van", "pick-up", "pickup", "truck", "minivan", "crossover"]):
            return None  # explicitly excluded
        if raw_body:
            body_type = "sedan"  # unrecognized but present, default to sedan
        else:
            # No model_body at all — infer from doors count
            doors = _parse_num(detail.get("model_doors"))
            if doors is not None:
                doors = int(doors)
                if doors <= 2:
                    body_type = "coupe"
                elif doors == 3 or doors >= 5:
                    body_type = "hatchback"
                else:
                    body_type = "sedan"
            else:
                body_type = "sedan"

    car = {
        "make": make.strip(),
        "model": model.strip(),
        "year": year,
        "trim": trim.strip() if trim else None,
        "body_type": body_type,
        "source": "carquery",
        "confidence": source_confidence,
        "dimensions": {},
        "engine": {},
        "performance": {},
        "transmission": {},
    }

    # Dimensions (stored as meters in our DB)
    dims = {}
    for cq_field, db_key, divisor in [
        ("model_length_mm", "length", 1000),
        ("model_width_mm", "width", 1000),
        ("model_height_mm", "height", 1000),
        ("model_wheelbase_mm", "wheelbase", 1000),
    ]:
        val = _parse_num(detail.get(cq_field))
        if val and val > 0:
            dims[db_key] = round(val / divisor, 3)
    car["dimensions"] = dims

    # Engine
    engine = {}
    cc = _parse_num(detail.get("model_engine_cc"))
    if cc and cc > 0:
        engine["displacement_l"] = round(cc / 1000, 2)

    cyl = _parse_num(detail.get("model_engine_cyl"))
    if cyl and cyl > 0:
        engine["cylinders"] = int(cyl)

    # Engine type (V8, I4, etc.)
    eng_type = detail.get("model_engine_type", "")
    if eng_type:
        engine["configuration"] = eng_type.strip()

    # Power (PS → HP)
    ps = _parse_num(detail.get("model_engine_power_ps"))
    if ps and ps > 0:
        engine["power_hp"] = _ps_to_hp(ps)
        rpm = _parse_num(detail.get("model_engine_power_rpm"))
        if rpm and rpm > 0:
            engine["max_rpm"] = int(rpm)

    # Torque (carquery labels it "nm" but it's actually lb-ft)
    torque_lbft = _parse_num(detail.get("model_engine_torque_nm"))
    if torque_lbft and torque_lbft > 0:
        engine["torque_nm"] = round(torque_lbft * 1.35582, 1)
        torque_rpm = _parse_num(detail.get("model_engine_torque_rpm"))
        if torque_rpm and torque_rpm > 0:
            # torque_rpm is peak torque RPM, not idle (no idle field in CQ)
            pass

    # Bore/stroke/compression
    bore = _parse_num(detail.get("model_engine_bore_mm"))
    if bore and bore > 0:
        engine["bore_mm"] = bore
    stroke = _parse_num(detail.get("model_engine_stroke_mm"))
    if stroke and stroke > 0:
        engine["stroke_mm"] = stroke
    comp = _parse_num(detail.get("model_engine_compression"))
    if comp and comp > 0:
        engine["compression_ratio"] = comp

    # Valves per cylinder
    vpc = _parse_num(detail.get("model_engine_valves_per_cyl"))
    if vpc and vpc > 0:
        engine["valves_per_cylinder"] = int(vpc)

    # Fuel type
    fuel = detail.get("model_engine_fuel")
    if fuel and fuel.strip():
        car["fuel_type"] = fuel.strip()

    car["engine"] = engine

    # Performance
    perf = {}
    top_speed = _parse_num(detail.get("model_top_speed_kph"))
    if top_speed and top_speed > 0:
        perf["top_speed_km_h"] = top_speed

    zero_to_100 = _parse_num(detail.get("model_0_to_100_kph"))
    if zero_to_100 and zero_to_100 > 0:
        # Convert 0-100 km/h to approximate 0-60 mph (0-96.56 km/h)
        perf["0_100_km_h"] = zero_to_100
        # Rough conversion: 0-60 ≈ 0-100 * 0.95 (slightly less distance)
        perf["0_60_mph"] = round(zero_to_100 * 0.95, 2)

    car["performance"] = perf

    # Drivetrain
    drive = _parse_drive(detail.get("model_drive"))
    if drive:
        car["drivetrain"] = drive

    # Transmission
    trans = _parse_transmission(
        detail.get("model_transmission_type", ""),
        trim or ""
    )
    car["transmission"] = trans

    # Weight — use pre-normalized value from clustering, or skip
    weight_kg = detail.get("_normalized_weight_kg")
    if weight_kg is not None and weight_kg >= 600:
        car["weight_kg"] = weight_kg

    # Era
    car["eras"] = _classify_era(year)

    # Tags
    tags = []
    country = detail.get("make_country", "")
    if country:
        tags.append(f"origin:{country}")
    if detail.get("model_sold_in_us") == "1":
        tags.append("us_market")
    if cc and cc > 0:
        if cc < 1200:
            tags.append("micro")
        elif cc < 1600:
            tags.append("subcompact_engine")
        elif cc < 2000:
            tags.append("compact_engine")
        elif cc < 3000:
            tags.append("midsize_engine")
        else:
            tags.append("large_engine")
    if body_type == "roadster":
        tags.append("roadster")
    car["tags"] = tags

    return car


def carquery_import(conn, dry_run=False, makes=None, limit=None, workers=4, checkpoint_file=None):
    """Import CarQuery dataset into the database.

    Args:
        conn: SQLite connection
        dry_run: If True, don't write to DB
        makes: List of make IDs to import (None = all 155)
        limit: Max total trims to import (None = unlimited)
        workers: Parallel download workers
        checkpoint_file: Path to checkpoint JSON for resume support

    Returns:
        dict with stats: total, inserted, updated, skipped, errors
    """
    # Load checkpoint
    checkpoint = {}
    if checkpoint_file and os.path.exists(checkpoint_file):
        try:
            with open(checkpoint_file) as f:
                checkpoint = json.load(f)
            print(f"  [resume] Loaded checkpoint: {len(checkpoint)} makes already processed")
        except Exception:
            checkpoint = {}

    # Get make list
    print("CarQuery: Fetching make list...")
    make_list = _fetch_make_list()
    if not make_list:
        print("  [error] Failed to fetch make list")
        return {"total": 0, "inserted": 0, "updated": 0, "skipped": 0, "errors": 0}

    # Filter to requested makes
    if makes:
        make_ids = set(m.lower() for m in makes)
        make_list = [m for m in make_list if m.get("i", "").lower() in make_ids]
        print(f"  Filtered to {len(make_list)} makes: {makes}")

    print(f"  {len(make_list)} makes to process")

    stats = {"total": 0, "inserted": 0, "updated": 0, "skipped": 0, "errors": 0}
    lock = __import__("threading").Lock()
    counter = [0, 0, 0, 0, 0]  # total, inserted, updated, skipped, errors

    def process_make(make_info):
        """Process a single make: download and parse (no DB writes)."""
        make_id = make_info.get("i", "")
        make_name = make_info.get("n", "")

        # Skip if already checkpointed
        if make_id in checkpoint:
            return None

        data = _download_make(make_id)
        if data is None:
            return f"download_error:{make_id}"

        # Normalize weights across all trims of this make (clustering)
        _normalize_weights(data)

        parsed_cars = []
        trim_count = 0

        for trim_id, detail in data.items():
            if not isinstance(detail, dict):
                continue

            if limit and trim_count >= limit:
                break

            try:
                car = _trim_to_car(detail)
                if car is None:
                    continue
                parsed_cars.append(car)
                trim_count += 1

            except Exception as e:
                if len(parsed_cars) < 3:  # only log first few
                    print(f"  [error] {make_name} trim {trim_id}: {e}")

        return make_id, make_name, parsed_cars

    # Process makes: download in parallel (I/O bound), import sequentially (DB thread-safe)
    # Strategy: parallel download + parse, then sequential DB insert with main-thread conn
    print(f"  Downloading with {workers} workers, importing sequentially...")
    completed = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_make, m): m for m in make_list}

        for future in as_completed(futures):
            completed += 1
            make_info = futures[future]
            make_name = make_info.get("n", make_info.get("i", "?"))

            try:
                result = future.result()
                if result is None:
                    continue  # checkpointed
                if isinstance(result, str) and result.startswith("download_error"):
                    counter[4] += 1
                    print(f"  [{completed}/{len(make_list)}] {make_name}: DOWNLOAD FAILED")
                    continue

                make_id, mname, parsed_cars = result
                # Insert all parsed cars in the main thread (DB thread-safe)
                for car in parsed_cars:
                    try:
                        r = DB_UPSERT(conn, car, dry_run=dry_run, dedup_trim=False, merge_mode=True)
                        counter[0] += 1
                        counter[1] += 1 if r == "inserted" else 0
                        counter[2] += 1 if r == "updated" else 0
                        counter[3] += 1 if r == "skipped" else 0
                    except Exception as e:
                        counter[4] += 1
                        if counter[4] <= 10:
                            print(f"    [db error] {car.get('make')} {car.get('model')} {car.get('year')}: {e}")

                # Commit per make
                if not dry_run:
                    conn.commit()

                # Save checkpoint
                if checkpoint_file:
                    checkpoint[make_id] = True
                    try:
                        with open(checkpoint_file, 'w') as f:
                            json.dump(checkpoint, f)
                    except Exception:
                        pass

                if completed % 10 == 0 or len(parsed_cars) > 0:
                    print(f"  [{completed}/{len(make_list)}] {mname}: "
                          f"{len(parsed_cars)} trims downloaded")

            except Exception as e:
                counter[4] += 1
                print(f"  [{completed}/{len(make_list)}] {make_name}: EXCEPTION {e}")

    total = counter[0]
    print(f"\nCarQuery import complete:")
    print(f"  Total processed: {total}")
    print(f"  Inserted: {counter[1]}")
    print(f"  Updated/merged: {counter[2]}")
    print(f"  Skipped: {counter[3]}")
    print(f"  Errors: {counter[4]}")

    return {
        "total": counter[0],
        "inserted": counter[1],
        "updated": counter[2],
        "skipped": counter[3],
        "errors": counter[4],
    }


def carquery_make_list():
    """Fetch and return the list of available makes. For inspection."""
    makes = _fetch_make_list()
    return [(m.get("i", ""), m.get("n", ""), m.get("c", "")) for m in makes]
