"""Pipeline orchestration — run the full ETL pipeline."""

from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from base import registry
from db import init_db
from enrichment import enrich_cross_source

# Ensure pipelines dir is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from classifier import classify_car
from loader import load_records


def run_pipeline(
    sources=None,
    db_path="data/game_assets.db",
    search: Optional[str] = None,
    dry_run=False,
    strategy="upsert",
    enrich=False,
    classify=False,
    cleanup=False,
    parallel=False,
    workers=4,
    **kwargs,
) -> dict[str, Any]:
    """Run the full ETL pipeline.

    Steps:
    1. Init DB
    2. If cleanup: deduplicate + normalize
    3. Fetch from sources (parallel or sequential)
    4. If classify: run classifier on all records before loading
    5. Load records via loader
    6. If enrich: run cross-source enrichment

    Returns: {"inserted": N, "updated": N, "skipped": N, "sources_run": [...], "enriched": {...}}
    """
    # Resolve db_path relative to pipelines dir
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), db_path)

    # Step 1: Init DB
    print(f"[pipeline] Initializing database: {db_path}")
    conn = init_db(db_path)

    # Step 2: Cleanup
    if cleanup:
        print("[pipeline] Running cleanup (deduplicate)...")
        from db import deduplicate_database
        deduplicate_database(conn, dry_run=dry_run)

    # Step 3: Discover sources
    registry.discover("sources")
    available = {s.name: s for s in registry.list_sources()}
    source_names = sources or list(available.keys())
    sources_run = []

    # Step 3: Fetch from sources
    all_records = []

    def fetch_one(name):
        if name not in available:
            print(f"[pipeline] Warning: unknown source '{name}', skipping")
            return name, []
        source = available[name]
        print(f"[pipeline] Fetching from {name}...")
        fetch_kwargs = {"search": search, "dry_run": dry_run}
        if name in ("autospecs", "carquery"):
            fetch_kwargs["conn"] = conn
        fetch_kwargs.update(kwargs)
        records = source.fetch(**fetch_kwargs)
        print(f"[pipeline] {name}: {len(records)} records")
        return name, records

    if parallel and len(source_names) > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(fetch_one, name): name for name in source_names}
            for future in as_completed(futures):
                name, records = future.result()
                sources_run.append(name)
                all_records.extend(records)
    else:
        for name in source_names:
            name, records = fetch_one(name)
            sources_run.append(name)
            all_records.extend(records)

    print(f"[pipeline] Total records fetched: {len(all_records)}")

    # Step 4: Classify
    if classify:
        print("[pipeline] Classifying records...")
        for car in all_records:
            from models import CarRecord
            if isinstance(car, CarRecord):
                result = classify_car(car)
                if result.get("era"):
                    car.eras = result["era"]
                if result.get("body_type"):
                    car.body_type = result["body_type"]
                if result.get("performance_tier") and result["performance_tier"] != "unknown":
                    tags = car.tags or []
                    tier = result["performance_tier"]
                    if tier not in tags:
                        car.tags = tags + [tier]
            else:
                result = classify_car(car)
                if result.get("era"):
                    car["eras"] = result["era"]
                if result.get("body_type"):
                    car["body_type"] = result["body_type"]
                if result.get("performance_tier") and result["performance_tier"] != "unknown":
                    tags = car.get("tags") or []
                    tier = result["performance_tier"]
                    if tier not in tags:
                        car["tags"] = tags + [tier]

    # Step 5: Load records
    print(f"[pipeline] Loading {len(all_records)} records (strategy={strategy})...")
    load_result = load_records(conn, all_records, strategy=strategy, dry_run=dry_run)
    print(f"[pipeline] Loaded: {load_result}")

    # Step 6: Enrich
    enriched = {}
    if enrich:
        print("[pipeline] Running cross-source enrichment...")
        enriched = enrich_cross_source(conn, dry_run=dry_run)
        print(f"[pipeline] Enrichment: {enriched}")

    conn.close()

    return {
        "inserted": load_result["inserted"],
        "updated": load_result["updated"],
        "skipped": load_result["skipped"],
        "sources_run": sources_run,
        "enriched": enriched,
    }
