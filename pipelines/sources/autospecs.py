"""AutoSpecs.org source - Next.js SSR site with __NEXT_DATA__ JSON blocks."""

import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from models import CarRecord
from base import CarSource

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


def _parse_transmission(trim_name):
    """Extract transmission details from trim name like '1.8L 6MT FWD' or '2.0T 7AT AWD'.
    Returns dict with type and gear_count."""
    if not trim_name:
        return {}
    result = {}
    low = trim_name.upper()
    # Match patterns like "6MT", "7AT", "8DCT", "CVT"
    m = re.search(r'(\d+)\s*(MT|AT|DCT|CVT|AMT)', low)
    if m:
        result['gear_count'] = int(m.group(1))
        t = m.group(2)
        if t == 'MT':
            result['type'] = 'manual'
        elif t == 'CVT':
            result['type'] = 'cvt'
        elif t == 'DCT':
            result['type'] = 'dual_clutch'
        else:
            result['type'] = 'automatic'
    return result


def _infer_body_type(model_name, trim_name=None):
    """Infer body type from model/trim name patterns.
    Returns one of: sedan, coupe, hatchback, convertible, roadster, wagon, or None."""
    if not model_name:
        return None
    combined = (model_name + ' ' + (trim_name or '')).lower()
    
    # Convertibles / roadsters
    if any(w in combined for w in ['convertible', 'cabriolet', 'cabrio', 'spyder', 'spider', 'roadster']):
        return 'convertible'
    # Coupes
    if any(w in combined for w in ['coupe', 'gt3', 'gt4', 'amg gt', 'supra', 'mx-5', 'miata', 'brz', '86', 'gr86']):
        return 'coupe'
    # Wagons
    if any(w in combined for w in ['wagon', 'estate', 'touring', 'avant', 'crossover', 'shooting brake']):
        return 'wagon'
    # Hatchbacks
    if any(w in combined for w in ['hatch', '3 door', '5 door', '3dr', '5dr']):
        return 'hatchback'
    # Sedans (default for passenger cars)
    if any(w in combined for w in ['sedan', 'saloon', '4 door', '4dr']):
        return 'sedan'
    
    # Heuristic: short models with no body clue → coupe if sporty, else sedan
    if _is_excluded(model_name):
        return None
    
    # Default to sedan for anything that passed the SUV filter
    return 'sedan'


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


def retry_fetch(url, max_retries=3, backoff=2.0):
    """Fetch URL with exponential backoff retries. Returns None after all retries exhausted."""
    for attempt in range(max_retries):
        result = _fetch_next_data(url)
        if result is not None:
            return result
        if attempt < max_retries - 1:
            wait = backoff * (2 ** attempt)
            print(f"  [retry] Waiting {wait:.1f}s before retry {attempt+2}/{max_retries} for {url}")
            time.sleep(wait)
    return None


class AutoSpecsSource(CarSource):
    priority = 70

    @property
    def name(self):
        return "autospecs"

    def fetch(self, conn=None, search=None, dry_run=False, **kwargs):
        records = autospecs_extract(search=search)
        return [CarRecord.from_dict(c) for c in records]


def autospecs_extract(search=None):
    """Extract car records from autospecs.org without writing to DB. Returns list of dicts."""
    home = _fetch_next_data(f"{AUTOSPECS_HOME}/")
    if not home:
        return []

    cars_data = home.get('props', {}).get('pageProps', {}).get('cars', [])
    if not cars_data:
        return []

    brands = [(c['name'], c['name'].lower()) for c in cars_data]
    if search:
        q = search.lower()
        brands = [(n, s) for n, s in brands if q in n.lower()]
        if not brands:
            return []

    all_cars = []
    print(f"  Fetching {len(brands)} brand pages (4 parallel workers)...")
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_brand = {
            executor.submit(retry_fetch, f"{AUTOSPECS_HOME}/brand/{slug}"): (idx, name, slug)
            for idx, (name, slug) in enumerate(brands)
        }
        batch_count = 0
        for future in as_completed(future_to_brand):
            brand_idx, brand_name, slug = future_to_brand[future]
            brand_data = future.result()
            batch_count += 1
            if not brand_data:
                continue
            cars, brand_trims = _process_brand_data(brand_name, brand_data)
            all_cars.extend(cars)
            if brand_trims > 0:
                print(f"  Brand {brand_idx+1}/{len(brands)}: {brand_name} - {brand_trims} trims extracted")
            if batch_count % 4 == 0:
                time.sleep(1)

    print(f"  AutoSpecs: {len(all_cars)} trims extracted across {len(brands)} brands")
    return all_cars


def autospecs_scrape(conn, args):
    """Scrape autospecs.org for car specs."""
    from db import upsert_car

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

    def _process_brand_data(brand_name, brand_data):
        """Process a brand's data and return list of car dicts + trim count."""
        models = brand_data.get('props', {}).get('pageProps', {}).get('models', [])
        cars = []
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

                    clean_model = model_name
                    prefix = brand_name.upper()
                    if clean_model.upper().startswith(prefix):
                        clean_model = clean_model[len(prefix):].strip()
                    if not clean_model:
                        clean_model = model_name

                    car = {
                        'make': brand_name.title(),
                        'model': clean_model,
                        'year': year,
                        'trim': trim_name,
                        'body_type': _infer_body_type(model_name, trim_name),
                        'dimensions': dimensions,
                        'engine': engine,
                        'performance': perf,
                        'drivetrain': _parse_drive(data.get('driveType')),
                        'transmission': _parse_transmission(trim_name),
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
                    cars.append(car)
                    brand_trims += 1

        return cars, brand_trims

    total_indexed = 0
    total_skipped = 0

    # Fetch all brand pages in parallel (batches of 4)
    print(f"  Fetching {len(brands)} brand pages (4 parallel workers)...")
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_brand = {
            executor.submit(retry_fetch, f"{AUTOSPECS_HOME}/brand/{slug}"): (idx, name, slug)
            for idx, (name, slug) in enumerate(brands)
        }
        batch_count = 0
        for future in as_completed(future_to_brand):
            brand_idx, brand_name, slug = future_to_brand[future]
            brand_data = future.result()
            batch_count += 1

            if not brand_data:
                continue

            cars, brand_trims = _process_brand_data(brand_name, brand_data)

            if not dry_run:
                for car in cars:
                    upsert_car(conn, car, dedup_trim=True)

            total_indexed += brand_trims
            if brand_trims > 0:
                print(f"  Brand {brand_idx+1}/{len(brands)}: {brand_name} - {brand_trims} trims indexed")

            if not dry_run:
                conn.commit()

            # Polite sleep every 4 brands (one batch)
            if batch_count % 4 == 0:
                time.sleep(1)

    print(f"  AutoSpecs: {total_indexed} trims indexed across {len(brands)} brands")
    return total_indexed
