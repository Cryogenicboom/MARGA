"""Export Python-engine results as golden vectors for the TypeScript parity tests.

    python tools/export_golden_vectors.py      -> engine/ts/test/golden/cases.json

The TypeScript port must reproduce these results on the same terrain package
(frontend/public/terrain/gale) within small numerical tolerances.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ENGINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE))

from marga_engine.config import DEFAULT_CONFIG  # noqa: E402
from marga_engine.service import plan_route  # noqa: E402
from marga_engine.terrain.package import load_package  # noqa: E402

PKG = ENGINE.parent / "frontend" / "public" / "terrain" / "gale"
OUT = ENGINE / "ts" / "test" / "golden" / "cases.json"

BRADBURY = {"latitude": -4.5895, "longitude": 137.4417, "name": "Bradbury Landing Site"}
MURRAY = {"latitude": -4.6650, "longitude": 137.3950, "name": "Murray Buttes"}
SULFATE = {"latitude": -4.74, "longitude": 137.33, "name": "Sulfate-Bearing Strata"}
RAD = {"latitude": -4.60, "longitude": 137.42, "name": "RAD Point Alpha"}
C = {"walkingSpeedKmh": 1.2, "maxSlopeDegrees": 15, "maxEvaHours": 8.0, "reserveEvaHours": 1.5, "maxDistanceMeters": 10000}


def req(start, dest, waypoints=None, options=None, **c):
    r = {"start": start, "destination": dest, "constraints": {**C, **c}}
    if waypoints:
        r["waypoints"] = waypoints
    if options:
        r["options"] = options
    return r


def slim(r: dict) -> dict:
    keep = ["status", "status_reason", "distance_m", "distance_3d_m", "elevation_gain_m", "elevation_loss_m",
            "estimated_time_min", "eva_budget_used_percent", "return_margin_min", "terrain_summary", "coordinates",
            "warnings", "eva_assessment"]
    out = {k: r.get(k) for k in keep}
    out["segments"] = [{k: s[k] for k in ("from_name", "to_name", "distance_m", "estimated_time_min", "average_slope_deg")}
                       for s in r.get("segments", [])]
    out["profile_len"] = len(r.get("elevation_profile", []))
    out["profile_head"] = r.get("elevation_profile", [])[:3]
    if r.get("mission_summary"):
        ms = r["mission_summary"]
        out["mission_summary"] = {k: ms[k] for k in ("route_status", "total_distance_m", "estimated_travel_time_min",
                                                      "estimated_working_time_min", "estimated_return_time_min",
                                                      "return_margin_min", "targets", "dataset_references")}
    if r.get("radiation"):
        out["dose_msv"] = r["radiation"]["planned_activity"]["dose_equivalent_msv"]
    if r.get("return_route"):
        rr = r["return_route"]
        out["return"] = {k: rr[k] for k in ("distance_m", "estimated_time_min", "route_cost")}
    if r.get("alternatives"):
        out["alternatives"] = {k: (None if v is None else {"distance_m": v["distance_m"], "route_cost": v["route_cost"]})
                               for k, v in r["alternatives"].items() if k in ("terrain", "distance", "time")}
    return out


def main() -> None:
    t = load_package(PKG)
    steep = np.argwhere(np.nan_to_num(t.slope_deg) > 25)[0]
    steep_pt = {"latitude": float(t.geometry.row_lat(steep[0])), "longitude": float(t.geometry.col_lon(steep[1])),
                "name": "Steep target"}
    cases = [
        ("basic", req(BRADBURY, MURRAY), {}),
        ("waypoint_science", req(BRADBURY, MURRAY, [RAD], walkingSpeedKmh=2.0, scienceTimeMinPerStop=20), {}),
        ("metric_distance", req(BRADBURY, SULFATE, options={"metric": "distance"}), {}),
        ("metric_time", req(BRADBURY, SULFATE, options={"metric": "time"}), {}),
        ("coarse_to_fine", req(BRADBURY, SULFATE), {"max_search_cells": 6000}),
        ("hole_exclude", req({"latitude": -4.62, "longitude": 137.288, "name": "W"},
                             {"latitude": -4.62, "longitude": 137.312, "name": "E"}), {}),
        ("hole_penalize", req({"latitude": -4.62, "longitude": 137.288, "name": "W"},
                              {"latitude": -4.62, "longitude": 137.312, "name": "E"},
                              options={"unknown_policy": "penalize", "uncertainty_weight": 0.2}), {}),
        ("eva_exceeded", req(BRADBURY, SULFATE, maxEvaHours=3.0, reserveEvaHours=0.5), {}),
        ("snapped_target", req(BRADBURY, steep_pt), {}),
        ("invalid", req(BRADBURY, MURRAY, walkingSpeedKmh=-1.0), {}),
        ("reserve_exceeds_eva", req(BRADBURY, MURRAY, maxEvaHours=2.0, reserveEvaHours=4.0), {}),
        ("outside", req(BRADBURY, {"latitude": 18.44, "longitude": 77.45}), {}),
        ("habitat_rad_override", {**req(BRADBURY, MURRAY, radiationRateMsvPerDay=1.0),
                                  "habitat": {"latitude": -4.60, "longitude": 137.45, "name": "Hab-2"}}, {}),
    ]
    out = []
    for name, body, overrides in cases:
        cfg = DEFAULT_CONFIG.with_overrides(**overrides) if overrides else DEFAULT_CONFIG
        out.append({"name": name, "request": body, "config": overrides, "expected": slim(plan_route(body, t, cfg))})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {len(out)} cases to {OUT}")


if __name__ == "__main__":
    main()
