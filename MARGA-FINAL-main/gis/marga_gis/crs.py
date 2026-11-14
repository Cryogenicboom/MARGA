"""MARGA's Mars coordinate reference system.

The definition lives in shared/gis/mars_crs.json (generated from the PROJ database entry
IAU_2015:49900, "Mars (2015) - Sphere / Ocentric"); TypeScript reads the same file. Coordinates in
MARGA are [longitude, latitude] degrees: planetocentric latitude, east-positive longitude, on the
Mars reference sphere of radius 3,396,190 m.

Rules this module enforces:
  - Earth CRSs (e.g. WGS 84 / EPSG:4326) are never accepted for Mars data.
  - A CRS is recognised from its ellipsoid and kind, not from its name.
  - No coordinate transformation is invented: a dataset whose declared CRS differs from MARGA's
    is either rejected or re-labelled only with explicit, recorded evidence (see dem.read_dem).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pyproj import CRS

CRS_FILE = Path(__file__).resolve().parents[2] / "shared" / "gis" / "mars_crs.json"

CrsKind = Literal["mars_sphere_geographic", "mars_ellipsoid_geographic", "mars_projected", "earth", "unknown"]

_MARS_A = (3_390_000.0, 3_400_000.0)   # equatorial radius window for Mars reference bodies
_EARTH_A = (6_370_000.0, 6_380_000.0)  # Earth ellipsoids and spheres (WGS 84 6,378,137 m; sphere 6,371,008.8 m)


class CrsError(ValueError):
    """A coordinate reference system that MARGA cannot use as given."""


@lru_cache(maxsize=1)
def mars_crs_definition() -> dict[str, Any]:
    return json.loads(CRS_FILE.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def mars_crs() -> CRS:
    """MARGA's CRS as a pyproj CRS, checked against the shared definition."""
    d = mars_crs_definition()
    crs = CRS.from_user_input(d["code"])
    e = crs.ellipsoid
    if not (crs.is_geographic and e.semi_major_metre == d["radius_m"] == e.semi_minor_metre):
        raise CrsError(f"{d['code']} from PROJ does not match shared/gis/mars_crs.json")
    return crs


def mars_radius_m() -> float:
    return float(mars_crs_definition()["radius_m"])


def classify_crs(crs: CRS | Any) -> CrsKind:
    """What body and kind of CRS this is, from its ellipsoid (names are not trusted)."""
    crs = crs if isinstance(crs, CRS) else CRS.from_user_input(crs)
    e = crs.ellipsoid
    if e is None:
        return "unknown"
    a, b = e.semi_major_metre, e.semi_minor_metre
    if _EARTH_A[0] <= a <= _EARTH_A[1]:
        return "earth"
    if _MARS_A[0] <= a <= _MARS_A[1]:
        if crs.is_projected:
            return "mars_projected"
        if not crs.is_geographic:
            return "unknown"
        if a == b == mars_radius_m() and _prime_meridian_is_zero(crs):
            return "mars_sphere_geographic"
        return "mars_ellipsoid_geographic"
    return "unknown"


def is_marga_crs(crs: CRS | Any) -> bool:
    """True if the CRS is MARGA's (geographic, Mars reference sphere, reference meridian at 0)."""
    return classify_crs(crs) == "mars_sphere_geographic"


def describe_crs(crs: CRS | Any) -> str:
    crs = crs if isinstance(crs, CRS) else CRS.from_user_input(crs)
    e = crs.ellipsoid
    shape = f"a={e.semi_major_metre:.0f} m, b={e.semi_minor_metre:.0f} m" if e else "no ellipsoid"
    return f"{crs.name} ({shape}, {'geographic' if crs.is_geographic else 'projected' if crs.is_projected else 'other'})"


def _prime_meridian_is_zero(crs: CRS) -> bool:
    pm = crs.prime_meridian
    return pm is None or abs(pm.longitude) < 1e-12
