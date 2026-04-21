"""NHTSA source - US DOT Vehicle API."""

import time
import urllib.parse
import urllib.request

from sources import api_get_json
from models import CarRecord
from base import CarSource


class NHTSASource(CarSource):
    priority = 10

    @property
    def name(self):
        return "nhtsa"

    def fetch(self, conn=None, search=None, dry_run=False, **kwargs):
        cars = nhtsa_source(search=search, dry_run=dry_run)
        return [CarRecord.from_dict(c) for c in cars]


NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles"


def nhtsa_get_models(make, year=None):
    """Get models for a make from NHTSA."""
    url = f"{NHTSA_BASE}/getmodelsformake/{urllib.parse.quote(make)}?format=json"
    if year:
        url += f"&modelYear={year}"
    data = api_get_json(url)
    if data and data.get("Results"):
        return [(r["Make_Name"], r["Model_Name"]) for r in data["Results"]]
    return []


def nhtsa_source(search=None, dry_run=False):
    """Fetch car listings from NHTSA. Returns list of car dicts."""
    cars = []
    makes_models = []

    if search:
        parts = search.split()
        if len(parts) >= 2:
            makes_models = [(parts[0], " ".join(parts[1:]))]
        else:
            makes_models = [(search, None)]
    else:
        for make in ["Toyota", "Honda", "Nissan", "Mazda", "BMW", "Ford", "Chevrolet"]:
            models = nhtsa_get_models(make)
            if models:
                makes_models.extend(models)
            time.sleep(0.3)

    for make, model in makes_models:
        if not model:
            models = nhtsa_get_models(make)
            for m, mdl in models:
                cars.append({
                    "make": m, "model": mdl, "year": 2020,
                    "body_type": None,
                    "dimensions": {}, "engine": {}, "performance": {},
                    "drivetrain": None, "transmission": {},
                    "weight_kg": None, "fuel_type": None,
                    "price": {}, "confidence": 0.3, "source": "nhtsa"
                })
            continue

        for year in range(2024, 2018, -1):
            url = f"{NHTSA_BASE}/GetModelsForMakeYear/make/{urllib.parse.quote(make)}/modelyear/{year}?format=json"
            data = api_get_json(url)
            if data and data.get("Results"):
                for r in data["Results"]:
                    model_name = r.get("Model_Name", model)
                    if model and model.lower() not in model_name.lower():
                        continue
                    cars.append({
                        "make": r.get("Make_Name", make).title(),
                        "model": model_name,
                        "year": year,
                        "body_type": None,
                        "dimensions": {}, "engine": {}, "performance": {},
                        "drivetrain": None, "transmission": {},
                        "weight_kg": None, "fuel_type": None,
                        "price": {}, "confidence": 0.3, "source": "nhtsa"
                    })
                break
        time.sleep(0.3)

    return cars
