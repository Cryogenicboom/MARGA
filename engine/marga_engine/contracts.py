"""Request parsing and validation for the shared contracts in shared/types/index.ts.

Base fields follow `RouteRequest` / `MissionConstraints` exactly. Engine extensions are optional
and described in shared/types/engine.ts:

    RouteRequest.habitat                     where the return leg ends (default: start)
    RouteRequest.objective                   {id, title} of the scientific objective (mission summary)
    RouteRequest.options.metric              'terrain' (default) | 'distance' | 'time'
    RouteRequest.options.unknown_policy      'exclude' (default) | 'penalize'
    RouteRequest.options.compute_alternatives
    RouteRequest.options.slope_weight / roughness_weight / uncertainty_weight
    MissionConstraints.scienceTimeMinPerStop working time at each waypoint and the destination
    MissionConstraints.radiationRateMsvPerDay simulation override of the historical RAD rate
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import InvalidInputError
from .geodesy import haversine_m, normalize_lon


@dataclass
class Point:
    lat: float
    lon: float
    name: str
    target_id: str | None = None

    @property
    def tup(self) -> tuple[float, float]:
        return (self.lat, self.lon)


@dataclass
class Constraints:
    walking_speed_kmh: float
    max_slope_deg: float
    max_eva_hours: float
    reserve_eva_hours: float
    max_distance_m: float
    science_time_min_per_stop: float | None = None
    radiation_rate_msv_per_day: float | None = None


@dataclass
class Options:
    metric: str = "terrain"
    unknown_policy: str = "exclude"
    compute_alternatives: bool = True
    slope_weight: float | None = None
    roughness_weight: float | None = None
    uncertainty_weight: float | None = None


@dataclass
class RouteRequestModel:
    route_id: str | None
    start: Point
    destination: Point
    waypoints: list[Point]
    habitat: Point
    constraints: Constraints
    options: Options
    target_ids: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    objective: dict | None = None


def _num(d: dict, key: str, lo: float | None = None, hi: float | None = None, *, lo_open=False,
         hi_open=False, required=True, label: str | None = None) -> float | None:
    label = label or key
    if key not in d or d[key] is None:
        if required:
            raise InvalidInputError(f"{label} is required")
        return None
    v = d[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise InvalidInputError(f"{label} must be a finite number (got {v!r})")
    v = float(v)
    if lo is not None and (v <= lo if lo_open else v < lo):
        raise InvalidInputError(f"{label} must be {'>' if lo_open else '>='} {lo:g} (got {v:g})")
    if hi is not None and (v >= hi if hi_open else v > hi):
        raise InvalidInputError(f"{label} must be {'<' if hi_open else '<='} {hi:g} (got {v:g})")
    return v


def parse_point(d: Any, default_name: str) -> Point:
    if not isinstance(d, dict):
        raise InvalidInputError(f"{default_name} must be an object with latitude and longitude")
    lat = _num(d, "latitude", -90, 90, label=f"{default_name}.latitude")
    lon = _num(d, "longitude", label=f"{default_name}.longitude")
    name = d.get("name") or default_name
    return Point(lat, normalize_lon(lon), str(name))


def parse_constraints(d: Any) -> Constraints:
    if not isinstance(d, dict):
        raise InvalidInputError("constraints must be an object")
    eva = _num(d, "maxEvaHours", 0, 24, lo_open=True)
    reserve = _num(d, "reserveEvaHours", 0, 24)
    return Constraints(
        walking_speed_kmh=_num(d, "walkingSpeedKmh", 0, 20, lo_open=True),
        max_slope_deg=_num(d, "maxSlopeDegrees", 0, 60, lo_open=True),
        max_eva_hours=eva,
        reserve_eva_hours=reserve,
        max_distance_m=_num(d, "maxDistanceMeters", 0, None, lo_open=True),
        science_time_min_per_stop=_num(d, "scienceTimeMinPerStop", 0, 24 * 60, required=False),
        radiation_rate_msv_per_day=_num(d, "radiationRateMsvPerDay", 0, 1000, required=False),
    )


def parse_options(d: Any) -> Options:
    if d is None:
        return Options()
    if not isinstance(d, dict):
        raise InvalidInputError("options must be an object")
    o = Options(
        metric=d.get("metric", "terrain"),
        unknown_policy=d.get("unknown_policy", "exclude"),
        compute_alternatives=bool(d.get("compute_alternatives", True)),
        slope_weight=_num(d, "slope_weight", 0, 100, required=False),
        roughness_weight=_num(d, "roughness_weight", 0, 100, required=False),
        uncertainty_weight=_num(d, "uncertainty_weight", 0, 100, required=False),
    )
    if o.metric not in ("terrain", "distance", "time"):
        raise InvalidInputError("options.metric must be 'terrain', 'distance' or 'time'")
    if o.unknown_policy not in ("exclude", "penalize"):
        raise InvalidInputError("options.unknown_policy must be 'exclude' or 'penalize'")
    return o


class TargetCatalogue:
    """ScienceTarget records (science_data/*.json, schema shared/schemas/science_target.schema.json)."""
    REQUIRED = ("id", "name", "category", "latitude", "longitude", "elevation_m", "source", "instrument",
                "confidence", "description")

    def __init__(self, targets: list[dict]):
        self.by_id: dict[str, dict] = {}
        for t in targets:
            missing = [k for k in self.REQUIRED if k not in t]
            if missing:
                raise InvalidInputError(f"science target {t.get('id', '?')} is missing {missing}")
            self.by_id[t["id"]] = t

    @classmethod
    def load(cls, path: str | Path) -> "TargetCatalogue":
        data = json.loads(Path(path).read_text())
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            data = [{**f["properties"], "longitude": f["geometry"]["coordinates"][0],
                     "latitude": f["geometry"]["coordinates"][1]} for f in data["features"]]
        return cls(data)

    def point(self, target_id: str) -> Point:
        t = self.by_id.get(target_id)
        if t is None:
            raise InvalidInputError(f"unknown target id '{target_id}'")
        return Point(float(t["latitude"]), normalize_lon(float(t["longitude"])), t["name"], target_id)


def parse_route_request(d: Any, catalogue: TargetCatalogue | None = None) -> RouteRequestModel:
    if not isinstance(d, dict):
        raise InvalidInputError("request body must be a JSON object")
    start = parse_point(d.get("start"), "Start")
    dest = parse_point(d.get("destination"), "Destination")
    wps_raw = d.get("waypoints") or []
    if not isinstance(wps_raw, list):
        raise InvalidInputError("waypoints must be a list")
    waypoints = [parse_point(w, f"Waypoint {i + 1}") for i, w in enumerate(wps_raw)]
    target_ids = d.get("target_ids") or []
    notes: list[str] = []
    if target_ids and not waypoints:
        if catalogue is None:
            notes.append("target_ids were ignored: no science target catalogue is loaded in the engine")
        else:
            for tid in target_ids:
                p = catalogue.point(tid)
                if haversine_m(p.lat, p.lon, dest.lat, dest.lon) > 1.0 and \
                   haversine_m(p.lat, p.lon, start.lat, start.lon) > 1.0:
                    waypoints.append(p)
    habitat = parse_point(d["habitat"], "Habitat") if d.get("habitat") else Point(start.lat, start.lon, start.name)
    rid = d.get("route_id")
    if rid is not None and not isinstance(rid, str):
        raise InvalidInputError("route_id must be a string")
    if len(waypoints) > 25:
        raise InvalidInputError("at most 25 waypoints are supported per request")
    objective = d.get("objective")
    if objective is not None and not isinstance(objective, dict):
        raise InvalidInputError("objective must be an object with id and title")
    return RouteRequestModel(rid, start, dest, waypoints, habitat, parse_constraints(d.get("constraints")),
                             parse_options(d.get("options")), list(target_ids), notes, objective)
