"""CLI for car metadata pipeline."""

import os, sys
_dir = os.path.dirname(os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)
from sources import nhtsa_source, fe_source, reference_source, autospecs_scrape
from db import init_db, upsert_car

DEFAULT_DB = "data/game_assets.db"

SOURCES = {
    "nhtsa": nhtsa_source,
    "fueleconomy": fe_source,
    "reference": reference_source,
    "autospecs": autospecs_scrape,
}


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Car Metadata Pipeline")
    parser.add_argument("--source", choices=['nhtsa','fueleconomy','reference','autospecs','all'], default='all')
    parser.add_argument("--search", help="Search filter (e.g. 'Toyota AE86' or 'Honda Civic')")
    parser.add_argument("--db", default=DEFAULT_DB, help="SQLite database path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--list", action="store_true", help="List current DB contents and exit")
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

    sources_to_run = [args.source] if args.source != 'all' else list(SOURCES.keys())
    total_inserted = 0
    total_updated = 0

    conn = init_db(args.db)

    for src_name in sources_to_run:
        print(f"\n{'='*60}")
        print(f"  Source: {src_name}  (search: {args.search or 'all'})")
        print(f"{'='*60}")

        fetch_fn = SOURCES[src_name]

        # autospecs handles its own DB writes and commits per-brand
        if src_name == "autospecs":
            count = fetch_fn(conn, args)
            total_inserted += count
            conn.commit()
            continue

        cars = fetch_fn(search=args.search, dry_run=args.dry_run)

        if not cars:
            print("  No cars found.")
            continue

        print(f"  Found {len(cars)} car(s)")

        for car in cars:
            if args.dry_run:
                print(f"  [DRY] {car['make']} {car['model']} ({car['year']}) — {car.get('drivetrain', '?')}")
                continue
            result = upsert_car(conn, car)
            if result == "inserted":
                total_inserted += 1
            elif result == "updated":
                total_updated += 1
            if args.dry_run or result != "skipped":
                drive = car.get("drivetrain", "?")
                power = car.get("engine", {}).get("power_hp", "?")
                weight = car.get("weight_kg", "?")
                print(f"  [{result:7s}] {car['make']} {car['model']} ({car['year']}) — {drive}, {power}hp, {weight}kg")

        conn.commit()

    conn.close()

    print(f"\n{'='*60}")
    print(f"  Done: {total_inserted} inserted, {total_updated} updated")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
