"""MARGA GIS foundation: Mars CRS, georeferenced DEM reading (Rasterio), vector data (GeoPandas /
Shapely) and the raster products the map displays. The route engine (engine/marga_engine) is used
read-only as a library so displayed terrain and routed terrain come from the same grid."""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_ENGINE = REPO / "engine"
if str(_ENGINE) not in sys.path:
    sys.path.insert(0, str(_ENGINE))

from .crs import CrsError, classify_crs, mars_crs, mars_crs_definition  # noqa: E402
from .dem import Dem, DemValidationError, inspect_dem, read_dem  # noqa: E402

__all__ = [
    "REPO",
    "CrsError",
    "Dem",
    "DemValidationError",
    "classify_crs",
    "inspect_dem",
    "mars_crs",
    "mars_crs_definition",
    "read_dem",
]
