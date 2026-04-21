"""Source abstraction layer for the car metadata pipeline."""

from __future__ import annotations

import importlib
import pkgutil
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from models import CarRecord


class CarSource(ABC):
    """Abstract base class for car data sources."""

    priority: int = 0

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique source name."""
        ...

    @abstractmethod
    def fetch(
        self,
        conn=None,
        search: Optional[str] = None,
        dry_run: bool = False,
        **kwargs,
    ) -> list[CarRecord]:
        """Fetch car records from this source."""
        ...


class SourceRegistry:
    """Auto-discovers and manages CarSource subclasses."""

    def __init__(self):
        self._sources: dict[str, CarSource] = {}

    def register(self, source: CarSource) -> None:
        self._sources[source.name] = source

    def list_sources(self) -> list[CarSource]:
        return sorted(self._sources.values(), key=lambda s: s.priority, reverse=True)

    def get_source(self, name: str) -> Optional[CarSource]:
        return self._sources.get(name)

    def run_source(self, name: str, **kwargs) -> list[CarRecord]:
        source = self.get_source(name)
        if source is None:
            raise KeyError(f"Unknown source: {name}")
        return source.fetch(**kwargs)

    def discover(self, package_name: str) -> None:
        """Import all modules in a package and register any CarSource subclasses found."""
        package = importlib.import_module(package_name)
        if not hasattr(package, "__path__"):
            return
        for importer, modname, ispkg in pkgutil.iter_modules(package.__path__, package.__name__ + "."):
            try:
                mod = importlib.import_module(modname)
                for attr_name in dir(mod):
                    attr = getattr(mod, attr_name)
                    if (isinstance(attr, type)
                            and issubclass(attr, CarSource)
                            and attr is not CarSource
                            and not attr.__abstractmethods__):
                        instance = attr()
                        self.register(instance)
            except Exception:
                pass


# Global registry instance
registry = SourceRegistry()
