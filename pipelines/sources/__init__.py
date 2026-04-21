"""Sources package - re-exports all data sources."""

import json
import urllib.request
import xml.etree.ElementTree as ET


def api_get_json(url, timeout=15, max_retries=3, backoff=2.0):
    """GET a URL and return parsed JSON. Returns None on error after retries."""
    import time as _time
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff * (2 ** attempt)
                _time.sleep(wait)
            else:
                print(f"  [warn] API error for {url}: {e}")
                return None


def api_get_xml(url, timeout=15, max_retries=3, backoff=2.0):
    """GET a URL and return parsed XML ElementTree root. Returns None on error after retries."""
    import time as _time
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return ET.fromstring(resp.read().decode())
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff * (2 ** attempt)
                _time.sleep(wait)
            else:
                print(f"  [warn] API error for {url}: {e}")
                return None


from sources.reference import reference_source, REFERENCE_CARS  # noqa: E402
from sources.nhtsa import nhtsa_source, nhtsa_get_models  # noqa: E402
from sources.fueleconomy import fe_source, _parse_fe_vehicle  # noqa: E402
from sources.autospecs import (  # noqa: E402
    autospecs_scrape, _parse_weight, _parse_mm, _parse_drive,
    _parse_hp, _parse_top_speed, _parse_year, _parse_displacement,
    _is_excluded, _fetch_next_data, AUTOSPECS_HOME, SUV_FILTER_WORDS,
)

__all__ = [
    "api_get_json", "api_get_xml",
    "reference_source", "REFERENCE_CARS",
    "nhtsa_source", "nhtsa_get_models",
    "fe_source", "_parse_fe_vehicle",
    "autospecs_scrape", "_parse_weight", "_parse_mm", "_parse_drive",
    "_parse_hp", "_parse_top_speed", "_parse_year", "_parse_displacement",
    "_is_excluded", "_fetch_next_data", "AUTOSPECS_HOME", "SUV_FILTER_WORDS",
]
