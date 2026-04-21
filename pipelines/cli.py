"""CLI for car metadata pipeline."""

import os, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

_dir = os.path.dirname(os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)
from sources import nhtsa_source, fe_source, reference_source, autospecs_scrape
from sources.carquery import carquery_import
from db import init_db, upsert_car, deduplicate_database, normalize_all_records
from enrichment import enrich_cross_source

DEFAULT_DB = "data/game_assets.db"

SOURCES = {
    "nhtsa": nhtsa_source,
    "fueleconomy": fe_source,
    "reference": reference_source,
    "autospecs": autospecs_scrape,
    "carquery": carquery_import,
}


def _run_source(src_name, conn, args, stats_lock, stats):
    """Run a single source and update shared stats."""
    local_inserted = 0
    local_updated = 0
    fetch_fn = SOURCES[src_name]

    print(f"\n{'='*60}")
    print(f"  Source: {src_name}  (search: {args.search or 'all'})")
    print(f"{'='*60}")

    if src_name == "autospecs":
        count = fetch_fn(conn, args)
        local_inserted += count
        return local_inserted, local_updated, True  # needs commit

    if src_name == "carquery":
        count = fetch_fn(conn, dry_run=args.dry_run, makes=args.makes,
                         limit=args.limit, workers=args.workers,
                         checkpoint_file=args.checkpoint)
        local_inserted += count
        return local_inserted, local_updated, True

    cars = fetch_fn(search=args.search, dry_run=args.dry_run)

    if not cars:
        print("  No cars found.")
        return 0, 0, False

    print(f"  Found {len(cars)} car(s)")

    for car in cars:
        if args.dry_run:
            print(f"  [DRY] {car['make']} {car['model']} ({car['year']}) — {car.get('drivetrain', '?')}")
            continue
        result = upsert_car(conn, car)
        if result == "inserted":
            local_inserted += 1
        elif result == "updated":
            local_updated += 1
        if args.dry_run or result != "skipped":
            drive = car.get("drivetrain", "?")
            power = car.get("engine", {}).get("power_hp", "?")
            weight = car.get("weight_kg", "?")
            print(f"  [{result:7s}] {car['make']} {car['model']} ({car['year']}) — {drive}, {power}hp, {weight}kg")

    return local_inserted, local_updated, False


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Car Metadata Pipeline")
    parser.add_argument("--source", choices=list(SOURCES.keys()) + ['all'], default='all')
    parser.add_argument("--search", help="Search filter (e.g. 'Toyota AE86' or 'Honda Civic')")
    parser.add_argument("--db", default=DEFAULT_DB, help="SQLite database path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--list", action="store_true", help="List current DB contents and exit")
    parser.add_argument("--parallel", action="store_true", help="Run sources concurrently")
    parser.add_argument("--workers", type=int, default=4, help="Worker threads for parallel mode (default: 4)")
    parser.add_argument("--cleanup", action="store_true", help="Run deduplication and re-normalization on existing data")
    parser.add_argument("--enrich", action="store_true", help="Run cross-source enrichment on existing data")
    parser.add_argument("--makes", help="Comma-separated list of makes (for carquery)")
    parser.add_argument("--limit", type=int, help="Max cars per make (for carquery)")
    parser.add_argument("--checkpoint", help="Checkpoint file path (for carquery)")
    args = parser.parse_args()

    if args.list:
        conn = init_db(args.db)
        rows = conn.execute(
            "SELECT id, make, model, year, body_type, drivetrain, source, confidence FROM car_metadata ORDER BY make, model, year"
        ).fetchall()
        if not rows:
            print("No cars in database.")
        else:
            print(f"{'ID':>3} {'Make':<12} {'Model':<30} {'Year':>4} {'Body':<10} {'Drive':<5} {'Src':<12} {'Conf'}")
            print("-" * 95)
            for r in rows:
                print(f"{r[0]:>3} {r[1]:<12} {r[2]:<30} {r[3]:>4} {(r[4] or '-'):<10} {(r[5] or '-'):<5} {r[6]:<12} {r[7]:.1f}")
        conn.close()
        return

    conn = init_db(args.db)

    if args.cleanup:
        print("Running deduplication...")
        stats = deduplicate_database(conn, dry_run=args.dry_run)
        print(f"  Groups found: {stats['groups_found']}, Rows merged: {stats['rows_merged']}, Rows deleted: {stats['rows_deleted']}")
        print("Re-normalizing all records...")
        updated = normalize_all_records(conn, dry_run=args.dry_run)
        print(f"  Records updated: {updated}")
        conn.close()
        return

    if args.enrich:
        print("Running cross-source enrichment...")
        stats = enrich_cross_source(conn, dry_run=args.dry_run)
        print(f"  Groups checked: {stats['make_year_groups']}, Multi-source: {stats['multi_source_groups']}")
        print(f"  Matches found: {stats['matches_found']}, Fields merged: {stats['fields_merged']}, Cars updated: {stats['cars_updated']}")
        conn.close()
        return

    sources_to_run = [args.source] if args.source != 'all' else list(SOURCES.keys())
    total_inserted = 0
    total_updated = 0

    if args.parallel and len(sources_to_run) > 1:
        stats_lock = threading.Lock()
        stats = {"inserted": 0, "updated": 0}
        needs_commit = [False]

        def run_and_update(src_name):
            ins, upd, commit = _run_source(src_name, conn, args, stats_lock, stats)
            with stats_lock:
                stats["inserted"] += ins
                stats["updated"] += upd
                if commit:
                    needs_commit[0] = True
            return src_name, ins, upd

        with ThreadPoolExecutor(max_workers=min(args.workers, len(sources_to_run))) as executor:
            futures = {executor.submit(run_and_update, s): s for s in sources_to_run}
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    print(f"  [ERROR] {futures[future]}: {e}")

        conn.commit()
        total_inserted = stats["inserted"]
        total_updated = stats["updated"]
    else:
        for src_name in sources_to_run:
            ins, upd, commit = _run_source(src_name, conn, args, None, None)
            total_inserted += ins
            total_updated += upd
            conn.commit()

    conn.close()

    print(f"\n{'='*60}")
    print(f"  Done: {total_inserted} inserted, {total_updated} updated")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
