"""Tests for classifier.py"""

import pytest
from models import CarRecord
from classifier import classify_era, classify_performance_tier, classify_body_type, classify_car


class TestClassifyEra:
    def test_pre_80s(self):
        assert classify_era(1970) == "pre_80s"
        assert classify_era(1979) == "pre_80s"
        assert classify_era(0) == "pre_80s"
        assert classify_era(-5) == "pre_80s"

    def test_80s(self):
        assert classify_era(1980) == "80s"
        assert classify_era(1985) == "80s"
        assert classify_era(1989) == "80s"

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
        assert classify_era(2100) == "2020s"

    def test_none(self):
        assert classify_era(None) == ""

    def test_invalid(self):
        assert classify_era("abc") == ""
        assert classify_era("") == ""


class TestClassifyPerformanceTier:
    def _make_car(self, hp, weight):
        return {"weight_kg": weight, "engine": {"power_hp": hp}}

    def test_economy(self):
        assert classify_performance_tier(self._make_car(50, 1500)) == "economy"  # 33 hp/t

    def test_daily(self):
        assert classify_performance_tier(self._make_car(100, 1200)) == "daily"  # 83 hp/t

    def test_sport(self):
        assert classify_performance_tier(self._make_car(200, 1500)) == "sport"  # 133 hp/t

    def test_performance(self):
        assert classify_performance_tier(self._make_car(300, 1500)) == "performance"  # 200 hp/t

    def test_supercar(self):
        assert classify_performance_tier(self._make_car(500, 1500)) == "supercar"  # 333 hp/t

    def test_hypercar(self):
        assert classify_performance_tier(self._make_car(1500, 1500)) == "hypercar"  # 1000 hp/t

    def test_boundary_60(self):
        # 60 hp/tonne exactly -> daily (>=60)
        assert classify_performance_tier(self._make_car(60, 1000)) == "daily"

    def test_boundary_100(self):
        assert classify_performance_tier(self._make_car(100, 1000)) == "sport"

    def test_boundary_150(self):
        assert classify_performance_tier(self._make_car(150, 1000)) == "performance"

    def test_boundary_250(self):
        assert classify_performance_tier(self._make_car(250, 1000)) == "supercar"

    def test_boundary_400(self):
        assert classify_performance_tier(self._make_car(400, 1000)) == "hypercar"

    def test_missing_weight(self):
        assert classify_performance_tier({"engine": {"power_hp": 200}}) == "unknown"

    def test_missing_hp(self):
        assert classify_performance_tier({"weight_kg": 1500}) == "unknown"

    def test_missing_engine(self):
        assert classify_performance_tier({"weight_kg": 1500}) == "unknown"

    def test_carrecord(self):
        car = CarRecord(weight_kg=1500, engine={"power_hp": 300})
        assert classify_performance_tier(car) == "performance"


class TestClassifyBodyType:
    def test_direct_recognized(self):
        assert classify_body_type({"body_type": "coupe"}) == "coupe"
        assert classify_body_type({"body_type": "sedan"}) == "sedan"

    def test_aliases(self):
        assert classify_body_type({"body_type": "saloon"}) == "sedan"
        assert classify_body_type({"body_type": "cabriolet"}) == "roadster"
        assert classify_body_type({"body_type": "convertible"}) == "roadster"
        assert classify_body_type({"body_type": "estate"}) == "wagon"
        assert classify_body_type({"body_type": "touring"}) == "wagon"
        assert classify_body_type({"body_type": "liftback"}) == "hatchback"
        assert classify_body_type({"body_type": "crossover"}) == "suv"
        assert classify_body_type({"body_type": "pickup"}) == "truck"
        assert classify_body_type({"body_type": "minivan"}) == "van"

    def test_case_insensitive(self):
        assert classify_body_type({"body_type": "COUPE"}) == "coupe"
        assert classify_body_type({"body_type": "Sedan"}) == "sedan"

    def test_infer_from_trim(self):
        assert classify_body_type({"trim": "3.0 Coupe"}) == "coupe"
        assert classify_body_type({"trim": "Cabriolet 2.0T"}) == "roadster"
        assert classify_body_type({"trim": "Hatchback SE"}) == "hatchback"
        assert classify_body_type({"trim": "Estate TDI"}) == "wagon"
        assert classify_body_type({"trim": "SUV Premium"}) == "suv"

    def test_no_body_no_trim(self):
        assert classify_body_type({}) == ""

    def test_carrecord(self):
        car = CarRecord(body_type="coupe")
        assert classify_body_type(car) == "coupe"


class TestClassifyCar:
    def test_returns_expected_keys(self):
        car = {
            "year": 2020,
            "weight_kg": 1500,
            "engine": {"power_hp": 300},
            "body_type": "sedan",
        }
        result = classify_car(car)
        assert "era" in result
        assert "performance_tier" in result
        assert result["era"] == "2020s"
        assert result["performance_tier"] == "performance"
        # body_type already recognized, should not be in result

    def test_body_type_in_result_when_inferred(self):
        car = {"year": 2020, "trim": "Coupe"}
        result = classify_car(car)
        assert result["era"] == "2020s"
        assert result["body_type"] == "coupe"

    def test_with_carrecord(self):
        car = CarRecord(year=1995, weight_kg=1200, engine={"power_hp": 200})
        result = classify_car(car)
        assert result["era"] == "90s"
        assert result["performance_tier"] == "performance"
