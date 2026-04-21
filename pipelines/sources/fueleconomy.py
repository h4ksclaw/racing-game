"""FuelEconomy.gov source - US DOE fuel economy API."""

import time
import urllib.parse
import xml.etree.ElementTree as ET

from sources import api_get_xml

FE_BASE = "https://fueleconomy.gov/ws/rest/vehicle"


def fe_source(search=None, dry_run=False):
    """Fetch car specs from fueleconomy.gov API."""
    cars = []
    year = 2020

    if search:
        parts = search.split()
        make = parts[0] if parts else None
        model_filter = " ".join(parts[1:]) if len(parts) > 1 else None
        makes_to_fetch = [make] if make else []
    else:
        makes_to_fetch = ["Toyota", "Honda", "Nissan", "Mazda", "BMW"]

    for make in makes_to_fetch:
        models_xml = api_get_xml(f"{FE_BASE}/menu/model?year={year}&make={urllib.parse.quote(make)}")
        if models_xml is None:
            continue

        models = [(item.find("text").text, item.find("value").text)
                  for item in models_xml.findall(".//menuItem")
                  if item.find("text") is not None and item.find("value") is not None]
        if model_filter:
            models = [(t, v) for t, v in models if model_filter.lower() in t.lower()]
        if not models:
            continue

        for trim_name, trim_value in models[:5]:
            opts_xml = api_get_xml(
                f"{FE_BASE}/menu/options?year={year}&make={urllib.parse.quote(make)}&model={urllib.parse.quote(trim_value)}"
            )
            if opts_xml is None:
                continue

            options = [(item.find("text").text, item.find("value").text)
                       for item in opts_xml.findall(".//menuItem")
                       if item.find("text") is not None and item.find("value") is not None]

            for opt_text, vid in options[:2]:
                if not vid:
                    continue
                spec_xml = api_get_xml(f"{FE_BASE}/{vid}")
                if spec_xml is None:
                    continue

                car = _parse_fe_vehicle(spec_xml, make, trim_name)
                if car:
                    cars.append(car)

            time.sleep(0.05)

    return cars


def _parse_fe_vehicle(xml_root, make, model):
    """Parse a fueleconomy.gov vehicle XML response into a car dict."""
    def text(tag):
        el = xml_root.find(tag)
        return el.text.strip() if el is not None and el.text else None

    def num(tag, default=None):
        v = text(tag)
        if v:
            try:
                return float(v.replace(",", ""))
            except ValueError:
                pass
        return default

    try:
        year = int(text("year") or 2020)
    except (ValueError, TypeError):
        year = 2020

    engine = {}
    disp = num("displ")
    if disp:
        engine["displacement_l"] = disp
    cyl = text("cylinders")
    if cyl:
        try:
            engine["cylinders"] = int(cyl)
        except ValueError:
            pass
    engine["configuration"] = text("eng_dscr") or None
    power_hp = num("hpv")
    if power_hp:
        engine["power_hp"] = power_hp

    perf = {}
    co2 = text("co2")
    if co2:
        perf["co2_grams_per_mile"] = float(co2)

    drive_raw = text("trany") or ""
    drive = "awd" if "AWD" in drive_raw else ("rwd" if "RWD" in drive_raw else "fwd")

    weight = num("pv4", None)
    fuel = text("fuelType1") or "gasoline"

    car = {
        "make": text("make") or make,
        "model": text("model") or model,
        "year": year,
        "body_type": None,
        "dimensions": {},
        "engine": engine,
        "performance": perf,
        "drivetrain": drive,
        "transmission": {"type": drive_raw} if drive_raw else {},
        "weight_kg": int(weight) if weight else None,
        "fuel_type": fuel,
        "price": {},
        "confidence": 0.5,
        "source": "fueleconomy"
    }
    return car
