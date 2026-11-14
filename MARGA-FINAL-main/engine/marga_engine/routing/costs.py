"""Traversability and edge costs for the 8-connected terrain graph.

Nodes are grid cells; an edge joins a cell to each of its 8 neighbours. Edge length L uses true
ground spacing (dy north-south, dx(row) east-west, hypot for diagonals with the mean dx of the two
rows), so costs are in metres (or minutes) rather than pixel counts.

A cell is
    known       elevation and Horn slope are both defined,
    prohibited  known and slope > maxSlopeDegrees (a simulation limit, not a certified one),
    unknown     no elevation / slope; prohibited under unknown_policy='exclude' (default),
                traversable but penalised under 'penalize'.

An edge u -> v exists when u and v are traversable; a diagonal edge additionally needs both cells
it squeezes between to be traversable (no corner cutting past an obstacle).

Edge cost by metric ("terrain" is the default terrain-aware route):

    distance : C = L
    terrain  : C = L * (1 + w_s P_s + w_r P_r + w_u P_u),  each P averaged over the two cells
               (half of the edge lies in each cell)
               P_s = (S / S_max)^p          slope penalty, 0..1 on traversable cells
               P_r = min(1, r / r_ref)      roughness penalty, only if a roughness layer exists
               P_u = 1 on unknown cells     uncertainty penalty (penalize policy only); unknown
                                            cells also take P_s = 1 (and P_r = 1 when roughness
                                            is used): missing data is never treated as flat
    time     : C = L / v(g) minutes, g = (z_v - z_u) / L, Tobler-shaped speed (eva.mobility);
               an edge touching an unknown cell uses g = +tan(S_max), the slowest allowed climb.

Every metric costs at least `lower_bound_per_m` per metre (1 for distance/terrain, 1/v_max for
time), which is what keeps the A* heuristic admissible.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..config import CostWeights, EngineConfig, RouteMetric, UnknownPolicy
from ..errors import InvalidInputError
from ..eva.mobility import MobilityModel
from ..terrain.grid import GridGeometry, TerrainGrid

MOVES: tuple[tuple[int, int], ...] = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
OPPOSITE: tuple[int, ...] = (1, 0, 3, 2, 7, 6, 5, 4)


@dataclass
class RoutingContext:
    metric: RouteMetric
    max_slope_deg: float
    weights: CostWeights
    unknown_policy: UnknownPolicy
    mobility: MobilityModel
    config: EngineConfig
    roughness: np.ndarray | None          # full-grid layer, or None when omitted
    roughness_note: str

    def __post_init__(self):
        if self.metric not in ("terrain", "distance", "time"):
            raise InvalidInputError(f"unknown route metric '{self.metric}'")
        if self.unknown_policy not in ("exclude", "penalize"):
            raise InvalidInputError(f"unknown unknown_policy '{self.unknown_policy}'")
        if not (0 < self.max_slope_deg < 90):
            raise InvalidInputError("maxSlopeDegrees must be between 0 and 90")
        w = self.weights
        if min(w.slope, w.roughness, w.uncertainty) < 0 or w.slope_exponent <= 0:
            raise InvalidInputError("cost weights must be non-negative and slope_exponent positive")

    def with_metric(self, metric: RouteMetric) -> "RoutingContext":
        return RoutingContext(metric, self.max_slope_deg, self.weights, self.unknown_policy, self.mobility,
                              self.config, self.roughness, self.roughness_note)

    @property
    def lower_bound_per_m(self) -> float:
        return self.mobility.min_minutes_per_m if self.metric == "time" else 1.0


@dataclass
class SearchSurface:
    """Cell fields for one search, on a window of the terrain (possibly block-aggregated)."""
    geometry: GridGeometry
    row0: int            # native row of this surface's first row (window origin)
    col0: int
    factor: int          # native cells per surface cell along each axis
    elev: np.ndarray     # float64, NaN = unknown
    slope: np.ndarray    # float64 degrees, NaN = unknown
    rough: np.ndarray | None
    known: np.ndarray
    passable: np.ndarray

    @property
    def shape(self) -> tuple[int, int]:
        return self.elev.shape

    @property
    def dx_rows(self) -> np.ndarray:
        return self.geometry.dx_m_rows

    @property
    def dy(self) -> float:
        return self.geometry.dy_m


def native_passable(terrain: TerrainGrid, ctx: RoutingContext) -> np.ndarray:
    slope = terrain.slope_deg
    known = np.isfinite(terrain.elevation) & np.isfinite(slope)
    ok = known & (slope <= ctx.max_slope_deg)
    if ctx.unknown_policy == "penalize":
        ok |= ~known
    return ok


def native_surface(terrain: TerrainGrid, ctx: RoutingContext, r0: int, r1: int, c0: int, c1: int,
                   mask: np.ndarray | None = None) -> SearchSurface:
    """Exact surface on native cells [r0:r1, c0:c1]; `mask` (same window shape) can further
    restrict which cells may be used (corridor refinement)."""
    sl = (slice(r0, r1), slice(c0, c1))
    elev = terrain.elevation[sl].astype(np.float64)
    slope = terrain.slope_deg[sl].astype(np.float64)
    known = np.isfinite(elev) & np.isfinite(slope)
    passable = known & (slope <= ctx.max_slope_deg)
    if ctx.unknown_policy == "penalize":
        passable |= ~known
    if mask is not None:
        passable &= mask
    rough = None if ctx.roughness is None else ctx.roughness[sl].astype(np.float64)
    return SearchSurface(terrain.geometry.window(r0, r1, c0, c1), r0, c0, 1, elev, slope, rough, known, passable)


def _blocks(a: np.ndarray, f: int) -> np.ndarray:
    ny, nx = a.shape
    py, px = (-ny) % f, (-nx) % f
    if py or px:
        a = np.pad(a, ((0, py), (0, px)), mode="edge")
    return a.reshape(a.shape[0] // f, f, a.shape[1] // f, f)


def guide_surface(terrain: TerrainGrid, ctx: RoutingContext, r0: int, r1: int, c0: int, c1: int,
                  factor: int) -> SearchSurface:
    """Block-aggregated RELAXATION used only to find a corridor on large windows.

    A block is traversable if ANY of its native cells is, and takes the mean penalty fields of
    those cells. If a native path exists, the blocks it crosses form a valid coarse path (also
    under the no-corner-cutting rule), so "no coarse path" proves "no native path" in the window.
    The final route is always re-searched on native cells (see planner)."""
    sl = (slice(r0, r1), slice(c0, c1))
    elev = terrain.elevation[sl].astype(np.float64)
    slope = terrain.slope_deg[sl].astype(np.float64)
    known = np.isfinite(elev) & np.isfinite(slope)
    pas = known & (slope <= ctx.max_slope_deg)
    if ctx.unknown_policy == "penalize":
        pas |= ~known
    any_pass = _blocks(pas, factor).any(axis=(1, 3))

    def pmean(field: np.ndarray, fill: float) -> np.ndarray:
        fb = _blocks(np.where(pas & np.isfinite(field), field, 0.0), factor)
        cnt = _blocks((pas & np.isfinite(field)).astype(np.float64), factor).sum(axis=(1, 3))
        out = fb.sum(axis=(1, 3)) / np.maximum(cnt, 1.0)
        return np.where(cnt > 0, out, fill)

    g_elev = pmean(elev, np.nan)
    g_slope = pmean(slope, np.nan)
    g_known = np.isfinite(g_elev) & np.isfinite(g_slope)
    rough = None
    if ctx.roughness is not None:
        rough = pmean(ctx.roughness[sl].astype(np.float64), np.nan)
    geom = terrain.geometry.window(r0, r1, c0, c1).coarsen(factor)
    return SearchSurface(geom, r0, c0, factor, g_elev, np.minimum(g_slope, ctx.max_slope_deg),
                         rough, g_known, any_pass)


def _shift(a: np.ndarray, di: int, dj: int, fill) -> np.ndarray:
    """b[i, j] = a[i + di, j + dj], `fill` where that falls outside the grid."""
    ny, nx = a.shape
    b = np.full_like(a, fill)
    rs, rd = (slice(di, ny), slice(0, ny - di)) if di >= 0 else (slice(0, ny + di), slice(-di, ny))
    cs, cd = (slice(dj, nx), slice(0, nx - dj)) if dj >= 0 else (slice(0, nx + dj), slice(-dj, nx))
    b[rd, cd] = a[rs, cs]
    return b


def cell_penalty_factor(surf: SearchSurface, ctx: RoutingContext) -> np.ndarray:
    """F = 1 + w_s P_s + w_r P_r + w_u P_u per cell (terrain metric), 1 elsewhere."""
    if ctx.metric != "terrain":
        return np.ones(surf.shape)
    w = ctx.weights
    ps = np.where(surf.known, np.clip(np.nan_to_num(surf.slope) / ctx.max_slope_deg, 0, 1) ** w.slope_exponent, 1.0)
    f = 1.0 + w.slope * ps
    if surf.rough is not None:
        pr = np.where(surf.known & np.isfinite(surf.rough),
                      np.clip(np.nan_to_num(surf.rough) / ctx.config.roughness_ref_m, 0, 1), 1.0)
        f = f + w.roughness * pr
    if ctx.unknown_policy == "penalize":
        f = f + w.uncertainty * (~surf.known)
    return f


def edge_costs(surf: SearchSurface, ctx: RoutingContext) -> np.ndarray:
    """(8, ny, nx) cost of leaving each cell in each MOVES direction; inf = no edge."""
    ny, nx = surf.shape
    dx = surf.dx_rows
    dy = surf.dy
    pas = surf.passable
    F = cell_penalty_factor(surf, ctx) if ctx.metric == "terrain" else None
    out = np.full((8, ny, nx), np.inf)
    dx_col = dx[:, None]
    for k, (di, dj) in enumerate(MOVES):
        ok = pas & _shift(pas, di, dj, False)
        if di and dj:
            ok &= _shift(pas, di, 0, False) & _shift(pas, 0, dj, False)
        if di == 0:
            L = np.broadcast_to(dx_col, (ny, nx))
        elif dj == 0:
            L = np.full((ny, nx), dy)
        else:
            dx_mid = (dx_col + _shift(dx_col, di, 0, np.nan)) / 2.0
            L = np.broadcast_to(np.hypot(dy, dx_mid), (ny, nx))
        if ctx.metric == "distance":
            c = L
        elif ctx.metric == "terrain":
            c = L * (F + _shift(F, di, dj, np.nan)) / 2.0
        else:
            z_u, z_v = surf.elev, _shift(surf.elev, di, dj, np.nan)
            both = surf.known & _shift(surf.known, di, dj, False)
            grade = np.where(both, (z_v - z_u) / L, math.tan(math.radians(ctx.max_slope_deg)))
            c = ctx.mobility.minutes(L, grade)
        out[k] = np.where(ok, c, np.inf)
    return out
