#!/usr/bin/env python3
"""Car Metadata Pipeline - Populates car_metadata table from public APIs and reference data.

Sources:
  - nhtsa: US DOT Vehicle API (free, no key) - make/model/year listings
  - fueleconomy: US DOE fuel economy API (free, no key) - specs for US-market cars
  - reference: Hardcoded dataset for classic/JDM cars APIs don't cover

Usage:
  python car_metadata_pipeline.py                          # all sources, reference cars
  python car_metadata_pipeline.py --source nhtsa           # NHTSA only
  python car_metadata_pipeline.py --source fueleconomy --search "Honda Civic"
  python car_metadata_pipeline.py --dry-run                # preview without writing
  python car_metadata_pipeline.py --source reference --search "AE86"
  python car_metadata_pipeline.py --db /path/to/db.sqlite  # custom DB path
"""

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Reference dataset for classic/JDM cars not well-covered by US APIs
# ---------------------------------------------------------------------------

REFERENCE_CARS = [
    # Toyota AE86 (1983-1987)
    {
        "make": "Toyota", "model": "Corolla AE86 (Sprinter Trueno)", "year": 1986,
        "trim": "GT-Apex",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.26, "width": 1.63, "height": 1.34,
            "wheelbase": 2.43, "track_width": 1.40, "ground_clearance": 0.15,
            "front_track_m": 1.40, "rear_track_m": 1.40,
            "front_overhang_m": 0.87, "rear_overhang_m": 0.96,
        },
        "engine": {
            "displacement_l": 1.6, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 130, "torque_nm": 152,
            "max_rpm": 7600, "idle_rpm": 850, "compression_ratio": 9.4,
            "bore_mm": 81.0, "stroke_mm": 77.0, "valves_per_cylinder": 4,
            "fuel_delivery": "EFI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.3},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "disc", "front_diameter_mm": 232},
        "suspension": {"front_type": "strut", "rear_type": "four_link"},
        "tires": {"front_size": "185/70R13", "rear_size": "185/70R13", "width_mm": 185, "aspect_ratio": 70, "wheel_diameter_in": 13},
        "aero": {"drag_coefficient": 0.36},
        "weight_kg": 940, "weight_front_pct": 53,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 8.3, "top_speed_km_h": 190, "quarter_mile_s": 16.4, "lateral_g": 0.82},
        "price": {"min_usd": 2500, "max_usd": 35000, "avg_usd": 12000, "note": "original MSRP ~$9k; restored $15k-35k"},
        "eras": "80s,90s", "tags": "jdm,drift,classic,lightweight,affordable",
        "confidence": 0.9, "source": "reference"
    },
    # Mazda MX-5 NA (1989-1997)
    {
        "make": "Mazda", "model": "MX-5 Miata NA", "year": 1990,
        "trim": "1.6",
        "body_type": "roadster",
        "dimensions": {
            "length": 3.97, "width": 1.67, "height": 1.23,
            "wheelbase": 2.27, "track_width": 1.40, "ground_clearance": 0.14,
            "front_track_m": 1.41, "rear_track_m": 1.40,
            "front_overhang_m": 0.78, "rear_overhang_m": 0.92,
        },
        "engine": {
            "displacement_l": 1.6, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 116, "torque_nm": 137,
            "max_rpm": 6500, "idle_rpm": 800, "compression_ratio": 9.0,
            "bore_mm": 78.0, "stroke_mm": 83.6, "valves_per_cylinder": 4,
            "fuel_delivery": "EFI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.1},
        "brakes": {"front_type": "disc", "rear_type": "disc", "front_diameter_mm": 255},
        "suspension": {"front_type": "double_wishbone", "rear_type": "multilink"},
        "tires": {"front_size": "185/60R14", "rear_size": "185/60R14", "width_mm": 185, "aspect_ratio": 60, "wheel_diameter_in": 14},
        "aero": {"drag_coefficient": 0.38},
        "weight_kg": 960, "weight_front_pct": 50,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 9.4, "top_speed_km_h": 183, "quarter_mile_s": 17.1, "lateral_g": 0.87},
        "price": {"min_usd": 2000, "max_usd": 15000, "avg_usd": 7000, "note": "original MSRP ~$14k; good ones $5k-15k"},
        "eras": "90s", "tags": "roadster,lightweight,miata,jdm,affordable,handling",
        "confidence": 0.9, "source": "reference"
    },
    {
        "make": "Mazda", "model": "MX-5 Miata NB", "year": 2000,
        "trim": "1.8",
        "body_type": "roadster",
        "dimensions": {
            "length": 3.95, "width": 1.67, "height": 1.22,
            "wheelbase": 2.29, "track_width": 1.44, "ground_clearance": 0.14,
            "front_track_m": 1.45, "rear_track_m": 1.44,
            "front_overhang_m": 0.78, "rear_overhang_m": 0.88,
        },
        "engine": {
            "displacement_l": 1.8, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 146, "torque_nm": 167,
            "max_rpm": 6800, "idle_rpm": 800, "compression_ratio": 10.0,
            "bore_mm": 83.0, "stroke_mm": 85.0, "valves_per_cylinder": 4,
            "fuel_delivery": "EFI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.1},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "disc", "front_diameter_mm": 258},
        "suspension": {"front_type": "double_wishbone", "rear_type": "multilink"},
        "tires": {"front_size": "195/50R15", "rear_size": "195/50R15", "width_mm": 195, "aspect_ratio": 50, "wheel_diameter_in": 15},
        "aero": {"drag_coefficient": 0.36},
        "weight_kg": 1040, "weight_front_pct": 50,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.8, "top_speed_km_h": 200, "quarter_mile_s": 16.0, "lateral_g": 0.91},
        "price": {"min_usd": 3000, "max_usd": 18000, "avg_usd": 9000, "note": "original MSRP ~$21k"},
        "eras": "2000s", "tags": "roadster,lightweight,miata,handling",
        "confidence": 0.9, "source": "reference"
    },
    # Honda Civic EG6 (1992-1995)
    {
        "make": "Honda", "model": "Civic EG6 (Si II)", "year": 1995,
        "trim": "Si II",
        "body_type": "hatchback",
        "dimensions": {
            "length": 4.19, "width": 1.70, "height": 1.35,
            "wheelbase": 2.57, "track_width": 1.47, "ground_clearance": 0.15,
            "front_track_m": 1.47, "rear_track_m": 1.46,
            "front_overhang_m": 0.78, "rear_overhang_m": 0.84,
        },
        "engine": {
            "displacement_l": 1.6, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 160, "torque_nm": 150,
            "max_rpm": 7800, "idle_rpm": 800, "compression_ratio": 10.4,
            "bore_mm": 81.0, "stroke_mm": 77.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI",
        },
        "drivetrain": "fwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.26},
        "brakes": {"front_type": "disc", "rear_type": "drum", "front_diameter_mm": 262},
        "suspension": {"front_type": "double_wishbone", "rear_type": "double_wishbone"},
        "tires": {"front_size": "185/60R14", "rear_size": "185/60R14", "width_mm": 185, "aspect_ratio": 60, "wheel_diameter_in": 14},
        "aero": {"drag_coefficient": 0.32},
        "weight_kg": 1060, "weight_front_pct": 60,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.5, "top_speed_km_h": 210, "quarter_mile_s": 15.8, "lateral_g": 0.85},
        "price": {"min_usd": 3000, "max_usd": 25000, "avg_usd": 12000, "note": "JDM Si II, B16A engine"},
        "eras": "90s", "tags": "jdm,hatchback,hot_hatch,vtec,affordable",
        "confidence": 0.85, "source": "reference"
    },
    # Honda Civic EK9 Type R (1997-2000)
    {
        "make": "Honda", "model": "Civic EK9 (Type R)", "year": 1998,
        "trim": "Type R",
        "body_type": "hatchback",
        "dimensions": {
            "length": 4.18, "width": 1.70, "height": 1.38,
            "wheelbase": 2.62, "track_width": 1.47, "ground_clearance": 0.15,
            "front_track_m": 1.47, "rear_track_m": 1.46,
            "front_overhang_m": 0.76, "rear_overhang_m": 0.80,
        },
        "engine": {
            "displacement_l": 1.6, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 185, "torque_nm": 160,
            "max_rpm": 8200, "idle_rpm": 850, "compression_ratio": 10.8,
            "bore_mm": 81.0, "stroke_mm": 77.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI",
        },
        "drivetrain": "fwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.79},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "disc", "front_diameter_mm": 282},
        "suspension": {"front_type": "double_wishbone", "rear_type": "double_wishbone"},
        "tires": {"front_size": "195/55R15", "rear_size": "195/55R15", "width_mm": 195, "aspect_ratio": 55, "wheel_diameter_in": 15},
        "aero": {"drag_coefficient": 0.31},
        "weight_kg": 1040, "weight_front_pct": 60,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.7, "top_speed_km_h": 215, "quarter_mile_s": 15.2, "lateral_g": 0.93},
        "price": {"min_usd": 8000, "max_usd": 40000, "avg_usd": 20000, "note": "JDM only, B16B engine"},
        "eras": "90s,2000s", "tags": "jdm,type_r,hatchback,hot_hatch,vtec,legend",
        "confidence": 0.85, "source": "reference"
    },
    # Nissan Silvia S13 (1988-1994)
    {
        "make": "Nissan", "model": "Silvia S13", "year": 1989,
        "trim": "Kouki Turbo",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.47, "width": 1.69, "height": 1.29,
            "wheelbase": 2.47, "track_width": 1.46, "ground_clearance": 0.15,
            "front_track_m": 1.46, "rear_track_m": 1.46,
            "front_overhang_m": 0.88, "rear_overhang_m": 1.12,
        },
        "engine": {
            "displacement_l": 1.8, "cylinders": 4, "configuration": "I4",
            "aspiration": "turbo", "power_hp": 177, "torque_nm": 226,
            "max_rpm": 6800, "idle_rpm": 800, "compression_ratio": 8.5,
            "bore_mm": 83.0, "stroke_mm": 83.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI", "boost_bar": 0.6,
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 4.08},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "disc", "front_diameter_mm": 257},
        "suspension": {"front_type": "macpherson", "rear_type": "multilink"},
        "tires": {"front_size": "205/60R15", "rear_size": "205/60R15", "width_mm": 205, "aspect_ratio": 60, "wheel_diameter_in": 15},
        "aero": {"drag_coefficient": 0.33},
        "weight_kg": 1080, "weight_front_pct": 52,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 7.0, "top_speed_km_h": 215, "quarter_mile_s": 15.6, "lateral_g": 0.84},
        "price": {"min_usd": 3000, "max_usd": 30000, "avg_usd": 12000, "note": "CA18DET turbo; SR20DET in later S13"},
        "eras": "80s,90s", "tags": "jdm,drift,classic,turbo,affordable",
        "confidence": 0.85, "source": "reference"
    },
    # Nissan Silvia S14 (1993-1999)
    {
        "make": "Nissan", "model": "Silvia S14 (Kouki)", "year": 1997,
        "trim": "Kouki",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.50, "width": 1.73, "height": 1.31,
            "wheelbase": 2.52, "track_width": 1.48, "ground_clearance": 0.14,
            "front_track_m": 1.48, "rear_track_m": 1.48,
            "front_overhang_m": 0.90, "rear_overhang_m": 1.08,
        },
        "engine": {
            "displacement_l": 2.0, "cylinders": 4, "configuration": "I4",
            "aspiration": "turbo", "power_hp": 220, "torque_nm": 275,
            "max_rpm": 7000, "idle_rpm": 800, "compression_ratio": 8.5,
            "bore_mm": 86.0, "stroke_mm": 86.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI", "boost_bar": 0.7,
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 3.69},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "ventilated_disc", "front_diameter_mm": 280},
        "suspension": {"front_type": "macpherson", "rear_type": "multilink"},
        "tires": {"front_size": "205/55R16", "rear_size": "205/55R16", "width_mm": 205, "aspect_ratio": 55, "wheel_diameter_in": 16},
        "aero": {"drag_coefficient": 0.32},
        "weight_kg": 1240, "weight_front_pct": 52,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.0, "top_speed_km_h": 235, "quarter_mile_s": 14.8, "lateral_g": 0.89},
        "price": {"min_usd": 5000, "max_usd": 35000, "avg_usd": 15000, "note": "SR20DET, JDM spec"},
        "eras": "90s,2000s", "tags": "jdm,drift,turbo,classic",
        "confidence": 0.85, "source": "reference"
    },
    # Nissan Silvia S15 (1999-2002)
    {
        "make": "Nissan", "model": "Silvia S15 Spec R", "year": 2002,
        "trim": "Spec R",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.44, "width": 1.73, "height": 1.32,
            "wheelbase": 2.52, "track_width": 1.48, "ground_clearance": 0.14,
            "front_track_m": 1.48, "rear_track_m": 1.48,
            "front_overhang_m": 0.88, "rear_overhang_m": 1.04,
        },
        "engine": {
            "displacement_l": 2.0, "cylinders": 4, "configuration": "I4",
            "aspiration": "turbo", "power_hp": 247, "torque_nm": 275,
            "max_rpm": 7200, "idle_rpm": 800, "compression_ratio": 8.5,
            "bore_mm": 86.0, "stroke_mm": 86.0, "valves_per_cylinder": 4,
            "fuel_delivery": "DI", "boost_bar": 0.85,
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 6, "type": "manual", "final_drive": 3.69},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "ventilated_disc", "front_diameter_mm": 296, "abs": True},
        "suspension": {"front_type": "macpherson", "rear_type": "multilink"},
        "tires": {"front_size": "225/45R17", "rear_size": "245/40R17", "width_mm": 225, "aspect_ratio": 45, "wheel_diameter_in": 17},
        "aero": {"drag_coefficient": 0.30},
        "weight_kg": 1240, "weight_front_pct": 53,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 5.4, "top_speed_km_h": 245, "quarter_mile_s": 13.9, "lateral_g": 0.96},
        "price": {"min_usd": 10000, "max_usd": 50000, "avg_usd": 25000, "note": "SR20DET, JDM only"},
        "eras": "2000s", "tags": "jdm,drift,turbo,legend,handling",
        "confidence": 0.85, "source": "reference"
    },
    # BMW M3 E30 (1986-1991)
    {
        "make": "BMW", "model": "M3 E30", "year": 1989,
        "trim": "",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.33, "width": 1.68, "height": 1.37,
            "wheelbase": 2.57, "track_width": 1.41, "ground_clearance": 0.13,
            "front_track_m": 1.41, "rear_track_m": 1.42,
            "front_overhang_m": 0.80, "rear_overhang_m": 0.96,
        },
        "engine": {
            "displacement_l": 2.3, "cylinders": 4, "configuration": "I4",
            "aspiration": "NA", "power_hp": 200, "torque_nm": 240,
            "max_rpm": 7000, "idle_rpm": 900, "compression_ratio": 10.5,
            "bore_mm": 93.4, "stroke_mm": 84.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 3.15},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "ventilated_disc", "front_diameter_mm": 282, "abs": False},
        "suspension": {"front_type": "macpherson", "rear_type": "semi_trailing_arm"},
        "tires": {"front_size": "205/55R15", "rear_size": "205/55R15", "width_mm": 205, "aspect_ratio": 55, "wheel_diameter_in": 15},
        "aero": {"drag_coefficient": 0.35},
        "weight_kg": 1200, "weight_front_pct": 54,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 6.7, "top_speed_km_h": 235, "quarter_mile_s": 15.1, "lateral_g": 0.90},
        "price": {"min_usd": 30000, "max_usd": 150000, "avg_usd": 65000, "note": "S14 engine, collector car"},
        "eras": "80s,90s", "tags": "classic,bmw,homologation,legend,collector",
        "confidence": 0.9, "source": "reference"
    },
    # BMW M3 E36 (1992-1999)
    {
        "make": "BMW", "model": "M3 E36", "year": 1996,
        "trim": "Euro",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.43, "width": 1.71, "height": 1.35,
            "wheelbase": 2.70, "track_width": 1.43, "ground_clearance": 0.12,
            "front_track_m": 1.43, "rear_track_m": 1.44,
            "front_overhang_m": 0.80, "rear_overhang_m": 0.93,
        },
        "engine": {
            "displacement_l": 3.2, "cylinders": 6, "configuration": "I6",
            "aspiration": "NA", "power_hp": 321, "torque_nm": 350,
            "max_rpm": 7000, "idle_rpm": 800, "compression_ratio": 10.5,
            "bore_mm": 86.0, "stroke_mm": 91.0, "valves_per_cylinder": 4,
            "fuel_delivery": "MPI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 5, "type": "manual", "final_drive": 3.23},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "ventilated_disc", "front_diameter_mm": 315, "abs": True},
        "suspension": {"front_type": "macpherson", "rear_type": "z_axle"},
        "tires": {"front_size": "225/45R17", "rear_size": "245/40R17", "width_mm": 225, "aspect_ratio": 45, "wheel_diameter_in": 17},
        "aero": {"drag_coefficient": 0.32},
        "weight_kg": 1460, "weight_front_pct": 54,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 5.5, "top_speed_km_h": 250, "quarter_mile_s": 13.7, "lateral_g": 0.92},
        "price": {"min_usd": 5000, "max_usd": 30000, "avg_usd": 15000, "note": "US-spec 240hp; Euro 321hp shown here"},
        "eras": "90s", "tags": "classic,bmw,straight_six,affordable",
        "confidence": 0.85, "source": "reference"
    },
    # BMW M3 E46 (2000-2006)
    {
        "make": "BMW", "model": "M3 E46", "year": 2003,
        "trim": "CSL",
        "body_type": "coupe",
        "dimensions": {
            "length": 4.57, "width": 1.78, "height": 1.37,
            "wheelbase": 2.76, "track_width": 1.51, "ground_clearance": 0.11,
            "front_track_m": 1.51, "rear_track_m": 1.51,
            "front_overhang_m": 0.82, "rear_overhang_m": 0.99,
        },
        "engine": {
            "displacement_l": 3.2, "cylinders": 6, "configuration": "I6",
            "aspiration": "NA", "power_hp": 343, "torque_nm": 365,
            "max_rpm": 7900, "idle_rpm": 800, "compression_ratio": 11.5,
            "bore_mm": 87.0, "stroke_mm": 89.6, "valves_per_cylinder": 4,
            "fuel_delivery": "DI",
        },
        "drivetrain": "rwd",
        "transmission": {"gear_count": 6, "type": "manual", "final_drive": 3.62},
        "brakes": {"front_type": "ventilated_disc", "rear_type": "ventilated_disc", "front_diameter_mm": 345, "abs": True},
        "suspension": {"front_type": "macpherson", "rear_type": "multilink"},
        "tires": {"front_size": "225/40R19", "rear_size": "255/35R19", "width_mm": 225, "aspect_ratio": 40, "wheel_diameter_in": 19},
        "aero": {"drag_coefficient": 0.35, "downforce_kg": 35},
        "weight_kg": 1570, "weight_front_pct": 53,
        "fuel_type": "gasoline",
        "performance": {"0_100_km_h": 4.8, "top_speed_km_h": 250, "quarter_mile_s": 13.0, "lateral_g": 0.99},
        "price": {"min_usd": 8000, "max_usd": 50000, "avg_usd": 25000, "note": "S54 engine, SMG or manual"},
        "eras": "2000s", "tags": "classic,bmw,legend,handling,straight_six",
        "confidence": 0.9, "source": "reference"
    },
]

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get_json(url, timeout=15):
    """GET a URL and return parsed JSON. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  [warn] API error for {url}: {e}")
        return None


def api_get_xml(url, timeout=15):
    """GET a URL and return parsed XML ElementTree root. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return ET.fromstring(resp.read().decode())
    except Exception as e:
        print(f"  [warn] API error for {url}: {e}")
        return None


# ---------------------------------------------------------------------------
# NHTSA source - US DOT Vehicle API
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# FuelEconomy.gov source
# ---------------------------------------------------------------------------

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

            time.sleep(0.5)

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


# ---------------------------------------------------------------------------
# AutoSpecs.org source - Next.js SSR site with __NEXT_DATA__ JSON blocks
# ---------------------------------------------------------------------------

AUTOSPECS_HOME = "https://www.autospecs.org"

# Skip SUVs, trucks, vans — only keep passenger cars
SUV_FILTER_WORDS = [
    "suv", "land cruiser", "4runner", "rav4", "highlander", "sequoia",
    "sienna", "alphard", "previa", "hilux", "fortuner", "prado",
    "cr-v", "hr-v", "pilot", "passport", "pathfinder", "armada",
    "murano", "rogue", "kicks", "tucson", "santa fe", "sorento",
    "sportage", "telluride", "palisade", "venue", "seltos", "trailblazer",
    "equinox", "traverse", "tahoe", "suburban", "expedition",
    "explorer", "bronco", "escalade", "yukon", "durango",
    "wrangler", "cherokee", "grand cherokee", "compass",
    " Range Rover", "discovery", "defender", "cayenne", "macan",
    "x5", "x7", "qx80", "rx", "gx", "lx", "nx", "tx",
    "outback", "forester", "ascend", "traverse", "blazer",
    "ecosport", "escape", "edge", "flex", "territory",
    "minivan", "van", "pickup", "truck", "ute",
    "crossover", "suv",
]


def _parse_weight(weight_str):
    """Extract kg from '2860 lbs (1297 kg)' or range '3197 - 3450 lbs (1450 - 1565 kg)'."""
    if not weight_str:
        return None
    m = re.search(r'\((\d+(?:\s*-\s*\d+)?)\s*kg\)', str(weight_str))
    if not m:
        m = re.search(r'(\d+(?:\s*-\s*\d+)?)\s*kg', str(weight_str))
    if not m:
        return None
    parts = m.group(1).split('-')
    nums = [float(p.strip()) for p in parts]
    return sum(nums) / len(nums) if nums else None


def _parse_mm(dim_str):
    """Extract mm from '183.1 in (4651 mm)' and return meters."""
    if not dim_str:
        return None
    m = re.search(r'\((\d+(?:\.\d+)?)\s*mm\)', str(dim_str))
    if not m:
        m = re.search(r'(\d+(?:\.\d+)?)\s*mm', str(dim_str))
    if not m:
        return None
    return round(float(m.group(1)) / 1000, 3)


def _parse_drive(drive_str):
    """Map drive type string to fwd/rwd/awd."""
    if not drive_str:
        return None
    low = drive_str.lower()
    if "front" in low:
        return "fwd"
    if "rear" in low:
        return "rwd"
    if "all" in low or "four" in low or "4" in low:
        return "awd"
    return None


def _parse_hp(trim_name):
    """Extract HP from trim name like '1.8L 6MT FWD (132 HP)'."""
    if not trim_name:
        return None
    m = re.search(r'\((\d+)\s*HP\)', str(trim_name), re.IGNORECASE)
    return int(m.group(1)) if m else None


def _parse_top_speed(speed_str):
    """Extract km/h from '130 mph (209 km/h)'."""
    if not speed_str:
        return None
    m = re.search(r'\((\d+)\s*km/h\)', str(speed_str))
    if not m:
        m = re.search(r'(\d+)\s*km/h', str(speed_str))
    return int(m.group(1)) if m else None


def _parse_year(gen_year_str):
    """Extract start year from generation year string like '2023 Toyota Corolla|...'."""
    if not gen_year_str:
        return None
    m = re.match(r'(\d{4})', str(gen_year_str))
    return int(m.group(1)) if m else None


def _parse_displacement(disp_str):
    """Extract displacement in liters from '1798 cm3'."""
    if not disp_str:
        return None
    m = re.search(r'(\d+)\s*cm3', str(disp_str))
    if m:
        return round(int(m.group(1)) / 1000, 3)
    # Try liters directly
    m = re.search(r'(\d+\.\d+)\s*[lL]', str(disp_str))
    return float(m.group(1)) if m else None


def _is_excluded(model_name):
    """Check if model name contains SUV/truck/van keywords."""
    if not model_name:
        return True
    low = model_name.lower()
    for word in SUV_FILTER_WORDS:
        if word in low:
            return True
    return False


def _fetch_next_data(url, timeout=20):
    """Fetch URL and extract __NEXT_DATA__ JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": "CarMetadataPipeline/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read().decode()
    except Exception as e:
        print(f"  [warn] Failed to fetch {url}: {e}")
        return None
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def autospecs_scrape(conn, args):
    """Scrape autospecs.org for car specs."""
    dry_run = getattr(args, 'dry_run', False)
    search = getattr(args, 'search', None)

    # 1. Get brand list
    home = _fetch_next_data(f"{AUTOSPECS_HOME}/")
    if not home:
        print("  [warn] Could not load autospecs.org homepage")
        return 0

    cars = home.get('props', {}).get('pageProps', {}).get('cars', [])
    if not cars:
        print("  [warn] No brands found on autospecs.org")
        return 0

    brands = [(c['name'], c['name'].lower()) for c in cars]
    print(f"  Found {len(brands)} brands")

    # Filter to search if specified
    if search:
        q = search.lower()
        brands = [(n, s) for n, s in brands if q in n.lower()]
        if not brands:
            print(f"  No brands matching '{search}'")
            return 0

    total_indexed = 0
    total_skipped = 0

    for brand_idx, (brand_name, slug) in enumerate(brands):
        brand_data = _fetch_next_data(f"{AUTOSPECS_HOME}/brand/{slug}")
        if not brand_data:
            time.sleep(1)
            continue

        models = brand_data.get('props', {}).get('pageProps', {}).get('models', [])
        brand_trims = 0

        for model_entry in models:
            model_name = model_entry.get('name', '')
            if _is_excluded(model_name):
                continue

            for gen in model_entry.get('generations', []):
                year = _parse_year(gen.get('year', ''))
                if not year or year < 1980:
                    continue

                for trim in gen.get('models', []):
                    trim_name = trim.get('name', '')
                    data = trim.get('data') or {}

                    weight_kg = _parse_weight(data.get('weight'))
                    if not weight_kg:
                        continue

                    # Build car dict
                    dims = data.get('dimensions') or {}
                    length_m = _parse_mm(dims.get('length'))
                    width_m = _parse_mm(dims.get('width'))
                    height_m = _parse_mm(dims.get('height'))
                    gc_m = _parse_mm(data.get('groundClearance'))

                    dimensions = {}
                    if length_m:
                        dimensions['length'] = length_m
                    if width_m:
                        dimensions['width'] = width_m
                    if height_m:
                        dimensions['height'] = height_m
                    if gc_m:
                        dimensions['ground_clearance'] = gc_m

                    engine = {}
                    disp = _parse_displacement(data.get('displacement'))
                    if disp:
                        engine['displacement_l'] = disp
                    hp = _parse_hp(trim_name)
                    if hp:
                        engine['power_hp'] = hp
                    fuel_sys = data.get('fuelSystem')
                    if fuel_sys:
                        engine['fuel_delivery'] = fuel_sys

                    perf = {}
                    top_speed = _parse_top_speed(data.get('topSpeed'))
                    if top_speed:
                        perf['top_speed_km_h'] = top_speed

                    tires = {}
                    tyre = data.get('tyreSize')
                    if tyre:
                        tires['front_size'] = tyre

                    car = {
                        'make': brand_name.title(),
                        'model': model_name,
                        'year': year,
                        'trim': trim_name,
                        'body_type': None,
                        'dimensions': dimensions,
                        'engine': engine,
                        'performance': perf,
                        'drivetrain': _parse_drive(data.get('driveType')),
                        'transmission': {},
                        'brakes': {},
                        'suspension': {},
                        'tires': tires,
                        'aero': {},
                        'weight_kg': weight_kg,
                        'weight_front_pct': None,
                        'fuel_type': None,
                        'price': {},
                        'confidence': 0.5,
                        'source': 'autospecs',
                    }

                    if dry_run:
                        brand_trims += 1
                    else:
                        result = upsert_car(conn, car)
                        if result in ('inserted', 'updated'):
                            brand_trims += 1

        total_indexed += brand_trims
        if brand_trims > 0:
            print(f"  Brand {brand_idx+1}/{len(brands)}: {brand_name} - {brand_trims} trims indexed")

        time.sleep(1)

    print(f"  AutoSpecs: {total_indexed} trims indexed across {len(brands)} brands")
    return total_indexed


# ---------------------------------------------------------------------------
# Reference source
# ---------------------------------------------------------------------------

def reference_source(search=None, dry_run=False):
    """Return hardcoded reference cars, optionally filtered."""
    cars = REFERENCE_CARS
    if search:
        q = search.lower()
        cars = [c for c in cars if q in f"{c['make']} {c['model']}".lower()]
    return cars


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

DEFAULT_DB = "racing-game/game/data/game_assets.db"


def init_db(db_path):
    """Create car_metadata table if it doesn't exist. Adds new columns if missing."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")

    # Base table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS car_metadata (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            make            TEXT,
            model           TEXT,
            year            INTEGER,
            trim            TEXT,
            body_type       TEXT,
            dimensions_json TEXT,
            engine_json     TEXT,
            performance_json TEXT,
            drivetrain      TEXT,
            transmission_json TEXT,
            brakes_json     TEXT,
            suspension_json TEXT,
            tires_json      TEXT,
            aero_json       TEXT,
            weight_kg       REAL,
            weight_front_pct REAL,
            fuel_type       TEXT,
            price_json      TEXT,
            eras            TEXT,
            tags            TEXT,
            source          TEXT NOT NULL DEFAULT 'auto',
            confidence      REAL DEFAULT 0.5,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Migrate: add any new columns to existing tables
    new_cols = [
        ("trim", "TEXT"),
        ("brakes_json", "TEXT"),
        ("suspension_json", "TEXT"),
        ("tires_json", "TEXT"),
        ("aero_json", "TEXT"),
        ("weight_front_pct", "REAL"),
        ("eras", "TEXT"),
        ("tags", "TEXT"),
    ]
    cursor = conn.cursor()
    for col_name, col_type in new_cols:
        try:
            cursor.execute(f"ALTER TABLE car_metadata ADD COLUMN {col_name} {col_type}")
        except sqlite3.OperationalError:
            pass  # column already exists

    conn.commit()
    return conn


def _merge_json(conn, car_id, col, new_data):
    """Merge new dict into existing JSON column."""
    row = conn.execute(f"SELECT {col} FROM car_metadata WHERE id=?", (car_id,)).fetchone()
    existing = json.loads(row[0]) if row and row[0] else {}
    merged = {**existing, **{k: v for k, v in new_data.items() if v is not None and v != {}}}
    return json.dumps(merged)


def upsert_car(conn, car, dry_run=False):
    """Insert or update a car record. Deduplicates by make+model+year."""
    now = datetime.now(timezone.utc).isoformat()
    tags_str = ",".join(car.get("tags", [])) if isinstance(car.get("tags"), list) else car.get("tags", "")

    existing = conn.execute(
        "SELECT id, source, confidence FROM car_metadata WHERE make=? AND model=? AND year=?",
        (car["make"], car["model"], car["year"])
    ).fetchone()

    if existing:
        eid, old_source, old_conf = existing
        if car.get("confidence", 0.5) > old_conf:
            new_dims = _merge_json(conn, eid, "dimensions_json", car.get("dimensions", {}))
            new_eng = _merge_json(conn, eid, "engine_json", car.get("engine", {}))
            new_perf = _merge_json(conn, eid, "performance_json", car.get("performance", {}))
            new_price = _merge_json(conn, eid, "price_json", car.get("price", {}))
            new_trans = _merge_json(conn, eid, "transmission_json", car.get("transmission", {}))
            new_brakes = _merge_json(conn, eid, "brakes_json", car.get("brakes", {}))
            new_susp = _merge_json(conn, eid, "suspension_json", car.get("suspension", {}))
            new_tires = _merge_json(conn, eid, "tires_json", car.get("tires", {}))
            new_aero = _merge_json(conn, eid, "aero_json", car.get("aero", {}))

            conn.execute("""
                UPDATE car_metadata SET
                    trim=COALESCE(NULLIF(?, ''), trim),
                    body_type=COALESCE(NULLIF(?, ''), body_type),
                    dimensions_json=?, engine_json=?, performance_json=?,
                    drivetrain=COALESCE(NULLIF(?, ''), drivetrain),
                    transmission_json=?, brakes_json=?, suspension_json=?,
                    tires_json=?, aero_json=?,
                    weight_kg=COALESCE(?, weight_kg),
                    weight_front_pct=COALESCE(?, weight_front_pct),
                    fuel_type=COALESCE(NULLIF(?, ''), fuel_type),
                    price_json=?,
                    eras=COALESCE(NULLIF(?, ''), eras),
                    tags=COALESCE(NULLIF(?, ''), tags),
                    source=?,
                    confidence=?,
                    updated_at=?
                WHERE id=?
            """, (
                car.get("trim"), car.get("body_type"),
                new_dims, new_eng, new_perf,
                car.get("drivetrain"), new_trans, new_brakes, new_susp,
                new_tires, new_aero,
                car.get("weight_kg"), car.get("weight_front_pct"),
                car.get("fuel_type"), new_price,
                car.get("eras"), tags_str,
                car.get("source", "auto"), car.get("confidence", 0.5),
                now, eid
            ))
            return "updated"
    else:
        if not dry_run:
            conn.execute("""
                INSERT INTO car_metadata
                    (make, model, year, trim, body_type, dimensions_json, engine_json,
                     performance_json, drivetrain, transmission_json, brakes_json,
                     suspension_json, tires_json, aero_json,
                     weight_kg, weight_front_pct, fuel_type, price_json,
                     eras, tags, source, confidence)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                car["make"], car["model"], car["year"],
                car.get("trim"), car.get("body_type"),
                json.dumps(car.get("dimensions", {})),
                json.dumps(car.get("engine", {})),
                json.dumps(car.get("performance", {})),
                car.get("drivetrain"),
                json.dumps(car.get("transmission", {})),
                json.dumps(car.get("brakes", {})),
                json.dumps(car.get("suspension", {})),
                json.dumps(car.get("tires", {})),
                json.dumps(car.get("aero", {})),
                car.get("weight_kg"), car.get("weight_front_pct"),
                car.get("fuel_type"),
                json.dumps(car.get("price", {})),
                car.get("eras"), tags_str,
                car.get("source", "auto"),
                car.get("confidence", 0.5),
            ))
        return "inserted"
    return "skipped"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SOURCES = {
    "nhtsa": nhtsa_source,
    "fueleconomy": fe_source,
    "reference": reference_source,
    "autospecs": autospecs_scrape,
}


def main():
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

        # autospecs handles its own DB writes
        if src_name == "autospecs":
            count = fetch_fn(conn, args)
            total_inserted += count
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
