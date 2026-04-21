#!/usr/bin/env python3
"""Car Spec Predictor - Predicts missing physics specs from archetypal profiles.

Design:
  - DB stays raw — only scraped/verified data in car_metadata, never estimates
  - Prediction is on-the-fly — applied when querying, not stored
  - Profiles are composable — based on body_type + era + drivetrain
"""

import json

# ---------------------------------------------------------------------------
# Profile system
# ---------------------------------------------------------------------------

PROFILES = {
    # ── Sedan ──
    ("sedan", "80s", "fwd"): {
        "cd": 0.34, "wheelbase_m": 2.50, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "strut",
    },
    ("sedan", "80s", "rwd"): {
        "cd": 0.33, "wheelbase_m": 2.60, "weight_front_pct": 55,
        "suspension_front": "double_wishbone", "suspension_rear": "four_link",
    },
    ("sedan", "80s", "awd"): {
        "cd": 0.35, "wheelbase_m": 2.55, "weight_front_pct": 58,
        "suspension_front": "strut", "suspension_rear": "four_link",
    },
    ("sedan", "90s", "fwd"): {
        "cd": 0.32, "wheelbase_m": 2.55, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("sedan", "90s", "rwd"): {
        "cd": 0.31, "wheelbase_m": 2.65, "weight_front_pct": 53,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("sedan", "90s", "awd"): {
        "cd": 0.32, "wheelbase_m": 2.60, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2000s", "fwd"): {
        "cd": 0.30, "wheelbase_m": 2.65, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2000s", "rwd"): {
        "cd": 0.29, "wheelbase_m": 2.80, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("sedan", "2000s", "awd"): {
        "cd": 0.30, "wheelbase_m": 2.65, "weight_front_pct": 58,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2010s", "fwd"): {
        "cd": 0.28, "wheelbase_m": 2.70, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2010s", "rwd"): {
        "cd": 0.27, "wheelbase_m": 2.85, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("sedan", "2010s", "awd"): {
        "cd": 0.28, "wheelbase_m": 2.75, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2020s", "fwd"): {
        "cd": 0.26, "wheelbase_m": 2.75, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("sedan", "2020s", "rwd"): {
        "cd": 0.26, "wheelbase_m": 2.85, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("sedan", "2020s", "awd"): {
        "cd": 0.27, "wheelbase_m": 2.78, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    # ── Coupe ──
    ("coupe", "80s", "rwd"): {
        "cd": 0.33, "wheelbase_m": 2.45, "weight_front_pct": 53,
        "suspension_front": "double_wishbone", "suspension_rear": "four_link",
    },
    ("coupe", "90s", "fwd"): {
        "cd": 0.32, "wheelbase_m": 2.45, "weight_front_pct": 62,
        "suspension_front": "double_wishbone", "suspension_rear": "double_wishbone",
    },
    ("coupe", "90s", "rwd"): {
        "cd": 0.31, "wheelbase_m": 2.55, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("coupe", "2000s", "fwd"): {
        "cd": 0.31, "wheelbase_m": 2.55, "weight_front_pct": 62,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("coupe", "2000s", "rwd"): {
        "cd": 0.30, "wheelbase_m": 2.65, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("coupe", "2000s", "awd"): {
        "cd": 0.31, "wheelbase_m": 2.60, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("coupe", "2010s", "fwd"): {
        "cd": 0.29, "wheelbase_m": 2.60, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("coupe", "2010s", "rwd"): {
        "cd": 0.28, "wheelbase_m": 2.70, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("coupe", "2010s", "awd"): {
        "cd": 0.29, "wheelbase_m": 2.65, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("coupe", "2020s", "rwd"): {
        "cd": 0.28, "wheelbase_m": 2.70, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("coupe", "2020s", "fwd"): {
        "cd": 0.28, "wheelbase_m": 2.65, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("coupe", "2020s", "awd"): {
        "cd": 0.29, "wheelbase_m": 2.68, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    # ── Hatchback ──
    ("hatchback", "80s", "fwd"): {
        "cd": 0.34, "wheelbase_m": 2.35, "weight_front_pct": 62,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("hatchback", "90s", "fwd"): {
        "cd": 0.33, "wheelbase_m": 2.40, "weight_front_pct": 62,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("hatchback", "2000s", "fwd"): {
        "cd": 0.31, "wheelbase_m": 2.50, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("hatchback", "2000s", "awd"): {
        "cd": 0.32, "wheelbase_m": 2.50, "weight_front_pct": 58,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("hatchback", "2010s", "fwd"): {
        "cd": 0.29, "wheelbase_m": 2.55, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("hatchback", "2010s", "rwd"): {
        "cd": 0.30, "wheelbase_m": 2.55, "weight_front_pct": 53,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("hatchback", "2010s", "awd"): {
        "cd": 0.30, "wheelbase_m": 2.55, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("hatchback", "2020s", "fwd"): {
        "cd": 0.28, "wheelbase_m": 2.60, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    # ── Wagon ──
    ("wagon", "80s", "rwd"): {
        "cd": 0.35, "wheelbase_m": 2.60, "weight_front_pct": 55,
        "suspension_front": "double_wishbone", "suspension_rear": "four_link",
    },
    ("wagon", "90s", "rwd"): {
        "cd": 0.34, "wheelbase_m": 2.65, "weight_front_pct": 55,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("wagon", "90s", "fwd"): {
        "cd": 0.34, "wheelbase_m": 2.50, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("wagon", "2000s", "rwd"): {
        "cd": 0.32, "wheelbase_m": 2.70, "weight_front_pct": 54,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("wagon", "2000s", "fwd"): {
        "cd": 0.31, "wheelbase_m": 2.60, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("wagon", "2000s", "awd"): {
        "cd": 0.32, "wheelbase_m": 2.65, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("wagon", "2010s", "fwd"): {
        "cd": 0.29, "wheelbase_m": 2.65, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("wagon", "2010s", "rwd"): {
        "cd": 0.29, "wheelbase_m": 2.80, "weight_front_pct": 53,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("wagon", "2010s", "awd"): {
        "cd": 0.30, "wheelbase_m": 2.72, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("wagon", "2020s", "fwd"): {
        "cd": 0.28, "wheelbase_m": 2.70, "weight_front_pct": 60,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("wagon", "2020s", "rwd"): {
        "cd": 0.28, "wheelbase_m": 2.80, "weight_front_pct": 53,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("wagon", "2020s", "awd"): {
        "cd": 0.29, "wheelbase_m": 2.75, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    # ── Convertible ──
    ("convertible", "80s", "rwd"): {
        "cd": 0.37, "wheelbase_m": 2.40, "weight_front_pct": 53,
        "suspension_front": "double_wishbone", "suspension_rear": "four_link",
    },
    ("convertible", "90s", "fwd"): {
        "cd": 0.35, "wheelbase_m": 2.40, "weight_front_pct": 62,
        "suspension_front": "strut", "suspension_rear": "torsion_beam",
    },
    ("convertible", "90s", "rwd"): {
        "cd": 0.34, "wheelbase_m": 2.50, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("convertible", "2000s", "fwd"): {
        "cd": 0.33, "wheelbase_m": 2.45, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("convertible", "2000s", "rwd"): {
        "cd": 0.32, "wheelbase_m": 2.55, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("convertible", "2000s", "awd"): {
        "cd": 0.33, "wheelbase_m": 2.50, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("convertible", "2010s", "fwd"): {
        "cd": 0.31, "wheelbase_m": 2.50, "weight_front_pct": 61,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("convertible", "2010s", "rwd"): {
        "cd": 0.30, "wheelbase_m": 2.60, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("convertible", "2010s", "awd"): {
        "cd": 0.31, "wheelbase_m": 2.58, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    ("convertible", "2020s", "rwd"): {
        "cd": 0.29, "wheelbase_m": 2.60, "weight_front_pct": 52,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("convertible", "2020s", "awd"): {
        "cd": 0.30, "wheelbase_m": 2.60, "weight_front_pct": 56,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
    # ── Roadster ──
    ("roadster", "90s", "rwd"): {
        "cd": 0.38, "wheelbase_m": 2.27, "weight_front_pct": 50,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    ("roadster", "2000s", "rwd"): {
        "cd": 0.36, "wheelbase_m": 2.33, "weight_front_pct": 50,
        "suspension_front": "double_wishbone", "suspension_rear": "multilink",
    },
    # Fallback
    ("_default", None, None): {
        "cd": 0.32, "wheelbase_m": 2.60, "weight_front_pct": 57,
        "suspension_front": "strut", "suspension_rear": "multilink",
    },
}


# ---------------------------------------------------------------------------
# Era classification
# ---------------------------------------------------------------------------

def classify_era(year):
    """Classify a year into an era string."""
    if not isinstance(year, int) or year < 1900:
        return "2000s"
    if year < 1990:
        return "80s"
    if year < 2000:
        return "90s"
    if year < 2010:
        return "2000s"
    if year < 2020:
        return "2010s"
    return "2020s"


# ---------------------------------------------------------------------------
# Profile lookup
# ---------------------------------------------------------------------------

def _get_profile(body_type, era, drivetrain):
    """Look up profile with fallbacks: exact → same era/body → same body → default."""
    if body_type and era and drivetrain:
        key = (body_type, era, drivetrain)
        if key in PROFILES:
            return PROFILES[key]

    # Try same body + era with any drivetrain
    if body_type and era:
        for dt in ("fwd", "rwd", "awd"):
            key = (body_type, era, dt)
            if key in PROFILES:
                return PROFILES[key]

    # Try same body + any era
    if body_type:
        for e in ("2020s", "2010s", "2000s", "90s", "80s"):
            for dt in ("fwd", "rwd", "awd"):
                key = (body_type, e, dt)
                if key in PROFILES:
                    return PROFILES[key]

    return PROFILES[("_default", None, None)]


# ---------------------------------------------------------------------------
# Gear ratio prediction
# ---------------------------------------------------------------------------

GEAR_SETS = {
    "80s_90s_na": {
        "ratios": [3.6, 2.1, 1.4, 1.0, 0.8],
        "final_drive": 4.1,
    },
    "2000s_turbo": {
        "ratios": [3.3, 2.0, 1.4, 1.0, 0.75, 0.65],
        "final_drive": 3.7,
    },
    "2010s+_na": {
        "ratios": [3.5, 2.1, 1.5, 1.1, 0.85, 0.7],
        "final_drive": 3.5,
    },
}


def _predict_gear_ratios(engine_json, era):
    """Predict gear ratios based on engine displacement and era."""
    displacement = None
    if isinstance(engine_json, str):
        try:
            engine_json = json.loads(engine_json)
        except (json.JSONDecodeError, TypeError):
            return None

    if isinstance(engine_json, dict):
        displacement = engine_json.get("displacement_l")

    is_turbo = False
    if isinstance(engine_json, dict):
        asp = str(engine_json.get("aspiration", "")).lower()
        is_turbo = "turbo" in asp or "supercharge" in asp
        # Heuristic: >2.5L in 80s/90s likely turbo for performance cars
        if not is_turbo and displacement and displacement > 2.5 and era in ("80s", "90s"):
            is_turbo = True

    if era in ("80s", "90s") and not is_turbo:
        return GEAR_SETS["80s_90s_na"]
    if era == "2000s" and is_turbo:
        return GEAR_SETS["2000s_turbo"]
    if era in ("2010s", "2020s"):
        return GEAR_SETS["2010s+_na"]
    # Default
    return GEAR_SETS["80s_90s_na"]


# ---------------------------------------------------------------------------
# Main prediction function
# ---------------------------------------------------------------------------

def predict_specs(car):
    """Given a car record from DB, return predicted values for missing fields.

    Returns dict with only the PREDICTED fields (not the original car data).
    Each predicted field has a ``_predicted: True`` flag so the UI can
    distinguish estimates from verified data.
    """
    if not isinstance(car, dict):
        return {}

    year = car.get("year")
    body_type = car.get("body_type")
    drivetrain = car.get("drivetrain")
    era = classify_era(year)
    profile = _get_profile(body_type, era, drivetrain)

    # Parse existing JSON fields
    def _parse_json_field(field_name):
        val = car.get(field_name)
        if isinstance(val, dict):
            return val
        if isinstance(val, str) and val.strip():
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                pass
        return {}

    dimensions = _parse_json_field("dimensions_json") or _parse_json_field("dimensions")
    engine = _parse_json_field("engine_json") or _parse_json_field("engine")
    aero = _parse_json_field("aero_json") or _parse_json_field("aero")
    suspension = _parse_json_field("suspension_json") or _parse_json_field("suspension")

    length_m = dimensions.get("length") if isinstance(dimensions, dict) else None
    if length_m is not None:
        length_m = float(length_m)

    predicted = {}

    # --- Cd (drag coefficient) ---
    existing_cd = aero.get("drag_coefficient") if isinstance(aero, dict) else None
    if existing_cd is None:
        cd = profile["cd"]
        # Adjust for length
        if length_m is not None:
            if length_m > 4.5:
                cd -= 0.002 * ((length_m - 4.5) / 0.1)
            elif length_m < 4.0:
                cd += 0.002 * ((4.0 - length_m) / 0.1)
        predicted["cd"] = round(cd, 3)
        predicted["cd_predicted"] = True

    # --- Wheelbase ---
    existing_wb = dimensions.get("wheelbase") if isinstance(dimensions, dict) else None
    if existing_wb is None:
        if length_m is not None:
            wb = round(length_m * 0.57, 3)
        else:
            wb = profile["wheelbase_m"]
        predicted["wheelbase_m"] = wb
        predicted["wheelbase_m_predicted"] = True

    # --- Weight distribution ---
    existing_wd = car.get("weight_front_pct")
    if existing_wd is None:
        wd = profile["weight_front_pct"]
        # Adjust for drivetrain
        if drivetrain == "fwd":
            wd += 3
        elif drivetrain == "awd":
            wd += 1
        predicted["weight_front_pct"] = min(wd, 70)
        predicted["weight_front_pct_predicted"] = True

    # --- Gear ratios ---
    if not (isinstance(engine, dict) and engine.get("gear_ratios")):
        gears = _predict_gear_ratios(engine, era)
        if gears:
            predicted["gear_ratios"] = gears
            predicted["gear_ratios_predicted"] = True

    # --- Suspension ---
    existing_susp_f = suspension.get("front_type") if isinstance(suspension, dict) else None
    existing_susp_r = suspension.get("rear_type") if isinstance(suspension, dict) else None
    if existing_susp_f is None:
        predicted["suspension_front"] = profile["suspension_front"]
        predicted["suspension_front_predicted"] = True
    if existing_susp_r is None:
        predicted["suspension_rear"] = profile["suspension_rear"]
        predicted["suspension_rear_predicted"] = True

    return predicted
