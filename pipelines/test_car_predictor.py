#!/usr/bin/env python3
"""Tests for car_predictor module."""

import json
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from car_predictor import (
    classify_era, predict_specs, _get_profile, _predict_gear_ratios, PROFILES,
)


# ---------------------------------------------------------------------------
# Era classification
# ---------------------------------------------------------------------------

class TestClassifyEra:
    def test_80s(self):
        assert classify_era(1989) == "80s"
        assert classify_era(1980) == "80s"
        assert classify_era(1970) == "80s"

    def test_90s(self):
        assert classify_era(1990) == "90s"
        assert classify_era(1999) == "90s"

    def test_2000s(self):
        assert classify_era(2000) == "2000s"
        assert classify_era(2009) == "2000s"

    def test_2010s(self):
        assert classify_era(2010) == "2010s"
        assert classify_era(2019) == "2010s"

    def test_2020s(self):
        assert classify_era(2020) == "2020s"
        assert classify_era(2025) == "2020s"

    def test_invalid(self):
        assert classify_era(None) == "2000s"
        assert classify_era("abc") == "2000s"


# ---------------------------------------------------------------------------
# Profile lookup
# ---------------------------------------------------------------------------

class TestProfileLookup:
    def test_exact_match(self):
        p = _get_profile("sedan", "80s", "fwd")
        assert p["cd"] == 0.34
        assert p["wheelbase_m"] == 2.50

    def test_era_fallback(self):
        # hatchback + 90s + rwd: no exact match, should find hatchback 90s fwd or similar
        p = _get_profile("hatchback", "90s", "rwd")
        assert "cd" in p
        # Falls back to hatchback|90s|fwd
        assert p["suspension_front"] == "strut"
        assert p["cd"] == 0.33

    def test_body_fallback(self):
        # convertible + 90s + awd: no exact match, falls back to convertible|90s|fwd
        p = _get_profile("convertible", "90s", "awd")
        assert p["cd"] == 0.35
        assert p["suspension_front"] == "strut"

    def test_exact_profile_match(self):
        # wagon + 2010s + awd now has an exact profile
        p = _get_profile("wagon", "2010s", "awd")
        assert p["cd"] == 0.30
        assert p["wheelbase_m"] == 2.72
        assert p["weight_front_pct"] == 57

    def test_convertible_profile(self):
        # convertible + 2000s + rwd now has an exact profile
        p = _get_profile("convertible", "2000s", "rwd")
        assert p["cd"] == 0.32
        assert p["wheelbase_m"] == 2.55

    def test_default_fallback(self):
        p = _get_profile(None, None, None)
        assert p["cd"] == 0.32


# ---------------------------------------------------------------------------
# Cd prediction
# ---------------------------------------------------------------------------

class TestCdPrediction:
    def test_base_cd(self):
        car = {"year": 2020, "body_type": "sedan", "drivetrain": "fwd"}
        result = predict_specs(car)
        assert "cd" in result
        assert result["cd_predicted"] is True
        assert result["cd"] == 0.26

    def test_cd_length_adjustment_long(self):
        car = {
            "year": 2020, "body_type": "sedan", "drivetrain": "fwd",
            "dimensions_json": {"length": 4.8},
        }
        result = predict_specs(car)
        # 4.8m > 4.5m → cd = 0.26 - 0.002 * 3 = 0.254
        assert result["cd"] < 0.26

    def test_cd_length_adjustment_short(self):
        car = {
            "year": 2020, "body_type": "sedan", "drivetrain": "fwd",
            "dimensions_json": {"length": 3.8},
        }
        result = predict_specs(car)
        # 3.8m < 4.0m → cd = 0.26 + 0.002 * 2 = 0.264
        assert result["cd"] > 0.26

    def test_cd_not_overwritten(self):
        car = {
            "year": 2020, "body_type": "sedan", "drivetrain": "fwd",
            "aero_json": {"drag_coefficient": 0.22},
        }
        result = predict_specs(car)
        assert "cd" not in result


# ---------------------------------------------------------------------------
# Wheelbase prediction
# ---------------------------------------------------------------------------

class TestWheelbasePrediction:
    def test_profile_wheelbase(self):
        car = {"year": 1990, "body_type": "roadster", "drivetrain": "rwd"}
        result = predict_specs(car)
        assert result["wheelbase_m"] == 2.27
        assert result["wheelbase_m_predicted"] is True

    def test_wheelbase_from_length(self):
        car = {
            "year": 1990, "body_type": "roadster", "drivetrain": "rwd",
            "dimensions_json": {"length": 4.5},
        }
        result = predict_specs(car)
        # 4.5 * 0.57 = 2.565
        assert abs(result["wheelbase_m"] - 2.565) < 0.01

    def test_wheelbase_not_overwritten(self):
        car = {
            "year": 1990, "body_type": "roadster", "drivetrain": "rwd",
            "dimensions_json": {"wheelbase": 2.30},
        }
        result = predict_specs(car)
        assert "wheelbase_m" not in result


# ---------------------------------------------------------------------------
# Weight distribution
# ---------------------------------------------------------------------------

class TestWeightDistribution:
    def test_profile_base(self):
        car = {"year": 2020, "body_type": "sedan", "drivetrain": "rwd"}
        result = predict_specs(car)
        assert "weight_front_pct" in result
        assert result["weight_front_pct_predicted"] is True

    def test_fwd_adjustment(self):
        car = {"year": 2020, "body_type": "sedan", "drivetrain": "fwd"}
        result = predict_specs(car)
        # sedan 2020s fwd profile: 60, +3 for fwd = 63
        assert result["weight_front_pct"] == 63

    def test_awd_adjustment(self):
        car = {"year": 2005, "body_type": "sedan", "drivetrain": "awd"}
        result = predict_specs(car)
        # sedan 2000s awd profile: 58, +1 for awd = 59
        assert result["weight_front_pct"] == 59

    def test_not_overwritten(self):
        car = {"year": 2020, "body_type": "sedan", "drivetrain": "fwd", "weight_front_pct": 55}
        result = predict_specs(car)
        assert "weight_front_pct" not in result


# ---------------------------------------------------------------------------
# Gear ratios
# ---------------------------------------------------------------------------

class TestGearRatios:
    def test_80s_na(self):
        gears = _predict_gear_ratios({"displacement_l": 1.6}, "80s")
        assert gears == GEAR_SETS["80s_90s_na"]
        assert len(gears["ratios"]) == 5

    def test_2000s_turbo(self):
        gears = _predict_gear_ratios(
            {"displacement_l": 2.0, "aspiration": "turbo"}, "2000s"
        )
        assert gears == GEAR_SETS["2000s_turbo"]
        assert len(gears["ratios"]) == 6

    def test_2010s_na(self):
        gears = _predict_gear_ratios({"displacement_l": 2.0}, "2010s")
        assert gears == GEAR_SETS["2010s+_na"]

    def test_json_string_input(self):
        gears = _predict_gear_ratios(
            json.dumps({"displacement_l": 1.8}), "90s"
        )
        assert gears is not None


# ---------------------------------------------------------------------------
# predict_specs integration
# ---------------------------------------------------------------------------

class TestPredictSpecsIntegration:
    def test_only_fills_missing(self):
        car = {
            "year": 2020, "body_type": "sedan", "drivetrain": "fwd",
            "aero_json": {"drag_coefficient": 0.25},
            "dimensions_json": {"wheelbase": 2.80},
            "weight_front_pct": 58,
            "suspension_json": {"front_type": "strut", "rear_type": "multilink"},
        }
        result = predict_specs(car)
        # Everything provided — should only predict gear ratios
        assert "cd" not in result
        assert "wheelbase_m" not in result
        assert "weight_front_pct" not in result
        assert "suspension_front" not in result
        assert "suspension_rear" not in result
        assert "gear_ratios" in result

    def test_all_predicted_flags(self):
        car = {"year": 1990, "body_type": "coupe", "drivetrain": "rwd"}
        result = predict_specs(car)
        # Check all predicted fields have _predicted flags
        for key in result:
            if not key.endswith("_predicted"):
                assert f"{key}_predicted" in result, f"Missing _predicted flag for {key}"

    def test_empty_car(self):
        result = predict_specs({})
        # Should still predict something from default profile
        assert len(result) > 0

    def test_none_car(self):
        result = predict_specs(None)
        assert result == {}

    def test_dimensions_as_json_string(self):
        car = {
            "year": 2020, "body_type": "sedan", "drivetrain": "fwd",
            "dimensions_json": json.dumps({"length": 4.8}),
        }
        result = predict_specs(car)
        assert "cd" in result
        assert "wheelbase_m" in result
        assert result["wheelbase_m_predicted"] is True


# Need GEAR_SETS reference in test scope
GEAR_SETS = None

# Import after class definition
from car_predictor import GEAR_SETS as _GEAR_SETS
GEAR_SETS = _GEAR_SETS
