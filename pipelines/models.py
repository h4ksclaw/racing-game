"""Typed car record model for the metadata pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field, fields, asdict
from typing import Any, Optional


@dataclass
class _NestedBase:
    """Base for nested dataclasses with to_dict() and from_dict()."""
    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None and v != {}}

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> _NestedBase:
        if not d:
            return cls()
        valid = {f.name: d[f.name] for f in fields(cls) if f.name in d and d[f.name] is not None}
        return cls(**valid)


@dataclass
class Dimensions(_NestedBase):
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    wheelbase: Optional[float] = None
    track_width: Optional[float] = None
    ground_clearance: Optional[float] = None
    front_track_m: Optional[float] = None
    rear_track_m: Optional[float] = None
    front_overhang_m: Optional[float] = None
    rear_overhang_m: Optional[float] = None


@dataclass
class Engine(_NestedBase):
    displacement_l: Optional[float] = None
    cylinders: Optional[int] = None
    configuration: Optional[str] = None
    aspiration: Optional[str] = None
    power_hp: Optional[float] = None
    torque_nm: Optional[float] = None
    max_rpm: Optional[int] = None
    idle_rpm: Optional[int] = None
    compression_ratio: Optional[float] = None
    bore_mm: Optional[float] = None
    stroke_mm: Optional[float] = None
    valves_per_cylinder: Optional[int] = None
    fuel_delivery: Optional[str] = None
    boost_bar: Optional[float] = None


@dataclass
class Performance(_NestedBase):
    zero_to_100_kph: Optional[float] = None
    zero_to_60_mph: Optional[float] = None
    top_speed_km_h: Optional[int] = None
    quarter_mile_s: Optional[float] = None
    lateral_g: Optional[float] = None
    co2_grams_per_mile: Optional[float] = None


@dataclass
class Transmission(_NestedBase):
    gear_count: Optional[int] = None
    type: Optional[str] = None
    final_drive: Optional[float] = None


@dataclass
class Brakes(_NestedBase):
    front_type: Optional[str] = None
    rear_type: Optional[str] = None
    front_diameter_mm: Optional[int] = None
    abs: Optional[bool] = None


@dataclass
class Suspension(_NestedBase):
    front_type: Optional[str] = None
    rear_type: Optional[str] = None


@dataclass
class Tires(_NestedBase):
    front_size: Optional[str] = None
    rear_size: Optional[str] = None
    width_mm: Optional[int] = None
    aspect_ratio: Optional[int] = None
    wheel_diameter_in: Optional[int] = None
    front_width_mm: Optional[int] = None
    front_aspect_ratio: Optional[int] = None
    front_wheel_diameter_in: Optional[int] = None
    rear_width_mm: Optional[int] = None
    rear_aspect_ratio: Optional[int] = None
    rear_wheel_diameter_in: Optional[int] = None


@dataclass
class Aero(_NestedBase):
    drag_coefficient: Optional[float] = None
    downforce_kg: Optional[float] = None


@dataclass
class Price(_NestedBase):
    min_usd: Optional[float] = None
    max_usd: Optional[float] = None
    avg_usd: Optional[float] = None
    note: Optional[str] = None


# Map of nested field names to their classes
_NESTED_TYPES: dict[str, type[_NestedBase]] = {
    "dimensions": Dimensions,
    "engine": Engine,
    "performance": Performance,
    "transmission": Transmission,
    "brakes": Brakes,
    "suspension": Suspension,
    "tires": Tires,
    "aero": Aero,
    "price": Price,
}


@dataclass
class CarRecord:
    """Normalized car record from any data source."""
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    trim: Optional[str] = None
    body_type: Optional[str] = None
    drivetrain: Optional[str] = None
    weight_kg: Optional[float] = None
    weight_front_pct: Optional[float] = None
    fuel_type: Optional[str] = None
    source: Optional[str] = None
    confidence: Optional[float] = None
    eras: Optional[str] = None
    tags: Optional[list[str]] = None

    # Nested objects
    dimensions: Dimensions = field(default_factory=Dimensions)
    engine: Engine = field(default_factory=Engine)
    performance: Performance = field(default_factory=Performance)
    transmission: Transmission = field(default_factory=Transmission)
    brakes: Brakes = field(default_factory=Brakes)
    suspension: Suspension = field(default_factory=Suspension)
    tires: Tires = field(default_factory=Tires)
    aero: Aero = field(default_factory=Aero)
    price: Price = field(default_factory=Price)

    def to_dict(self) -> dict[str, Any]:
        """Convert to flat dict compatible with upsert_car()."""
        d: dict[str, Any] = {}
        for f in fields(self):
            if f.name in _NESTED_TYPES:
                obj = getattr(self, f.name)
                d[f.name] = obj.to_dict() if isinstance(obj, _NestedBase) else (obj or {})
            elif f.name == "tags" and isinstance(self.tags, list):
                d["tags"] = self.tags
            else:
                val = getattr(self, f.name)
                if val is not None:
                    d[f.name] = val
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CarRecord:
        """Construct from a loose dict (backward compat)."""
        kwargs: dict[str, Any] = {}
        for f in fields(cls):
            if f.name in _NESTED_TYPES:
                raw = d.get(f.name)
                if raw and isinstance(raw, dict):
                    kwargs[f.name] = _NESTED_TYPES[f.name].from_dict(raw)
            elif f.name == "tags":
                val = d.get("tags")
                if isinstance(val, str):
                    kwargs["tags"] = [t.strip() for t in val.split(",") if t.strip()]
                elif isinstance(val, list):
                    kwargs["tags"] = val
                elif val is not None:
                    kwargs["tags"] = val
            elif f.name in d and d[f.name] is not None:
                kwargs[f.name] = d[f.name]
        return cls(**kwargs)
