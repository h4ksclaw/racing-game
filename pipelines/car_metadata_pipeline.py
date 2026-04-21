"""Car Metadata Pipeline - backward-compatible shim.

All logic has been split into focused modules:
  - pipelines/db.py              → init_db, upsert_car, _merge_json
  - pipelines/sources/reference.py → reference_source, REFERENCE_CARS
  - pipelines/sources/nhtsa.py    → nhtsa_source, nhtsa_get_models
  - pipelines/sources/fueleconomy.py → fe_source, _parse_fe_vehicle
  - pipelines/sources/autospecs.py → autospecs_scrape + parse helpers
  - pipelines/cli.py              → main(), argparse, SOURCES dispatch

This file re-exports everything so existing imports still work:
  from pipelines.car_metadata_pipeline import init_db, reference_source, etc.
  from car_metadata_pipeline import init_db, upsert_car  (when run from pipelines/)
"""

import os
import sys

# Ensure both pipelines/ (for absolute sub-module imports) and parent dir
# (for "from pipelines.car_metadata_pipeline" style) are on sys.path.
_this_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_this_dir)
for _d in (_this_dir, _parent_dir):
    if _d not in sys.path:
        sys.path.insert(0, _d)

from sources import api_get_json, api_get_xml
from sources.reference import reference_source, REFERENCE_CARS
from sources.nhtsa import nhtsa_source, nhtsa_get_models, NHTSA_BASE
from sources.fueleconomy import fe_source, _parse_fe_vehicle, FE_BASE
from sources.autospecs import (
    autospecs_scrape, _parse_weight, _parse_mm, _parse_drive,
    _parse_hp, _parse_top_speed, _parse_year, _parse_displacement,
    _parse_transmission, _infer_body_type,
    _is_excluded, _fetch_next_data, AUTOSPECS_HOME, SUV_FILTER_WORDS,
)
from db import init_db, upsert_car, _merge_json
from cli import main, SOURCES, DEFAULT_DB
