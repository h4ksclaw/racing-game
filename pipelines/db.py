"""Database operations for car metadata pipeline."""

import json
import re
import sqlite3
from datetime import datetime, timezone


def _parse_tire_string(tire_str):
    """Parse tire size string like '215/40 R18' or 'P235/65/R17' into components."""
    cleaned = re.sub(r'\s+\d{2,3}[A-Z]?\s*$', '', tire_str.strip())
    m = re.match(r'P?(\d{2,3})[/\s](\d{2,3})[/\s]*R(\d{2}(?:\.\d)?)', cleaned)
    if m:
        return {
            "width_mm": int(m.group(1)),
            "aspect_ratio": int(m.group(2)),
            "wheel_diameter_in": int(m.group(3).split('.')[0]),
        }
    return None


def normalize_record(car):
    """Normalize car record field names and values at ingestion time.

    Ensures consistency between Python pipeline and TypeScript game engine expectations.
    Call this in upsert_car() BEFORE any DB operation.

    Normalizes: dimensions (strip None), tires (split dual-size strings, parse components),
    drivetrain (lowercase), body_type (lowercase).
    Does NOT normalize: engine, performance, transmission, brakes, suspension, aero, price
    (those are stored as-is from the source).
    """
    # Normalize dimensions: strip None values
    dims = car.get("dimensions", {})
    if dims:
        normalized_dims = {k: v for k, v in dims.items() if v is not None}
        car["dimensions"] = normalized_dims

    # Parse tire sizes: autospecs stores "215/40 R18 // 245/40 R18" in front_size
    tires = car.get("tires", {})
    if tires:
        front = tires.get("front_size", "")
        if front and "//" in front:
            parts = [p.strip() for p in front.split("//")]
            if len(parts) == 2:
                tires["front_size"] = parts[0]
                tires["rear_size"] = parts[1]
            elif len(parts) > 2:
                tires["front_size"] = parts[0]
                tires["rear_size"] = parts[-1]

        for size_key in ["front_size", "rear_size"]:
            size_str = tires.get(size_key, "")
            if size_str:
                parsed = _parse_tire_string(size_str)
                if parsed:
                    prefix = "front" if "front" in size_key else "rear"
                    tires[f"{prefix}_width_mm"] = parsed["width_mm"]
                    tires[f"{prefix}_aspect_ratio"] = parsed["aspect_ratio"]
                    tires[f"{prefix}_wheel_diameter_in"] = parsed["wheel_diameter_in"]

        car["tires"] = tires

    if car.get("drivetrain"):
        car["drivetrain"] = car["drivetrain"].lower().strip()

    if car.get("body_type"):
        car["body_type"] = car["body_type"].lower().strip()

    return car


def deduplicate_database(conn, dry_run=False):
    """Remove duplicate car entries, keeping the most complete row per (make, model, year).

    For each group of duplicates:
    1. Find the row with the most non-null fields (the "best" row)
    2. Merge any unique fields from other rows into the best row
    3. Delete the redundant rows

    Returns dict with stats.
    """
    groups = conn.execute(
        "SELECT make, model, year, source, COUNT(*) as cnt FROM car_metadata "
        "GROUP BY UPPER(make), UPPER(model), year, source HAVING cnt > 1"
    ).fetchall()

    stats = {"groups_found": len(groups), "rows_deleted": 0, "rows_merged": 0}

    json_cols = ["dimensions_json", "engine_json", "performance_json", "transmission_json",
                 "brakes_json", "suspension_json", "tires_json", "aero_json", "price_json"]
    scalar_cols = ["body_type", "drivetrain", "weight_kg", "weight_front_pct", "fuel_type", "trim"]
    all_cols = json_cols + scalar_cols

    for make, model, year, source, count in groups:
        rows = conn.execute(
            "SELECT id, " + ", ".join(all_cols) + " FROM car_metadata "
            "WHERE UPPER(make)=UPPER(?) AND UPPER(model)=UPPER(?) AND year=? AND source=?",
            (make, model, year, source)
        ).fetchall()

        # Score each row
        def score_row(r):
            s = 0
            for i, col in enumerate(all_cols):
                val = r[i + 1]  # offset by id
                if val is not None:
                    if col in json_cols:
                        try:
                            d = json.loads(val) if isinstance(val, str) else val
                            if d:
                                s += len(d)
                        except Exception:
                            pass
                    else:
                        s += 1
            return s

        scored = sorted(rows, key=score_row, reverse=True)
        keep = scored[0]
        keep_id = keep[0]
        duplicates = scored[1:]

        # Merge JSON fields from duplicates into kept row
        merged = False
        for col in json_cols:
            col_idx = all_cols.index(col) + 1
            keep_val = json.loads(keep[col_idx]) if keep[col_idx] else {}
            for dup in duplicates:
                dup_val = json.loads(dup[col_idx]) if dup[col_idx] else {}
                for k, v in dup_val.items():
                    if k not in keep_val and v is not None:
                        keep_val[k] = v
                        merged = True
            if merged and not dry_run:
                conn.execute(f"UPDATE car_metadata SET {col}=? WHERE id=?",
                             (json.dumps(keep_val), keep_id))

        # Merge scalar fields
        for col in scalar_cols:
            col_idx = all_cols.index(col) + 1
            if keep[col_idx] is None:
                for dup in duplicates:
                    if dup[col_idx] is not None:
                        if not dry_run:
                            conn.execute(f"UPDATE car_metadata SET {col}=? WHERE id=?",
                                         (dup[col_idx], keep_id))
                        merged = True
                        break

        if merged:
            stats["rows_merged"] += 1

        # Delete duplicates
        if not dry_run:
            dup_ids = [d[0] for d in duplicates]
            placeholders = ",".join("?" * len(dup_ids))
            conn.execute(f"DELETE FROM car_metadata WHERE id IN ({placeholders})", dup_ids)
            stats["rows_deleted"] += len(dup_ids)
        else:
            stats["rows_deleted"] += len(duplicates)

    if not dry_run:
        conn.commit()

    return stats


def normalize_all_records(conn, dry_run=False):
    """Re-normalize all existing records in the database (e.g., after adding new normalization rules)."""
    rows = conn.execute(
        "SELECT id, dimensions_json, tires_json, drivetrain, body_type FROM car_metadata"
    ).fetchall()
    updated = 0
    for row in rows:
        car_id = row[0]
        car = {
            "dimensions": json.loads(row[1]) if row[1] else {},
            "tires": json.loads(row[2]) if row[2] else {},
            "drivetrain": row[3],
            "body_type": row[4],
        }

        normalized = normalize_record(car)

        changes = []
        if normalized["dimensions"] != json.loads(row[1] or "{}"):
            changes.append("dimensions")
        if normalized["tires"] != json.loads(row[2] or "{}"):
            changes.append("tires")
        if (normalized.get("drivetrain") or "").lower() != (row[3] or "").lower():
            changes.append("drivetrain")
        if (normalized.get("body_type") or "").lower() != (row[4] or "").lower():
            changes.append("body_type")

        if changes and not dry_run:
            conn.execute(
                "UPDATE car_metadata SET dimensions_json=?, tires_json=?, drivetrain=?, body_type=?, updated_at=datetime('now') WHERE id=?",
                (json.dumps(normalized["dimensions"]), json.dumps(normalized["tires"]),
                 normalized.get("drivetrain"), normalized.get("body_type"), car_id))
            updated += 1
        elif changes:
            updated += 1

    if not dry_run:
        conn.commit()
    return updated


def init_db(db_path):
    """Create car_metadata table if it doesn't exist. Adds new columns if missing."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS car_metadata (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            make            TEXT,
            model           TEXT,
            year            INTEGER,
            trim            TEXT,
            body_type       TEXT,
            dimensions_json TEXT,
            engine_json     TEXT,
            performance_json TEXT,
            drivetrain      TEXT,
            transmission_json TEXT,
            brakes_json     TEXT,
            suspension_json TEXT,
            tires_json      TEXT,
            aero_json       TEXT,
            weight_kg       REAL,
            weight_front_pct REAL,
            fuel_type       TEXT,
            price_json      TEXT,
            eras            TEXT,
            tags            TEXT,
            source          TEXT NOT NULL DEFAULT 'auto',
            confidence      REAL DEFAULT 0.5,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    new_cols = [
        ("trim", "TEXT"), ("brakes_json", "TEXT"), ("suspension_json", "TEXT"),
        ("tires_json", "TEXT"), ("aero_json", "TEXT"), ("weight_front_pct", "REAL"),
        ("eras", "TEXT"), ("tags", "TEXT"),
    ]
    for col_name, col_type in new_cols:
        try:
            conn.execute(f"ALTER TABLE car_metadata ADD COLUMN {col_name} {col_type}")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    return conn


def _merge_json(conn, car_id, col, new_data):
    """Merge new dict into existing JSON column, returning merged JSON string."""
    row = conn.execute(f"SELECT {col} FROM car_metadata WHERE id=?", (car_id,)).fetchone()
    existing = json.loads(row[0]) if row and row[0] else {}
    merged = {**existing, **{k: v for k, v in new_data.items() if v is not None and v != {}}}
    return json.dumps(merged)


def _has_gaps(conn, eid, car):
    """Check if a car row has any gaps that `car` could fill."""
    row = conn.execute(
        "SELECT body_type, drivetrain, weight_kg, weight_front_pct, fuel_type, trim, "
        "dimensions_json, engine_json, performance_json, transmission_json, "
        "tires_json, aero_json, brakes_json, suspension_json "
        "FROM car_metadata WHERE id=?", (eid,)
    ).fetchone()
    if not row:
        return True

    scalars = row[0:6]
    existing_json_cols = row[6:]

    has_scalar_gap = any(v is None for v in scalars)

    has_json_gap = False
    new_json_fields = [car.get("dimensions", {}), car.get("engine", {}), car.get("performance", {}),
                       car.get("transmission", {}), car.get("tires", {}), car.get("aero", {}),
                       car.get("brakes", {}), car.get("suspension", {})]
    for existing_json, new_data in zip(existing_json_cols, new_json_fields):
        if new_data:
            existing_dict = json.loads(existing_json) if existing_json else {}
            new_nonempty = {k: v for k, v in new_data.items() if v is not None and v != {}}
            if new_nonempty and not all(k in existing_dict for k in new_nonempty):
                has_json_gap = True
                break

    return has_scalar_gap or has_json_gap


def _merge_into_row(conn, eid, car, merge_mode):
    """Merge car data into an existing row. Fills gaps in merge_mode, overwrites otherwise."""
    now = datetime.now(timezone.utc).isoformat()

    # --- JSON merge: merge new data into existing JSON columns ---
    new_dims = _merge_json(conn, eid, "dimensions_json", car.get("dimensions", {}))
    new_eng = _merge_json(conn, eid, "engine_json", car.get("engine", {}))
    new_perf = _merge_json(conn, eid, "performance_json", car.get("performance", {}))
    new_price = _merge_json(conn, eid, "price_json", car.get("price", {}))
    new_trans = _merge_json(conn, eid, "transmission_json", car.get("transmission", {}))
    new_brakes = _merge_json(conn, eid, "brakes_json", car.get("brakes", {}))
    new_susp = _merge_json(conn, eid, "suspension_json", car.get("suspension", {}))
    new_tires = _merge_json(conn, eid, "tires_json", car.get("tires", {}))
    new_aero = _merge_json(conn, eid, "aero_json", car.get("aero", {}))

    # --- Scalar merge: fill gaps (merge_mode) or overwrite (replace mode) ---
    set_parts = []
    params = []

    if merge_mode:
        # Load existing scalars for gap-checking
        row = conn.execute(
            "SELECT body_type, drivetrain, weight_kg, weight_front_pct, fuel_type, trim "
            "FROM car_metadata WHERE id=?", (eid,)
        ).fetchone()
        scalar_fields = [
            ("trim", car.get("trim"), row[5]),
            ("body_type", car.get("body_type"), row[0]),
            ("drivetrain", car.get("drivetrain"), row[1]),
            ("weight_kg", car.get("weight_kg"), row[2]),
            ("weight_front_pct", car.get("weight_front_pct"), row[3]),
            ("fuel_type", car.get("fuel_type"), row[4]),
        ]
    else:
        scalar_fields = [
            ("trim", car.get("trim"), None), ("body_type", car.get("body_type"), None),
            ("drivetrain", car.get("drivetrain"), None), ("weight_kg", car.get("weight_kg"), None),
            ("weight_front_pct", car.get("weight_front_pct"), None), ("fuel_type", car.get("fuel_type"), None),
        ]

    for col, new_val, existing_val in scalar_fields:
        if merge_mode:
            if new_val is not None and existing_val is None:
                set_parts.append(f"{col}=?")
                params.append(new_val)
        else:
            if new_val is not None:
                set_parts.append(f"{col}=?")
                params.append(new_val)

    set_clause = (", ".join(set_parts) + ", ") if set_parts else ""

    conn.execute(f"""
        UPDATE car_metadata SET
            {set_clause}
            dimensions_json=?, engine_json=?, performance_json=?,
            transmission_json=?, brakes_json=?, suspension_json=?,
            tires_json=?, aero_json=?,
            price_json=?,
            eras=COALESCE(NULLIF(?, ''), eras),
            tags=COALESCE(NULLIF(?, ''), tags),
            source=?,
            confidence=?,
            updated_at=?
        WHERE id=?
    """.rstrip(), (
        *params,
        new_dims, new_eng, new_perf,
        new_trans, new_brakes, new_susp,
        new_tires, new_aero,
        new_price,
        car.get("eras"), "",
        car.get("source", "auto"), car.get("confidence", 0.5),
        now, eid
    ))


def upsert_car(conn, car, dry_run=False, dedup_trim=False, merge_mode=False):
    """Insert or update a car record. Deduplicates by make+model+year.

    Accepts both CarRecord objects and plain dicts.
    """
    from models import CarRecord
    if isinstance(car, CarRecord):
        car = car.to_dict()

    car = normalize_record(car)

    tags_str = ",".join(car.get("tags", [])) if isinstance(car.get("tags"), list) else car.get("tags", "")

    if dedup_trim:
        existing = conn.execute(
            "SELECT id, source, confidence FROM car_metadata "
            "WHERE UPPER(make)=UPPER(?) AND UPPER(model)=UPPER(?) AND year=? AND COALESCE(UPPER(trim),'')=UPPER(?)",
            (car["make"], car["model"], car["year"], car.get("trim", ""))
        ).fetchone()
    elif merge_mode:
        model_upper = car["model"].upper()
        existing_rows = conn.execute(
            "SELECT id, source, confidence FROM car_metadata "
            "WHERE UPPER(make)=UPPER(?) AND year=? "
            "AND (UPPER(model)=? OR UPPER(model) LIKE ? OR UPPER(model) LIKE ?)",
            (car["make"], car["year"], model_upper, f"%{model_upper}%", f"{model_upper}%")
        ).fetchall()
        existing = existing_rows[0] if existing_rows else None
    else:
        existing = conn.execute(
            "SELECT id, source, confidence FROM car_metadata "
            "WHERE UPPER(make)=UPPER(?) AND UPPER(model)=UPPER(?) AND year=?",
            (car["make"], car["model"], car["year"])
        ).fetchone()

    if existing:
        eid, old_source, old_conf = existing

        if merge_mode:
            if not _has_gaps(conn, eid, car):
                return "skipped"  # Nothing to merge for first row
        elif car.get("confidence", 0.5) <= old_conf:
            return "skipped"

        _merge_into_row(conn, eid, car, merge_mode)

        # In merge_mode, also merge into ALL other matching rows
        if merge_mode and existing_rows and len(existing_rows) > 1:
            for eid2, _, _ in existing_rows[1:]:
                if _has_gaps(conn, eid2, car):
                    _merge_into_row(conn, eid2, car, merge_mode)

        return "updated"

    else:
        if not dry_run:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("""
                INSERT INTO car_metadata
                    (make, model, year, trim, body_type, dimensions_json, engine_json,
                     performance_json, drivetrain, transmission_json, brakes_json,
                     suspension_json, tires_json, aero_json,
                     weight_kg, weight_front_pct, fuel_type, price_json,
                     eras, tags, source, confidence)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                car["make"].strip(), car["model"].strip(), car["year"],
                car.get("trim"), car.get("body_type"),
                json.dumps(car.get("dimensions", {})),
                json.dumps(car.get("engine", {})),
                json.dumps(car.get("performance", {})),
                car.get("drivetrain"),
                json.dumps(car.get("transmission", {})),
                json.dumps(car.get("brakes", {})),
                json.dumps(car.get("suspension", {})),
                json.dumps(car.get("tires", {})),
                json.dumps(car.get("aero", {})),
                car.get("weight_kg"), car.get("weight_front_pct"),
                car.get("fuel_type"),
                json.dumps(car.get("price", {})),
                car.get("eras"), tags_str,
                car.get("source", "auto"),
                car.get("confidence", 0.5),
            ))
        return "inserted"
