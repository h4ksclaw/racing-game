"""Cross-source enrichment engine.

Merges complementary data from different sources for the same car.
Uses fuzzy model name matching to find cross-source matches.

Strategy:
- Group cars by (make, year) 
- Within each group, match models using normalized names
- Merge fields from lower-confidence sources into higher-confidence base records
- Priority: reference > autospecs > carquery > fueleconomy > nhtsa

    Usage:
        from enrichment import enrich_cross_source
        from db import init_db
        conn = init_db("data/game_assets.db")
        stats = enrich_cross_source(conn, dry_run=False)
        print(f"Merged {stats['fields_merged']} fields across {stats['cars_updated']} cars")
        conn.close()
"""

import json
import re
import sqlite3
from collections import defaultdict

# Source priority (higher = preferred as base)
SOURCE_PRIORITY = {
    "reference": 90,
    "autospecs": 70,
    "carquery": 50,
    "fueleconomy": 30,
    "nhtsa": 20,
}

# JSON columns that can be enriched
ENRICHABLE_JSON = [
    "dimensions_json", "engine_json", "performance_json",
    "transmission_json", "brakes_json", "suspension_json",
    "tires_json", "aero_json", "price_json",
]

# Scalar columns that can be enriched
ENRICHABLE_SCALAR = [
    "body_type", "drivetrain", "weight_kg", "weight_front_pct",
    "fuel_type", "trim",
]

# Which source is trusted for which fields
# Fields marked "trim_invariant" are safe to merge across different trims of the same model
# (field_path -> preferred sources in priority order)
FIELD_TRUST = {
    # Trim-invariant fields (safe to merge across trims — dimensions, tires, body)
    "dimensions.length": ["carquery", "autospecs"],
    "dimensions.width": ["carquery", "autospecs"],
    "dimensions.height": ["carquery", "autospecs"],
    "dimensions.wheelbase": ["carquery", "autospecs"],
    "dimensions.ground_clearance": ["autospecs"],
    "tires.front_size": ["autospecs", "reference"],
    "tires.rear_size": ["autospecs", "reference"],
    "tires.front_width_mm": ["autospecs", "reference"],
    "tires.front_aspect_ratio": ["autospecs", "reference"],
    "tires.front_wheel_diameter_in": ["autospecs", "reference"],
    "tires.rear_width_mm": ["autospecs", "reference"],
    "tires.rear_aspect_ratio": ["autospecs", "reference"],
    "tires.rear_wheel_diameter_in": ["autospecs", "reference"],
    "transmission.type": ["carquery", "autospecs"],
    # Trim-variant fields (only merge when models match closely — same trim)
    "engine.power_hp": ["reference", "autospecs", "carquery", "fueleconomy"],
    "engine.torque_nm": ["reference", "carquery", "autospecs"],
    "engine.displacement_l": ["carquery", "reference", "autospecs"],
    "engine.cylinders": ["carquery", "reference"],
    "engine.max_rpm": ["carquery", "reference"],
    "performance.top_speed_km_h": ["autospecs", "reference", "carquery"],
    "performance.0_100_km_h": ["autospecs", "reference", "carquery"],
    "transmission.gear_count": ["autospecs", "carquery"],
    "weight_kg": ["autospecs", "carquery", "reference"],
    "body_type": ["autospecs", "carquery", "reference"],
}

# Minimum match score required for trim-variant fields (HP, torque, top speed)
TRIM_VARIANT_MIN_SCORE = 0.85

# Fields that are trim-invariant (safe to merge with lower match score >= 0.5)
TRIM_INVARIANT_FIELDS = {
    "dimensions.length", "dimensions.width", "dimensions.height",
    "dimensions.wheelbase", "dimensions.ground_clearance",
    "tires.front_size", "tires.rear_size",
    "tires.front_width_mm", "tires.front_aspect_ratio", "tires.front_wheel_diameter_in",
    "tires.rear_width_mm", "tires.rear_aspect_ratio", "tires.rear_wheel_diameter_in",
    "transmission.type",
}


def _normalize_model(name):
    """Normalize model name for fuzzy matching.
    
    Removes common noise, lowercases, strips extra spaces.
    """
    if not name:
        return ""
    s = name.lower().strip()
    # Remove trim-level noise
    s = re.sub(r'\b\d+\s*door\b', '', s)
    s = re.sub(r'\b\d+dr\b', '', s)
    s = re.sub(r'\b(dci|tdi|tfsi|vtec|vvt|i-vtec|mivec|skyactiv|ecoboost|vti)\b', '', s)
    # Remove engine displacement codes (e.g. 1.8L, 2.0T, 3.5L)
    s = re.sub(r'\b\d+\.\d\s*[lLtT]\b', '', s)
    s = re.sub(r'\b\d+cc\b', '', s)
    # Remove parenthetical HP numbers
    s = re.sub(r'\(\d+\s*hp\)', '', s, flags=re.IGNORECASE)
    # Remove transmission codes
    s = re.sub(r'\b\d+\s*(mt|at|cvt|dct|dsg|amt)\b', '', s, flags=re.IGNORECASE)
    # Remove drive codes
    s = re.sub(r'\b(fwd|rwd|awd|4wd|4wd|ff|fr|mr|rr)\b', '', s, flags=re.IGNORECASE)
    # Normalize whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _model_match_score(a, b):
    """Score how well two model names match. 0 = no match, 1.0 = exact.
    
    Uses normalized names and checks for substring containment.
    """
    na = _normalize_model(a)
    nb = _normalize_model(b)
    if not na or not nb:
        return 0.0
    
    # Exact match
    if na == nb:
        return 1.0
    
    # One contains the other (e.g., "corolla" in "corolla sedan")
    if na in nb or nb in na:
        # Good containment match — the shorter name is a clear substring
        # Penalize slightly if one is much longer (might be different variant)
        ratio = min(len(na), len(nb)) / max(len(na), len(nb))
        return max(ratio, 0.6)  # at least 0.6 for containment
    
    # Word overlap
    words_a = set(na.split())
    words_b = set(nb.split())
    if not words_a or not words_b:
        return 0.0
    
    overlap = words_a & words_b
    if not overlap:
        return 0.0
    
    # Score based on how many words overlap relative to the smaller set
    union = words_a | words_b
    jaccard = len(overlap) / len(union)
    word_coverage = len(overlap) / min(len(words_a), len(words_b))
    
    return jaccard * word_coverage


def _get_json_field(data, path):
    """Get a nested field from JSON data using dot notation."""
    parts = path.split(".")
    val = data
    for p in parts:
        if isinstance(val, dict):
            val = val.get(p)
        else:
            return None
    return val


def _set_json_field(data, path, value):
    """Set a nested field in JSON data using dot notation."""
    parts = path.split(".")
    obj = data
    for p in parts[:-1]:
        if p not in obj or not isinstance(obj[p], dict):
            obj[p] = {}
        obj = obj[p]
    obj[parts[-1]] = value


def enrich_cross_source(conn, dry_run=False, min_match_score=0.4):
    """Enrich car records by merging data from different sources.
    
    For each (make, year) group, finds matching models across sources
    and fills gaps in the higher-priority record with data from other sources.
    
    Args:
        conn: SQLite connection
        dry_run: If True, don't write to DB
        min_match_score: Minimum model match score (0-1) to consider a cross-source match
    
    Returns:
        dict with stats
    """
    # Load all cars
    rows = conn.execute("""
        SELECT id, make, model, year, source, confidence,
               dimensions_json, engine_json, performance_json,
               transmission_json, brakes_json, suspension_json,
               tires_json, aero_json, price_json,
               body_type, drivetrain, weight_kg, weight_front_pct, fuel_type, trim
        FROM car_metadata
    """).fetchall()
    
    # Group by (UPPER(make), year)
    groups = defaultdict(list)
    for row in rows:
        key = (row[1].upper(), row[3])  # (make, year)
        groups[key].append(row)
    
    stats = {
        "make_year_groups": len(groups),
        "multi_source_groups": 0,
        "matches_found": 0,
        "fields_merged": 0,
        "cars_updated": 0,
    }
    
    json_cols = ["dimensions_json", "engine_json", "performance_json",
                 "transmission_json", "brakes_json", "suspension_json",
                 "tires_json", "aero_json", "price_json"]
    scalar_cols_idx = {
        "body_type": 15, "drivetrain": 16, "weight_kg": 17,
        "weight_front_pct": 18, "fuel_type": 19, "trim": 20,
    }
    
    updates = []  # (car_id, column, value) tuples
    
    for (make, year), group_rows in groups.items():
        sources_in_group = set(r[4] for r in group_rows)
        if len(sources_in_group) < 2:
            continue  # no cross-source opportunity
        
        stats["multi_source_groups"] += 1
        
        # For each pair of cars from different sources, check model match
        # Then merge complementary data
        for i, row_a in enumerate(group_rows):
            for j, row_b in enumerate(group_rows):
                if i >= j:
                    continue
                if row_a[4] == row_b[4]:  # same source
                    continue
                
                score = _model_match_score(row_a[2], row_b[2])
                if score < min_match_score:
                    continue
                
                stats["matches_found"] += 1
                
                # Determine which is the base (higher priority source)
                pri_a = SOURCE_PRIORITY.get(row_a[4], 0)
                pri_b = SOURCE_PRIORITY.get(row_b[4], 0)
                
                if pri_a >= pri_b:
                    base, donor = row_a, row_b
                else:
                    base, donor = row_b, row_a
                
                base_id = base[0]
                donor_source = donor[4]
                base_source = base[4]
                
                # Merge JSON fields
                for col_idx, col_name in enumerate(json_cols):
                    base_val = json.loads(base[6 + col_idx]) if base[6 + col_idx] else {}
                    donor_val = json.loads(donor[6 + col_idx]) if donor[6 + col_idx] else {}
                    
                    if not donor_val:
                        continue
                    
                    changed = False
                    for field_path, trusted_sources in FIELD_TRUST.items():
                        col_prefix = field_path.split(".")[0]
                        if col_name != f"{col_prefix}_json":
                            continue
                        
                        field_name = field_path.split(".", 1)[1]
                        
                        # Skip if base already has this field
                        if base_val.get(field_name) is not None:
                            continue
                        
                        # Check if donor has it and is trusted
                        donor_field = donor_val.get(field_name)
                        if donor_field is None:
                            continue
                        
                        # Donor must be in trusted list AND have higher or equal trust than base
                        try:
                            donor_rank = trusted_sources.index(donor_source)
                        except ValueError:
                            donor_rank = 999
                        try:
                            base_rank = trusted_sources.index(base_source)
                        except ValueError:
                            base_rank = 999
                        
                        if donor_rank <= base_rank:
                            base_val[field_name] = donor_field
                            changed = True
                            stats["fields_merged"] += 1
                    
                    if changed:
                        updates.append((base_id, col_name, json.dumps(base_val)))
                
                # Merge scalar fields
                for field, col_idx in scalar_cols_idx.items():
                    if base[col_idx] is not None:
                        continue  # base already has it
                    
                    donor_val = donor[col_idx]
                    if donor_val is None:
                        continue
                    
                    trusted = FIELD_TRUST.get(field, [])
                    try:
                        donor_rank = trusted.index(donor_source)
                    except ValueError:
                        donor_rank = 999
                    try:
                        base_rank = trusted.index(base_source)
                    except ValueError:
                        base_rank = 999
                    
                    if donor_rank <= base_rank:
                        updates.append((base_id, field, donor_val))
                        stats["fields_merged"] += 1
    
    # Apply updates
    updated_ids = set()
    for car_id, col, val in updates:
        if car_id in updated_ids:
            continue
        updated_ids.add(car_id)
        
        # Collect all updates for this car
        car_updates = [(c, v) for cid, c, v in updates if cid == car_id]
        
        if dry_run:
            stats["cars_updated"] += 1
            continue
        
        # Build SET clause
        set_parts = []
        set_values = []
        for c, v in car_updates:
            set_parts.append(f"{c} = ?")
            set_values.append(v)
        
        set_parts.append("updated_at = datetime('now')")
        set_values.append(car_id)
        
        conn.execute(
            f"UPDATE car_metadata SET {', '.join(set_parts)} WHERE id = ?",
            set_values
        )
        stats["cars_updated"] += 1
    
    if not dry_run:
        conn.commit()
    
    return stats
