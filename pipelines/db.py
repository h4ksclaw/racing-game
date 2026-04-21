"""Database operations for car metadata pipeline."""

import json
import sqlite3
from datetime import datetime, timezone


def init_db(db_path):
    """Create car_metadata table if it doesn't exist. Adds new columns if missing."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")

    # Base table
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

    # Migrate: add any new columns to existing tables
    new_cols = [
        ("trim", "TEXT"),
        ("brakes_json", "TEXT"),
        ("suspension_json", "TEXT"),
        ("tires_json", "TEXT"),
        ("aero_json", "TEXT"),
        ("weight_front_pct", "REAL"),
        ("eras", "TEXT"),
        ("tags", "TEXT"),
    ]
    cursor = conn.cursor()
    for col_name, col_type in new_cols:
        try:
            cursor.execute(f"ALTER TABLE car_metadata ADD COLUMN {col_name} {col_type}")
        except sqlite3.OperationalError:
            pass  # column already exists

    conn.commit()
    return conn


def _merge_json(conn, car_id, col, new_data):
    """Merge new dict into existing JSON column."""
    row = conn.execute(f"SELECT {col} FROM car_metadata WHERE id=?", (car_id,)).fetchone()
    existing = json.loads(row[0]) if row and row[0] else {}
    merged = {**existing, **{k: v for k, v in new_data.items() if v is not None and v != {}}}
    return json.dumps(merged)


def upsert_car(conn, car, dry_run=False, dedup_trim=False, merge_mode=False):
    """Insert or update a car record. Deduplicates by make+model+year.
    If dedup_trim=True, also includes trim in the dedup key.
    If merge_mode=True, always merges complementary fields even if confidence is lower
    (e.g. autospecs has weight/dimensions, fueleconomy has MPG/transmission)."""
    now = datetime.now(timezone.utc).isoformat()
    tags_str = ",".join(car.get("tags", [])) if isinstance(car.get("tags"), list) else car.get("tags", "")

    if dedup_trim:
        existing = conn.execute(
            "SELECT id, source, confidence FROM car_metadata WHERE make=? AND model=? AND year=? AND COALESCE(trim,'')=?",
            (car["make"], car["model"], car["year"], car.get("trim", ""))
        ).fetchone()
    else:
        existing = conn.execute(
            "SELECT id, source, confidence FROM car_metadata WHERE make=? AND model=? AND year=?",
            (car["make"], car["model"], car["year"])
        ).fetchone()

    if existing:
        eid, old_source, old_conf = existing

        # In merge_mode, always attempt to fill gaps from complementary sources
        # Otherwise only update if new source has strictly higher confidence
        if merge_mode:
            # Check if there are any gaps to fill
            row = conn.execute(
                "SELECT body_type, drivetrain, weight_kg, weight_front_pct, fuel_type, trim, "
                "dimensions_json, engine_json, performance_json, transmission_json, "
                "tires_json, aero_json, brakes_json, suspension_json "
                "FROM car_metadata WHERE id=?", (eid,)
            ).fetchone()
            existing_body, existing_drive, existing_wt, existing_wt_f, existing_fuel, existing_trim = row[0:6]
            existing_json_cols = row[6:]

            has_scalar_gap = any(v is None for v in [existing_body, existing_drive, existing_wt, existing_wt_f, existing_fuel])
            # Check if new data would add anything to JSON fields
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

            if not has_scalar_gap and not has_json_gap:
                return "skipped"  # Nothing to merge
        elif car.get("confidence", 0.5) <= old_conf:
            return "skipped"  # Not confident enough to overwrite
            new_dims = _merge_json(conn, eid, "dimensions_json", car.get("dimensions", {}))
            new_eng = _merge_json(conn, eid, "engine_json", car.get("engine", {}))
            new_perf = _merge_json(conn, eid, "performance_json", car.get("performance", {}))
            new_price = _merge_json(conn, eid, "price_json", car.get("price", {}))
            new_trans = _merge_json(conn, eid, "transmission_json", car.get("transmission", {}))
            new_brakes = _merge_json(conn, eid, "brakes_json", car.get("brakes", {}))
            new_susp = _merge_json(conn, eid, "suspension_json", car.get("suspension", {}))
            new_tires = _merge_json(conn, eid, "tires_json", car.get("tires", {}))
            new_aero = _merge_json(conn, eid, "aero_json", car.get("aero", {}))

            # For scalars in merge_mode: fill gaps only
            set_parts = []
            params = []

            for col, new_val, existing_val in [
                ("trim", car.get("trim"), existing_trim),
                ("body_type", car.get("body_type"), existing_body),
                ("drivetrain", car.get("drivetrain"), existing_drive),
                ("weight_kg", car.get("weight_kg"), existing_wt),
                ("weight_front_pct", car.get("weight_front_pct"), existing_wt_f),
                ("fuel_type", car.get("fuel_type"), existing_fuel),
            ]:
                if merge_mode:
                    # Fill gaps only
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
                car.get("eras"), tags_str,
                car.get("source", "auto"), car.get("confidence", 0.5),
                now, eid
            ))
            return "updated"
    else:
        if not dry_run:
            conn.execute("""
                INSERT INTO car_metadata
                    (make, model, year, trim, body_type, dimensions_json, engine_json,
                     performance_json, drivetrain, transmission_json, brakes_json,
                     suspension_json, tires_json, aero_json,
                     weight_kg, weight_front_pct, fuel_type, price_json,
                     eras, tags, source, confidence)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                car["make"], car["model"], car["year"],
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
    return "skipped"
