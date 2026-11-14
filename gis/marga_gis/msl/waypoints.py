"""NASA MSL rover localisation (MMGIS MSL_waypoints.json): one position per drive, keyed by RMC.

RMC is Curiosity's Rover Motion Counter written as "<site>_<drive>". The file gives planetocentric
lat/lon (the same convention MARGA's DEM uses, verified with these 1387 points), geoid elevation and the
rover attitude (roll, pitch, yaw in degrees; yaw clockwise from north) at the end of each drive.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from ..crs import mars_crs_definition


@dataclass(frozen=True)
class Waypoint:
    site: int
    drive: int
    sol: int
    lat: float
    lon: float
    elev_geoid: float
    yaw: float
    index: int  # position along the traverse (file order)

    @property
    def rmc(self) -> str:
        return f"{self.site}_{self.drive}"


class Waypoints:
    def __init__(self, items: list[Waypoint]):
        self.items = items
        self.by_rmc = {w.rmc: w for w in items}

    @classmethod
    def load(cls, path: str | Path) -> "Waypoints":
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
        items = []
        for i, f in enumerate(doc["features"]):
            p = f["properties"]
            items.append(Waypoint(int(p["site"]), int(p["drive"]), int(p["sol"]), float(p["lat"]), float(p["lon"]),
                                  float(p["elev_geoid"]), float(p["yaw"]), i))
        return cls(items)

    def at(self, site: int, drive: int) -> tuple[Waypoint | None, str]:
        """The rover position for an RMC: exact, else the last drive before it at the same site."""
        w = self.by_rmc.get(f"{site}_{drive}")
        if w:
            return w, "exact RMC"
        earlier = [x for x in self.items if x.site == site and x.drive < drive]
        if earlier:
            best = max(earlier, key=lambda x: x.drive)
            return best, f"last localised drive before it at site {site} (drive {best.drive})"
        return None, "no localised drive at this site"

    def departure_sol(self, w: Waypoint) -> int:
        """The sol of the next drive (the rover was at `w` from w.sol up to this sol)."""
        nxt = self.items[w.index + 1] if w.index + 1 < len(self.items) else None
        return nxt.sol if nxt else w.sol

    def near(self, lat: float, lon: float, radius_m: float) -> list[tuple[float, Waypoint]]:
        """Waypoints within `radius_m` of a point, nearest first."""
        out = [(distance_m(lat, lon, w.lat, w.lon), w) for w in self.items]
        return sorted([(d, w) for d, w in out if d <= radius_m], key=lambda t: t[0])


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance on the Mars sphere of MARGA's CRS (small-distance approximation, < 0.1 % error at these ranges)."""
    mpd = float(mars_crs_definition()["metres_per_degree"])
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * k, lat2 - lat1) * mpd
