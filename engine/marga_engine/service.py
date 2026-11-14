"""Top-level engine operations: RouteRequest -> RouteResponse, and field return checks.

`plan_route` always returns a RouteResponse-shaped dict (shared/types/index.ts), also on failure,
so the frontend can render it directly. Engine extensions are additive optional fields (see
shared/types/engine.ts). Integer contract fields are rounded conservatively: durations up
(ceil), the return margin down (floor).
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, replace
from typing import Any

import numpy as np

from . import __version__
from .config import DEFAULT_CONFIG, SLOPE_CLASS_STEEP_MAX, CostWeights, EngineConfig
from .contracts import Point, RouteRequestModel, TargetCatalogue, parse_constraints, parse_options, parse_point, parse_route_request
from .errors import CoverageError, EngineError, InvalidInputError
from .eva.budget import assess_eva, return_margin_from
from .eva.mobility import MobilityModel
from .eva.radiation import estimate_dose, reference_with_rate
from .geodesy import haversine_m
from .routing.costs import RoutingContext
from .routing.planner import LegPlanner, LegResult, direct_line_stats
from .routing.profile import RouteProfile, build_profile
from .terrain.analysis import slope_class
from .terrain.grid import TerrainGrid

ALGORITHM = "A* on 8-connected DEM grid (anisotropic octile heuristic, no corner cutting) + string pulling"


# --- helpers -------------------------------------------------------------------------------------

def _ceil(x: float) -> int:
    return int(math.ceil(x - 1e-9))


def _floor(x: float) -> int:
    return int(math.floor(x + 1e-9))


def _r(x: float | None, n: int = 1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


def _pct_largest_remainder(fr: dict[str, float], keys: tuple[str, ...]) -> dict[str, int]:
    """Integer percentages that add up to exactly 100 (largest-remainder rounding)."""
    raw = {k: fr.get(k, 0.0) * 100.0 for k in keys}
    if sum(raw.values()) <= 0:
        return {k: 0 for k in keys}
    base = {k: int(math.floor(v)) for k, v in raw.items()}
    short = 100 - sum(base.values())
    for k in sorted(keys, key=lambda k: (-(raw[k] - base[k]), keys.index(k)))[:max(0, short)]:
        base[k] += 1
    return base


def route_id_for(body: Any, terrain: TerrainGrid, cfg: EngineConfig) -> str:
    """Deterministic id: the same request on the same terrain and engine always gets the same id."""
    blob = json.dumps({"req": body, "terrain": terrain.metadata.dataset_id, "v": __version__,
                       "cfg": repr(cfg)}, sort_keys=True, default=str)
    return "marga_route_" + hashlib.sha256(blob.encode()).hexdigest()[:10]


def _engine_block(ctx: RoutingContext, cfg: EngineConfig) -> dict:
    w = ctx.weights
    return {
        "name": "marga_engine", "version": __version__, "algorithm": ALGORITHM, "metric": ctx.metric,
        "deterministic": True,
        "cost_model": {
            "formula": "C = L (1 + w_s P_s + w_r P_r + w_u P_u)" if ctx.metric == "terrain"
                       else ("C = L" if ctx.metric == "distance" else "C = L / v(grade)"),
            "slope_weight": w.slope, "slope_exponent": w.slope_exponent,
            "roughness_weight": w.roughness if ctx.roughness is not None else 0.0,
            "roughness_ref_m": cfg.roughness_ref_m,
            "uncertainty_weight": w.uncertainty if ctx.unknown_policy == "penalize" else 0.0,
            "max_slope_deg": ctx.max_slope_deg, "unknown_policy": ctx.unknown_policy,
            "roughness": ctx.roughness_note,
        },
        "mobility_model": ctx.mobility.describe(),
    }


def _terrain_source(terrain: TerrainGrid, ctx: RoutingContext) -> dict:
    md = terrain.metadata
    return {
        "dataset_id": md.dataset_id, "label": md.label(), "synthetic": md.synthetic,
        "mission": md.mission, "instrument": md.instrument, "source": md.source, "crs": md.crs,
        "vertical_datum": md.vertical_datum, "resolution_m": _r(terrain.geometry.cell_size_m, 2),
        "processing_level": md.processing_level, "status": md.status, "limitations": md.limitations,
        "roughness": ctx.roughness_note,
    }


def _profile_points(p: RouteProfile, max_points: int) -> list[dict]:
    n = p.lat.size
    keep = np.zeros(n, dtype=bool)
    stride = max(1, int(math.ceil(n / max_points)))
    keep[::stride] = True
    keep[-1] = True
    keep[np.flatnonzero(np.diff(p.leg)) + 1] = True        # leg boundaries
    keep[np.flatnonzero(np.diff(p.leg))] = True
    out = []
    for i in np.flatnonzero(keep):
        out.append({
            "distance_m": int(round(float(p.dist[i]))),
            "elevation_m": int(round(float(p.elev[i]))),
            "slope_deg": round(float(np.degrees(np.arctan(abs(p.grade[i])))), 1),
            "coordinate": [round(float(p.lon[i]), 7), round(float(p.lat[i]), 7)],
            "terrain_slope_deg": _r(p.terrain_slope[i]),
            "time_min": round(float(p.time[i]), 1),
            "leg": int(p.leg[i]),
            "data_quality": "dem" if p.quality[i] else "interpolated",
        })
    return out


def _coords(legs: list[list[tuple[float, float]]]) -> list[list[float]]:
    out: list[list[float]] = []
    for k, pts in enumerate(legs):
        for j, (lat, lon) in enumerate(pts):
            if k > 0 and j == 0:
                continue
            out.append([round(lon, 7), round(lat, 7)])
    return out


def _route_summary(p: RouteProfile, legs: list[LegResult], metric: str) -> dict:
    fr = p.summary_fractions()
    return {
        "metric": metric,
        "distance_m": _r(p.distance_m), "distance_3d_m": _r(p.distance_3d_m),
        "elevation_gain_m": _r(p.gain_m), "elevation_loss_m": _r(p.loss_m),
        "estimated_time_min": _r(p.time_min), "max_terrain_slope_deg": _r(p.max_terrain_slope),
        "route_cost": _r(sum(l.cost for l in legs), 2),
        "terrain_fractions": {k: round(v, 4) for k, v in fr.items()},
        "coordinates": _coords([l.points for l in legs]),
    }


def _response(route_id: str, status: str, warnings: list[str], **ext) -> dict:
    base = {
        "route_id": route_id, "distance_m": 0, "distance_3d_m": 0, "elevation_gain_m": 0, "elevation_loss_m": 0,
        "estimated_time_min": 0, "eva_budget_used_percent": 0, "return_margin_min": 0, "coordinates": [],
        "elevation_profile": [], "segments": [], "status": status, "warnings": warnings,
        "terrain_summary": {"flat_pct": 0, "moderate_pct": 0, "steep_pct": 0, "hazardous_pct": 0},
    }
    base.update(ext)
    return base


def build_context(terrain: TerrainGrid, req: RouteRequestModel, cfg: EngineConfig) -> tuple[RoutingContext, EngineConfig]:
    o = req.options
    w = cfg.weights
    w = CostWeights(slope=o.slope_weight if o.slope_weight is not None else w.slope,
                    roughness=o.roughness_weight if o.roughness_weight is not None else w.roughness,
                    uncertainty=o.uncertainty_weight if o.uncertainty_weight is not None else w.uncertainty,
                    slope_exponent=w.slope_exponent)
    cfg = replace(cfg, weights=w, metric=o.metric, unknown_policy=o.unknown_policy,
                  compute_alternatives=o.compute_alternatives and cfg.compute_alternatives)
    rough, note = terrain.roughness_layer(cfg.roughness_max_cell_m)
    if rough is not None and w.roughness == 0:
        rough, note = None, "omitted: roughness weight set to 0"
    mob = MobilityModel(req.constraints.walking_speed_kmh, cfg.mobility)
    ctx = RoutingContext(o.metric, req.constraints.max_slope_deg, w, o.unknown_policy, mob, cfg, rough, note)
    return ctx, cfg


# --- route planning ------------------------------------------------------------------------------

def plan_route(body: Any, terrain: TerrainGrid, config: EngineConfig = DEFAULT_CONFIG,
               catalogue: TargetCatalogue | None = None) -> dict:
    """RouteRequest -> RouteResponse. Never raises for bad input: failures come back as a
    RouteResponse with status 'failed' and the reason in warnings/status_reason."""
    synthetic_warning = ("SYNTHETIC TEST TERRAIN: elevations are generated, not NASA data. Use only to "
                         "exercise the software.") if terrain.metadata.synthetic else None
    base_warn = [synthetic_warning] if synthetic_warning else []
    try:
        req = parse_route_request(body, catalogue)
    except EngineError as e:
        rid = (body.get("route_id") if isinstance(body, dict) and isinstance(body.get("route_id"), str) else None)
        return _response(rid or "marga_route_invalid", "failed", base_warn + [f"Invalid request: {e}"],
                         status_reason="invalid_request")
    route_id = req.route_id or route_id_for(body, terrain, config)
    try:
        ctx, cfg = build_context(terrain, req, config)
    except EngineError as e:
        return _response(route_id, "failed", base_warn + [f"Invalid request: {e}"], status_reason="invalid_request")
    stops = [req.start] + req.waypoints + [req.destination]
    try:
        for p in stops + [req.habitat]:
            terrain.require_coverage(p.lat, p.lon, p.name)
    except CoverageError as e:
        return _response(route_id, "failed", base_warn + [str(e)], status_reason="outside_terrain_coverage",
                         terrain_source=_terrain_source(terrain, ctx), engine=_engine_block(ctx, cfg))
    try:
        return _plan(req, route_id, terrain, ctx, cfg, base_warn, catalogue)
    except EngineError as e:
        return _response(route_id, "failed", base_warn + [f"Engine error: {e}"], status_reason="engine_error",
                         terrain_source=_terrain_source(terrain, ctx), engine=_engine_block(ctx, cfg))


def _plan(req: RouteRequestModel, route_id: str, terrain: TerrainGrid, ctx: RoutingContext,
          cfg: EngineConfig, warnings: list[str], catalogue: TargetCatalogue | None = None) -> dict:
    stops = [req.start] + req.waypoints + [req.destination]
    planner = LegPlanner(terrain, ctx)
    assumptions = list(req.notes)
    catalogue_sources = sorted({catalogue.by_id[p.target_id]["source"] for p in stops
                                if catalogue and p.target_id and p.target_id in catalogue.by_id})
    common = {"engine": _engine_block(ctx, cfg), "terrain_source": _terrain_source(terrain, ctx)}

    legs: list[LegResult] = []
    snapped: dict[int, float] = {}
    for i, (a, b) in enumerate(zip(stops, stops[1:])):
        lr = planner.plan(a.tup, b.tup)
        if not lr.ok:
            msg = f"Leg {i + 1} ({a.name} -> {b.name}): {lr.message}"
            return _response(route_id, "unreachable", warnings + [msg], status_reason=lr.reason,
                             failed_leg=i, assumptions=assumptions, **common)
        legs.append(lr)
        for idx, moved in ((i, lr.start_snap_m), (i + 1, lr.goal_snap_m)):
            if moved > 0:
                snapped[idx] = moved
    for idx, moved in sorted(snapped.items()):
        warnings.append(f"{stops[idx].name} lies on ground that is prohibited or has no elevation data; the route "
                        f"uses the nearest traversable cell, {moved:.0f} m away.")

    prof = build_profile(terrain, [l.points for l in legs], ctx.mobility, ctx.max_slope_deg)

    # Return to habitat: an independent search from the turnaround point - never the outbound path reversed.
    turn = legs[-1].points[-1]
    ret_leg = planner.plan(turn, req.habitat.tup)
    if not ret_leg.ok:
        return _response(route_id, "unreachable",
                         warnings + [f"Return ({req.destination.name} -> {req.habitat.name}): {ret_leg.message}"],
                         status_reason="return_" + (ret_leg.reason or "failed"), assumptions=assumptions, **common)
    ret_prof = build_profile(terrain, [ret_leg.points], ctx.mobility, ctx.max_slope_deg)

    c = req.constraints
    per_stop = c.science_time_min_per_stop
    n_science_stops = len(req.waypoints) + 1
    science_min = (per_stop or 0.0) * n_science_stops
    if per_stop is None:
        assumptions.append("No science time per stop was configured (scienceTimeMinPerStop); the margin "
                           "excludes science work - see eva_assessment.max_science_time_min.")
    eva = assess_eva(prof.time_min, ret_prof.time_min, c.max_eva_hours * 60, c.reserve_eva_hours * 60, science_min)
    eva_d = eva.to_dict()
    eva_d.update({"science_stops": n_science_stops, "science_min_per_stop": per_stop,
                  "walking_speed_model": ctx.mobility.describe(),
                  "return_route_recalculated": True,
                  "notes": ["Times are planning estimates from a Tobler-shaped speed model scaled to the configured "
                            "flat walking speed; not a validated suited-astronaut mobility prediction."]})

    dose_ref = reference_with_rate(c.radiation_rate_msv_per_day, cfg.dose_reference)
    exposure = prof.time_min + science_min + ret_prof.time_min
    radiation = {
        "planned_activity": estimate_dose(exposure, dose_ref),
        "full_eva_duration": estimate_dose(c.max_eva_hours * 60, dose_ref),
    }

    # --- advisories ---------------------------------------------------------------------------
    unknown_m = float(prof.step_len[prof.step_class == "unknown"].sum())
    if unknown_m > 0:
        warnings.append(f"{unknown_m:.0f} m of the route crosses ground with no elevation data; elevations there are "
                        "interpolated and terrain is uncertain.")
    haz = prof.step_len[prof.step_class == "hazardous"].sum()
    if haz > 0:
        warnings.append(f"{haz:.0f} m of the route is on terrain steeper than {SLOPE_CLASS_STEEP_MAX:g} deg "
                        f"(allowed by the {ctx.max_slope_deg:g} deg limit).")
    hab = req.habitat
    far = float(np.max([haversine_m(hab.lat, hab.lon, la, lo, terrain.geometry.radius_m)
                        for la, lo in zip(prof.lat[:: max(1, prof.lat.size // 400)], prof.lon[:: max(1, prof.lat.size // 400)])]
                       + [haversine_m(hab.lat, hab.lon, req.destination.lat, req.destination.lon, terrain.geometry.radius_m)]))
    if far > c.max_distance_m:
        warnings.append(f"Route reaches {far:.0f} m from {hab.name}, beyond the configured maximum traverse radius "
                        f"of {c.max_distance_m:.0f} m.")
    if terrain.geometry.cell_size_m > cfg.coarse_dem_warning_m:
        warnings.append(f"Terrain grid spacing is {terrain.geometry.cell_size_m:.0f} m: obstacles smaller than this are "
                        "not represented. Not an obstacle map for walking.")
    status_reason = None
    if eva.reserve_min >= eva.eva_duration_min:
        warnings.append(f"The safety reserve ({c.reserve_eva_hours:g} h) is not shorter than the EVA "
                        f"({c.max_eva_hours:g} h): no time is left for the excursion.")
        status_reason = "eva_budget_exceeded"
    elif eva.status == "exceeded":
        warnings.append(f"EVA budget exceeded: outbound {_ceil(eva.outbound_min)} + science {_ceil(eva.science_min)} + "
                        f"return {_ceil(eva.return_min)} + reserve {_ceil(eva.reserve_min)} min needed, but the EVA is "
                        f"{eva.eva_duration_min:.0f} min (return margin {_floor(eva.return_margin_min)} min).")
        status_reason = "eva_budget_exceeded"
    elif eva.status == "no_slack":
        warnings.append("Return margin is zero: no time remains beyond the configured reserve.")

    feasibility_warnings = [w for w in warnings if not w.startswith("SYNTHETIC")]
    status = "unreachable" if eva.status == "exceeded" else ("warning" if feasibility_warnings else "calculated")

    # --- segments ------------------------------------------------------------------------------
    segments = []
    for k, (a, b) in enumerate(zip(stops, stops[1:])):
        st = prof.leg_stats(k)
        mean_ts = st["mean_terrain_slope_deg"]
        cls = slope_class(mean_ts)
        segments.append({
            "from_name": a.name, "to_name": b.name,
            "distance_m": int(round(st["distance_m"])),
            "estimated_time_min": _ceil(st["time_min"]),
            "average_slope_deg": round(st["mean_along_track_slope_deg"], 1),
            "terrain_type": (f"{cls.capitalize()} terrain (mean {mean_ts:.1f}°, max {st['max_terrain_slope_deg']:.1f}° "
                             "terrain slope)") if math.isfinite(mean_ts) else "Unknown terrain (no elevation data)",
            "max_terrain_slope_deg": _r(st["max_terrain_slope_deg"]),
            "elevation_gain_m": _r(st["gain_m"]), "elevation_loss_m": _r(st["loss_m"]),
            "unknown_length_m": _r(st["unknown_m"]),
            "start_snapped_m": _r(legs[k].start_snap_m), "end_snapped_m": _r(legs[k].goal_snap_m),
        })

    fr = prof.summary_fractions()
    pct = _pct_largest_remainder(fr, ("flat", "moderate", "steep", "hazardous", "unknown"))
    terrain_summary = {"flat_pct": pct["flat"], "moderate_pct": pct["moderate"], "steep_pct": pct["steep"],
                       "hazardous_pct": pct["hazardous"], "unknown_pct": pct["unknown"]}

    alternatives = None
    if cfg.compute_alternatives:
        alternatives = {"selected_metric": ctx.metric,
                        ctx.metric: _route_summary(prof, legs, ctx.metric),
                        "direct_line": [dict(direct_line_stats(terrain, ctx, a.tup, b.tup), from_name=a.name, to_name=b.name)
                                        for a, b in zip(stops, stops[1:])]}
        for alt in ("distance", "terrain"):
            if alt == ctx.metric:
                continue
            p2 = LegPlanner(terrain, ctx.with_metric(alt))
            alt_legs = [p2.plan(a.tup, b.tup) for a, b in zip(stops, stops[1:])]
            if all(l.ok for l in alt_legs):
                ap = build_profile(terrain, [l.points for l in alt_legs], ctx.mobility, ctx.max_slope_deg)
                alternatives[alt] = _route_summary(ap, alt_legs, alt)
            else:
                alternatives[alt] = None
        alternatives["notes"] = ["'distance' is the shortest route that still avoids prohibited ground; "
                                 "'terrain' minimises the terrain cost. Neither is certified safe."]

    return_route = _route_summary(ret_prof, [ret_leg], ctx.metric)
    return_route.update({"from_name": req.destination.name, "to_name": hab.name, "recalculated": True,
                         "end_snapped_m": _r(ret_leg.goal_snap_m)})

    assumptions += [
        f"Slope limit {ctx.max_slope_deg:g} deg and walking speed {c.walking_speed_kmh:g} km/h are simulation "
        "parameters, not certified astronaut mobility limits.",
        "Routes are preliminary terrain-risk assessments; they are not certified safe.",
        f"Terrain slope from the DEM at {terrain.geometry.cell_size_m:.0f} m spacing; features smaller than one "
        "cell are not represented.",
    ]
    return {
        "route_id": route_id,
        "distance_m": int(round(prof.distance_m)),
        "distance_3d_m": int(round(prof.distance_3d_m)),
        "elevation_gain_m": int(round(prof.gain_m)),
        "elevation_loss_m": int(round(prof.loss_m)),
        "estimated_time_min": _ceil(prof.time_min),
        "eva_budget_used_percent": int(round(eva.budget_used_percent)),
        "return_margin_min": _floor(eva.return_margin_min),
        "coordinates": _coords([l.points for l in legs]),
        "elevation_profile": _profile_points(prof, cfg.max_profile_points),
        "segments": segments,
        "status": status,
        "warnings": warnings,
        "terrain_summary": terrain_summary,
        # --- engine extensions (shared/types/engine.ts) ---
        "status_reason": status_reason,
        "eva_assessment": eva_d,
        "radiation": radiation,
        "return_route": return_route,
        "alternatives": alternatives,
        "search": [{"leg": k, "search_cell_m": l.search_cell_m, "guide_factor": l.guide_factor,
                    "window_cells": l.window_cells, "expanded_nodes": l.expanded, "notes": l.notes}
                   for k, l in enumerate(legs)],
        "assumptions": assumptions,
        "mission_summary": _mission_summary(req, terrain, prof, ret_prof, eva, radiation, warnings, assumptions,
                                            status, catalogue_sources),
        **common,
    }


def _mission_summary(req: RouteRequestModel, terrain: TerrainGrid, prof: RouteProfile, ret_prof: RouteProfile,
                     eva, radiation: dict, warnings: list[str], assumptions: list[str], status: str,
                     catalogue_sources: list[str]) -> dict:
    """Spec FR-11: everything a mission summary needs, in one block."""
    md = terrain.metadata
    dose = radiation["planned_activity"]
    ref = dose["reference"]
    return {
        "site": {"site_id": md.site_id, "terrain_dataset": md.label()},
        "objective": req.objective,
        "targets": [p.name for p in req.waypoints + [req.destination]],
        "start": req.start.name, "habitat": req.habitat.name,
        "route_status": status,
        "total_distance_m": int(round(prof.distance_m)),
        "estimated_travel_time_min": _ceil(prof.time_min),
        "estimated_working_time_min": _ceil(eva.science_min),
        "estimated_return_time_min": _ceil(ret_prof.time_min),
        "return_margin_min": _floor(eva.return_margin_min),
        "terrain_advisories": [w for w in warnings if not w.startswith("SYNTHETIC")],
        "radiation": {"dose_equivalent_msv": dose["dose_equivalent_msv"], "duration_min": dose["duration_min"],
                      "basis": f"{ref['rate_msv_per_day']:g} {ref['unit']} ({ref['mission']}, {ref['instrument']}, "
                               f"{ref['measurement_period']}; historical, not a forecast)"},
        "dataset_references": [f"Terrain: {md.label()}" + (f" - {md.source}" if md.source else "")]
                              + [f"Targets: {s}" for s in catalogue_sources],
        "data_limitations": list(md.limitations) + list(assumptions),
    }


# --- field mode: return check from the current position -------------------------------------------

def assess_return(body: Any, terrain: TerrainGrid, config: EngineConfig = DEFAULT_CONFIG) -> dict:
    """{position, habitat, elapsed_min, constraints, options?} -> fresh return route + margin.

    M = (T_EVA - T_elapsed) - T_return - T_reserve, with T_return from a new A* search from the
    current position (spec 14.4)."""
    if not isinstance(body, dict):
        raise InvalidInputError("request body must be a JSON object")
    pos = parse_point(body.get("position"), "Current position")
    hab = parse_point(body.get("habitat"), "Habitat")
    elapsed = body.get("elapsed_min")
    if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed < 0:
        raise InvalidInputError("elapsed_min must be a non-negative number")
    c = parse_constraints(body.get("constraints"))
    o = parse_options(body.get("options"))
    req = RouteRequestModel(None, pos, hab, [], hab, c, o)
    ctx, cfg = build_context(terrain, req, config)
    for p in (pos, hab):
        terrain.require_coverage(p.lat, p.lon, p.name)
    leg = LegPlanner(terrain, ctx).plan(pos.tup, hab.tup)
    out: dict[str, Any] = {"position": asdict(pos), "habitat": asdict(hab),
                           "terrain_source": _terrain_source(terrain, ctx), "engine": _engine_block(ctx, cfg)}
    if not leg.ok:
        out.update({"status": "unreachable", "status_reason": leg.reason, "message": leg.message})
        return out
    prof = build_profile(terrain, [leg.points], ctx.mobility, ctx.max_slope_deg)
    m = return_margin_from(float(elapsed), prof.time_min, c.max_eva_hours * 60, c.reserve_eva_hours * 60)
    out.update({"status": "calculated" if m["status"] == "within_budget" else "warning" if m["status"] == "no_slack"
                else "unreachable", "return_route": _route_summary(prof, [leg], ctx.metric), "margin": m,
                "radiation_remaining_eva": estimate_dose(max(0.0, c.max_eva_hours * 60 - float(elapsed)),
                                                         reference_with_rate(c.radiation_rate_msv_per_day,
                                                                             cfg.dose_reference))})
    if terrain.metadata.synthetic:
        out["warnings"] = ["SYNTHETIC TEST TERRAIN: elevations are generated, not NASA data."]
    return out


__all__ = ["plan_route", "assess_return", "route_id_for", "Point"]
