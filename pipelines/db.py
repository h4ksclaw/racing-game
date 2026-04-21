"""Database operations for car metadata pipeline."""

import json
import sqlite3
from datetime import datetime, timezone


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

    new_dims = _merge_json(conn, eid, "dimensions_json", car.get("dimensions", {}))
    new_eng = _merge_json(conn, eid, "engine_json", car.get("engine", {}))
    new_perf = _merge_json(conn, eid, "performance_json", car.get("performance", {}))
    new_price = _merge_json(conn, eid, "price_json", car.get("price", {}))
    new_trans = _merge_json(conn, eid, "transmission_json", car.get("transmission", {}))
    new_brakes = _merge_json(conn, eid, "brakes_json", car.get("brakes", {}))
    new_susp = _merge_json(conn, eid, "suspension_json", car.get("suspension", {}))
    new_tires = _merge_json(conn, eid, "tires_json", car.get("tires", {}))
    new_aero = _merge_json(conn, eid, "aero_json", car.get("aero", {}))

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

    If dedup_trim=True, also includes trim in the dedup key.
    If merge_mode=True, uses fuzzy model matching (LIKE) and merges
    complementary fields into ALL matching rows (e.g. FuelEconomy MPG/cylinders
    fills gaps in autospecs weight/dimension records).
    """
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
