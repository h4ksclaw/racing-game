#!/usr/bin/env python3
"""Tests for bulk_indexer.py — uses temp DB, never touches real data."""

import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from car_metadata_pipeline import init_db, upsert_car
import bulk_indexer


class TestTransmissionParsing(unittest.TestCase):
    def test_automatic(self):
        r = bulk_indexer.parse_transmission("Automatic (AV-S10)")
        self.assertEqual(r["type"], "automatic")
        self.assertEqual(r["gear_count"], 10)

    def test_manual(self):
        r = bulk_indexer.parse_transmission("Manual (M6)")
        self.assertEqual(r["type"], "manual")
        self.assertEqual(r["gear_count"], 6)

    def test_cvt(self):
        r = bulk_indexer.parse_transmission("AV (AV-CVT)")
        self.assertEqual(r["type"], "cvt")

    def test_empty(self):
        self.assertEqual(bulk_indexer.parse_transmission(""), {})

    def test_none(self):
        self.assertEqual(bulk_indexer.parse_transmission(None), {})


class TestDriveMapping(unittest.TestCase):
    def test_fwd(self):
        self.assertEqual(bulk_indexer.DRIVE_MAP.get("Front-Wheel Drive"), "fwd")

    def test_rwd(self):
        self.assertEqual(bulk_indexer.DRIVE_MAP.get("Rear-Wheel Drive"), "rwd")

    def test_awd_variants(self):
        self.assertEqual(bulk_indexer.DRIVE_MAP.get("All-Wheel Drive"), "awd")
        self.assertEqual(bulk_indexer.DRIVE_MAP.get("4-Wheel Drive"), "awd")
        self.assertEqual(bulk_indexer.DRIVE_MAP.get("Part-time 4-Wheel Drive"), "awd")


class TestVClassMapping(unittest.TestCase):
    def test_passenger_kept(self):
        self.assertEqual(bulk_indexer.VCLASS_MAP.get("Compact Cars"), "sedan")
        self.assertEqual(bulk_indexer.VCLASS_MAP.get("Two Seaters"), "coupe")
        self.assertEqual(bulk_indexer.VCLASS_MAP.get("Subcompact Cars"), "hatchback")
        self.assertEqual(bulk_indexer.VCLASS_MAP.get("Midsize Station Wagons"), "wagon")

    def test_excluded(self):
        self.assertIsNone(bulk_indexer.VCLASS_MAP.get("Sport Utility Vehicles"))
        self.assertIsNone(bulk_indexer.VCLASS_MAP.get("Pickup Trucks"))
        self.assertIsNone(bulk_indexer.VCLASS_MAP.get("Minivan"))


class TestDedup(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        self.conn = init_db(self.db_path)

    def tearDown(self):
        self.conn.close()
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_insert_then_upsert_no_duplicate(self):
        car = {
            "make": "Toyota", "model": "Corolla", "year": 2020,
            "body_type": "sedan", "dimensions": {}, "engine": {"displacement_l": 2.0},
            "performance": {}, "drivetrain": "fwd", "transmission": {},
            "weight_kg": 1300, "fuel_type": "gasoline", "price": {},
            "confidence": 0.3, "source": "fueleconomy",
        }
        r1 = upsert_car(self.conn, car)
        self.conn.commit()
        r2 = upsert_car(self.conn, car)
        self.conn.commit()
        self.assertEqual(r1, "inserted")
        self.assertEqual(r2, "skipped")

        count = self.conn.execute("SELECT COUNT(*) FROM car_metadata WHERE make='Toyota' AND model='Corolla' AND year=2020").fetchone()[0]
        self.assertEqual(count, 1)

    def test_high_confidence_not_overwritten(self):
        car_ref = {
            "make": "Toyota", "model": "AE86", "year": 1986,
            "body_type": "coupe", "dimensions": {"length": 4.26},
            "engine": {"displacement_l": 1.6, "cylinders": 4},
            "performance": {}, "drivetrain": "rwd", "transmission": {"gear_count": 5},
            "weight_kg": 940, "fuel_type": "gasoline", "price": {},
            "confidence": 0.9, "source": "reference",
        }
        upsert_car(self.conn, car_ref)
        self.conn.commit()

        car_fe = {
            "make": "Toyota", "model": "AE86", "year": 1986,
            "body_type": "sedan", "dimensions": {}, "engine": {"displacement_l": 1.6},
            "performance": {}, "drivetrain": "fwd", "transmission": {},
            "weight_kg": None, "fuel_type": "gasoline", "price": {},
            "confidence": 0.3, "source": "fueleconomy",
        }
        result = upsert_car(self.conn, car_fe)
        self.conn.commit()
        self.assertEqual(result, "skipped")

        # Verify original data preserved
        row = self.conn.execute("SELECT body_type, drivetrain, confidence FROM car_metadata WHERE make='Toyota' AND model='AE86'").fetchone()
        self.assertEqual(row[0], "coupe")
        self.assertEqual(row[1], "rwd")
        self.assertAlmostEqual(row[2], 0.9)


class TestFEVehicleParsing(unittest.TestCase):
    """Test _parse_fe_vehicle_bulk with mock XML data."""

    def test_basic_parsing(self):
        xml_str = """<?xml version="1.0"?>
        <vehicle>
            <year>2024</year>
            <make>Honda</make>
            <model>Civic</model>
            <VClass>Compact Cars</VClass>
            <drive>Front-Wheel Drive</drive>
            <trany>Automatic (CVT)</trany>
            <cylinders>4</cylinders>
            <displ>2.0</displ>
            <fuelType1>Gasoline</fuelType1>
            <city08>33</city08>
            <highway08>42</highway08>
            <comb08>36</comb08>
            <co2>238</co2>
        </vehicle>"""
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_str)
        car = bulk_indexer.parse_fe_spec(root, "Honda", "Civic", 2024)

        self.assertEqual(car["make"], "Honda")
        self.assertEqual(car["model"], "Civic")
        self.assertEqual(car["year"], 2024)
        self.assertEqual(car["body_type"], "sedan")
        self.assertEqual(car["drivetrain"], "fwd")
        self.assertEqual(car["transmission"]["type"], "automatic")
        self.assertEqual(car["engine"]["cylinders"], 4)
        self.assertEqual(car["engine"]["displacement_l"], 2.0)
        self.assertEqual(car["fuel_type"], "Gasoline")
        self.assertEqual(car["performance"]["city_mpg"], 33)
        self.assertEqual(car["performance"]["combined_mpg"], 36)
        self.assertEqual(car["confidence"], 0.3)
        self.assertEqual(car["source"], "fueleconomy")

    def test_excluded_vclass(self):
        xml_str = """<?xml version="1.0"?>
        <vehicle>
            <year>2024</year><make>Ford</make><model>F-150</model>
            <VClass>Standard Pickup Trucks</VClass>
            <drive>4-Wheel Drive</drive><trany>Automatic (AV-S10)</trany>
        </vehicle>"""
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_str)
        car = bulk_indexer.parse_fe_spec(root, "Ford", "F-150", 2024)
        self.assertIsNone(car)  # Should be excluded


class TestWikidataSPARQL(unittest.TestCase):
    """Test that Wikidata SPARQL returns data for known cars."""

    def test_wikidata_car_query(self):
        import urllib.request, urllib.parse
        # Test with a well-known car that should exist in Wikidata
        query = """
        SELECT ?item ?itemLabel ?weight ?length WHERE {
            { { ?item wdt:P31/wdt:P279* wd:Q4310 . } UNION { ?item wdt:P31/wdt:P279* wd:Q59773381 . } UNION { ?item wdt:P31/wdt:P279* wd:Q3231690 . } }
            ?item rdfs:label ?itemLabel .
            FILTER(CONTAINS(LCASE(STR(?itemLabel)), "civic"))
            FILTER(CONTAINS(LCASE(STR(?itemLabel)), "honda"))
            OPTIONAL { ?item wdt:P2067 ?weight . }
            OPTIONAL { ?item wdt:P2043 ?length . }
        }
        LIMIT 5
        """
        encoded = urllib.parse.urlencode({"query": query, "format": "json"})
        url = f"{bulk_indexer.WIKIDATA_SPARQL}?{encoded}"
        req = urllib.request.Request(url, headers={
            "User-Agent": "CarMetadataPipeline/1.0",
            "Accept": "application/sparql-results+json",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        bindings = data.get("results", {}).get("bindings", [])
        self.assertGreater(len(bindings), 0, "Wikidata should return results for Honda Civic")


if __name__ == "__main__":
    unittest.main()
