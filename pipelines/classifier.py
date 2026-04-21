"""Classification and tagging for car records."""

from __future__ import annotations

from typing import Any, Union

from models import CarRecord

CarLike = Union[dict[str, Any], CarRecord]

BODY_ALIASES = {
    "coupe": "coupe",
    "cabriolet": "roadster", "convertible": "roadster", "roadster": "roadster",
    "sedan": "sedan", "saloon": "sedan",
    "hatchback": "hatchback", "liftback": "hatchback",
    "wagon": "wagon", "estate": "wagon", "touring": "wagon",
    "suv": "suv", "crossover": "suv",
    "truck": "truck", "pickup": "truck",
    "van": "van", "minivan": "van",
}

RECOGNIZED_BODY_TYPES = set(BODY_ALIASES.values())

TRIM_BODY_KEYWORDS = {
    "coupe": "coupe", "cabriolet": "roadster", "convertible": "roadster",
    "roadster": "roadster", "hatchback": "hatchback", "hatch": "hatchback",
    "wagon": "wagon", "estate": "wagon", "touring": "wagon",
    "suv": "suv", "crossover": "suv",
    "truck": "truck", "pickup": "truck",
}


def _to_dict(car: CarLike) -> dict[str, Any]:
    if isinstance(car, CarRecord):
        return car.to_dict()
    return dict(car)


def classify_era(year) -> str:
    if year is None:
        return ""
    try:
        year = int(year)
    except (ValueError, TypeError):
        return ""
    if year < 1980:
        return "pre_80s"
    if year < 1990:
        return "80s"
    if year < 2000:
        return "90s"
    if year < 2010:
        return "2000s"
    if year < 2020:
        return "2010s"
    return "2020s"


def classify_performance_tier(car: CarLike) -> str:
    d = _to_dict(car)
    weight = d.get("weight_kg")
    if not weight:
        return "unknown"
    engine = d.get("engine", {}) or {}
    if isinstance(engine, dict):
        hp = engine.get("power_hp")
    else:
        hp = getattr(engine, "power_hp", None)
    if not hp:
        return "unknown"
    try:
        ratio = float(hp) / float(weight) * 1000
    except (ZeroDivisionError, TypeError, ValueError):
        return "unknown"
    if ratio < 60:
        return "economy"
    if ratio < 100:
        return "daily"
    if ratio < 150:
        return "sport"
    if ratio < 250:
        return "performance"
    if ratio < 400:
        return "supercar"
    return "hypercar"


def classify_body_type(car: CarLike) -> str:
    d = _to_dict(car)
    current = d.get("body_type")
    if current:
        current_lower = current.lower().strip()
        if current_lower in BODY_ALIASES:
            return BODY_ALIASES[current_lower]
        if current_lower in RECOGNIZED_BODY_TYPES:
            return current_lower

    # Infer from trim name
    trim = d.get("trim") or ""
    trim_lower = trim.lower()
    for keyword, body in TRIM_BODY_KEYWORDS.items():
        if keyword in trim_lower:
            return body

    return ""


def classify_car(car: CarLike) -> dict[str, Any]:
    d = _to_dict(car)
    era = classify_era(d.get("year"))
    tier = classify_performance_tier(car)
    body = classify_body_type(car)

    result = {"era": era, "performance_tier": tier}
    if body and body != (d.get("body_type") or ""):
        result["body_type"] = body
    return result
