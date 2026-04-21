"""Unified DB loader for car records."""

from __future__ import annotations

from typing import Any, Union

from db import upsert_car
from models import CarRecord

CarLike = Union[CarRecord, dict[str, Any]]


def _to_dict(car: CarLike) -> dict[str, Any]:
    if isinstance(car, CarRecord):
        return car.to_dict()
    return dict(car)


def load_records(conn, records: list[CarLike], strategy="upsert", dry_run=False) -> dict:
    """Load records into the database.

    Args:
        conn: SQLite connection
        records: List of CarRecord or dict objects
        strategy: "insert_only" | "upsert" | "merge"
        dry_run: preview without writing

    Returns: {"inserted": N, "updated": N, "skipped": N}
    """
    result = {"inserted": 0, "updated": 0, "skipped": 0}

    for car in records:
        car_dict = _to_dict(car)

        if dry_run:
            result["inserted"] += 1
            continue

        merge_mode = strategy == "merge"
        insert_only = strategy == "insert_only"

        if insert_only:
            cursor = conn.execute(
                "SELECT id FROM car_metadata WHERE UPPER(make)=UPPER(?) AND UPPER(model)=UPPER(?) AND year=?",
                (car_dict.get("make"), car_dict.get("model"), car_dict.get("year")),
            )
            if cursor.fetchone() is not None:
                result["skipped"] += 1
                continue

        status = upsert_car(conn, car_dict, dry_run=False, merge_mode=merge_mode)
        if status == "inserted":
            result["inserted"] += 1
        elif status == "updated":
            result["updated"] += 1
        else:
            result["skipped"] += 1

    if not dry_run:
        conn.commit()

    return result
