"""Planetary geometry on the Mars reference sphere.

Conventions (shared with shared/types/index.ts):
  * latitude  - planetocentric degrees, -90..+90
  * longitude - EAST-positive degrees. Input may be 0..360 or -180..180; internally the engine
                normalises to [-180, 180) and always compares longitudes through `lon_delta`,
                so a region that straddles 180 degrees still works.
  * GeoJSON coordinate order is [longitude, latitude].

Reference body: the Mars 2000 IAU sphere, R = 3 396 190 m, which is the datum of NASA Mars Trek
products and of the frontend's route service. A terrain package may declare its own radius; the
engine then uses that value so grid geometry and distances stay consistent with the raster.
"""
from __future__ import annotations

import math

MARS_RADIUS_M = 3_396_190.0


def normalize_lon(lon: float) -> float:
    """East longitude mapped to [-180, 180)."""
    return ((lon + 180.0) % 360.0) - 180.0


def lon_delta(lon_to: float, lon_from: float) -> float:
    """Signed east-positive difference lon_to - lon_from, wrapped to [-180, 180)."""
    return ((lon_to - lon_from + 180.0) % 360.0) - 180.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float, radius_m: float = MARS_RADIUS_M) -> float:
    """Great-circle distance on the sphere.

        a = sin^2(dphi/2) + cos(phi1) cos(phi2) sin^2(dlambda/2)
        d = 2 R asin(sqrt(a))
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon_delta(lon2, lon1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2.0 * radius_m * math.asin(min(1.0, math.sqrt(a)))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing, degrees clockwise from north, 0..360."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon_delta(lon2, lon1))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def metres_per_degree_lat(radius_m: float = MARS_RADIUS_M) -> float:
    return radius_m * math.pi / 180.0


def metres_per_degree_lon(lat_deg: float, radius_m: float = MARS_RADIUS_M) -> float:
    return radius_m * math.pi / 180.0 * math.cos(math.radians(lat_deg))


COMPASS_16 = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")


def compass_point(bearing_deg: float) -> str:
    return COMPASS_16[int(((bearing_deg % 360.0) + 11.25) // 22.5) % 16]
