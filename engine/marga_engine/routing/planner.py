"""Leg planning: endpoint snapping, windowed A*, coarse-to-fine refinement, straightening.

For one leg a -> b:

1. Snap. If a or b sits on prohibited / unknown ground it is moved to the nearest traversable
   native cell within `endpoint_snap_m` that is connected to the other end (connected-component
   labels, so an isolated pocket is never chosen); the move is reported. Points in disconnected
   traversable areas are reported unreachable immediately, without searching.
2. Window. Search the bounding box of a and b padded by max(0.35 L, 600 m). If no path exists
   inside the window it is widened (x2.5) until it covers the whole terrain package, so a
   window can never hide a valid route.
3. Search. Windows up to `max_search_cells` are searched directly on native DEM cells. Larger
   windows first run A* on a block-aggregated RELAXATION (routing.costs.guide_surface) - if that
   finds nothing, no native route exists in the window - then re-run A* on native cells inside a
   corridor around the coarse path (widened if needed). The returned route is therefore always
   computed at the DEM's own resolution and never crosses prohibited native cells.
4. Straighten with routing.smoothing.string_pull (never more costly, never through obstacles).
"""
from __future__ import annotations

import math
import weakref
from dataclasses import dataclass, field

import numpy as np

from ..geodesy import haversine_m
from ..terrain.grid import TerrainGrid
from .astar import astar
from .costs import RoutingContext, SearchSurface, edge_costs, guide_surface, native_passable, native_surface
from .smoothing import SegmentEvaluator, polyline_cost, string_pull


@dataclass
class SnapResult:
    ok: bool
    row: int = 0
    col: int = 0
    lat: float = 0.0
    lon: float = 0.0
    moved_m: float = 0.0
    exact_rc: tuple[float, float] = (0.0, 0.0)   # native fractional row/col actually used
    reason: str | None = None


@dataclass
class LegResult:
    ok: bool
    metric: str
    points: list[tuple[float, float]] = field(default_factory=list)   # (lat, lon)
    cost: float = math.inf
    reason: str | None = None
    message: str | None = None
    start_snap_m: float = 0.0
    goal_snap_m: float = 0.0
    search_cell_m: float = 0.0
    guide_factor: int = 1
    expanded: int = 0
    window_cells: int = 0
    notes: list[str] = field(default_factory=list)


def connected_components(passable: np.ndarray) -> np.ndarray:
    """Label 4-connected components of traversable cells (0 = not traversable).

    With the no-corner-cutting rule a diagonal move needs both orthogonal neighbours traversable,
    so it can always be replaced by two orthogonal moves: 8-connectivity under that rule equals
    4-connectivity. Two cells can be joined by a route iff they share a label. Run-length
    union-find, O(number of row runs)."""
    ny, nx = passable.shape
    parent: list[int] = [0]

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    rows_runs = []
    prev: list[tuple[int, int, int]] = []
    for r in range(ny):
        d = np.diff(np.concatenate(([0], passable[r].astype(np.int8), [0])))
        starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        cur = []
        j = 0
        for st, en in zip(starts.tolist(), ends.tolist()):
            lab = len(parent)
            parent.append(lab)
            while j < len(prev) and prev[j][1] <= st:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < en:
                ra, rb = find(lab), find(prev[k][2])
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
                k += 1
            cur.append((st, en, lab))
        rows_runs.append(cur)
        prev = cur
    labels = np.zeros((ny, nx), dtype=np.int32)
    for r, runs in enumerate(rows_runs):
        for st, en, lab in runs:
            labels[r, st:en] = find(lab)
    return labels


_TRAVERSABILITY: "weakref.WeakKeyDictionary[TerrainGrid, dict]" = weakref.WeakKeyDictionary()


def traversability(terrain: TerrainGrid, ctx: RoutingContext) -> tuple[np.ndarray, np.ndarray]:
    """(passable, component labels) for this terrain and slope/no-data setting, computed once and
    shared by every leg, the return search and the route alternatives (they all use the same
    traversability; only the cost metric differs)."""
    per = _TRAVERSABILITY.setdefault(terrain, {})
    key = (float(ctx.max_slope_deg), ctx.unknown_policy)
    hit = per.get(key)
    if hit is None:
        passable = native_passable(terrain, ctx)
        hit = (passable, connected_components(passable))
        per[key] = hit
        while len(per) > 8:
            per.pop(next(iter(per)))
    return hit


class LegPlanner:
    def __init__(self, terrain: TerrainGrid, ctx: RoutingContext):
        self.terrain = terrain
        self.ctx = ctx
        self.geom = terrain.geometry
        self.passable, self.components = traversability(terrain, ctx)
        self.dx_rows = self.geom.dx_m_rows
        self.dy = self.geom.dy_m

    # --- endpoints -----------------------------------------------------------------------
    def snap_candidates(self, lat: float, lon: float) -> tuple[list[SnapResult], str | None]:
        """Traversable cells for an endpoint, nearest first: just its own cell when that is
        traversable, otherwise every traversable cell within endpoint_snap_m."""
        g = self.geom
        rf, cf = g.rc(lat, lon)
        r = int(min(max(round(rf), 0), g.nrows - 1))
        c = int(min(max(round(cf), 0), g.ncols - 1))
        if self.passable[r, c]:
            return [SnapResult(True, r, c, lat, lon, 0.0, (rf, cf))], None
        lim = self.ctx.config.endpoint_snap_m
        rr = int(math.ceil(lim / self.dy)) + 1
        cr = int(math.ceil(lim / float(self.dx_rows.min()))) + 1
        r0, r1 = max(0, r - rr), min(g.nrows, r + rr + 1)
        c0, c1 = max(0, c - cr), min(g.ncols, c + cr + 1)
        rows = np.arange(r0, r1)[:, None]
        cols = np.arange(c0, c1)[None, :]
        d = np.hypot((rows - rf) * self.dy, (cols - cf) * self.dx_rows[r0:r1, None])
        cand = self.passable[r0:r1, c0:c1] & (d <= lim)
        if not cand.any():
            slope = float(self.terrain.slope_deg[r, c])
            why = ("no elevation data" if not math.isfinite(slope)
                   else f"terrain slope {slope:.1f} deg exceeds the {self.ctx.max_slope_deg:g} deg limit")
            return [], f"{why}, and no traversable ground within {lim:g} m"
        idx = np.flatnonzero(cand)
        dd = d.reshape(-1)[idx]
        out = []
        for k in np.lexsort((idx, dd)):                  # nearest first; ties -> lowest row-major index
            br, bc = divmod(int(idx[k]), c1 - c0)
            br, bc = br + r0, bc + c0
            out.append(SnapResult(True, br, bc, float(g.row_lat(br)), float(g.col_lon(bc)), float(dd[k]),
                                  (float(br), float(bc))))
        return out, None

    def snap(self, lat: float, lon: float) -> SnapResult:
        cands, why = self.snap_candidates(lat, lon)
        return cands[0] if cands else SnapResult(False, reason=why)

    def _pick_connected(self, ca: list[SnapResult], cb: list[SnapResult]) -> tuple[SnapResult, SnapResult] | None:
        """Nearest start candidate that shares a component with some destination candidate, and the
        nearest such destination candidate. Avoids snapping into an isolated pocket."""
        comp_b: dict[int, SnapResult] = {}
        for s in cb:
            comp_b.setdefault(int(self.components[s.row, s.col]), s)
        for s in ca:
            hit = comp_b.get(int(self.components[s.row, s.col]))
            if hit is not None:
                return s, hit
        return None

    # --- search --------------------------------------------------------------------------
    def plan(self, a: tuple[float, float], b: tuple[float, float]) -> LegResult:
        ctx = self.ctx
        res = LegResult(False, ctx.metric, search_cell_m=round(self.geom.cell_size_m, 2))
        ca, why_a = self.snap_candidates(*a)
        cb, why_b = self.snap_candidates(*b)
        if not ca:
            res.reason, res.message = "start_not_traversable", f"Start point: {why_a}."
            return res
        if not cb:
            res.reason, res.message = "destination_not_traversable", f"Destination: {why_b}."
            return res
        pair = self._pick_connected(ca, cb)
        if pair is None:
            res.reason = "no_traversable_path"
            res.message = (f"No route exists between the points without crossing ground steeper than "
                           f"{ctx.max_slope_deg:g} deg" + (" or ground without elevation data"
                                                           if ctx.unknown_policy == "exclude" else "")
                           + " (they lie in disconnected traversable areas).")
            return res
        sa, sb = pair
        res.start_snap_m, res.goal_snap_m = sa.moved_m, sb.moved_m
        g = self.geom
        L = haversine_m(sa.lat, sa.lon, sb.lat, sb.lon, g.radius_m)
        pad = max(ctx.config.window_pad_fraction * L, ctx.config.window_pad_min_m)
        dx_min = float(self.dx_rows.min())
        while True:
            pr, pc = int(math.ceil(pad / self.dy)), int(math.ceil(pad / dx_min))
            r0, r1 = max(0, min(sa.row, sb.row) - pr), min(g.nrows, max(sa.row, sb.row) + pr + 1)
            c0, c1 = max(0, min(sa.col, sb.col) - pc), min(g.ncols, max(sa.col, sb.col) + pc + 1)
            r0, r1 = (r0, r1) if r1 - r0 >= 3 else (max(0, r1 - 3), max(3, r1))
            c0, c1 = (c0, c1) if c1 - c0 >= 3 else (max(0, c1 - 3), max(3, c1))
            full = r0 == 0 and c0 == 0 and r1 == g.nrows and c1 == g.ncols
            cells = (r1 - r0) * (c1 - c0)
            res.window_cells = cells
            if cells <= ctx.config.max_search_cells:
                out = self._native(res, sa, sb, r0, r1, c0, c1)
            else:
                out = self._coarse_to_fine(res, sa, sb, r0, r1, c0, c1)
            if out is not None:
                return out
            if full:   # unreachable in practice: same component guarantees a path on the full grid
                res.reason = "no_traversable_path"
                res.message = "No route found on the full terrain grid."
                return res
            pad *= 2.5

    def _native(self, res: LegResult, sa: SnapResult, sb: SnapResult, r0, r1, c0, c1,
                mask: np.ndarray | None = None) -> LegResult | None:
        surf = native_surface(self.terrain, self.ctx, r0, r1, c0, c1, mask)
        costs = edge_costs(surf, self.ctx)
        nx = c1 - c0
        start = (sa.row - r0) * nx + (sa.col - c0)
        goal = (sb.row - r0) * nx + (sb.col - c0)
        sr = astar(costs, start, goal, surf.dy, float(surf.dx_rows.min()), self.ctx.lower_bound_per_m)
        if sr is None:
            return None
        res.expanded += sr.expanded
        free = surf if mask is None else native_surface(self.terrain, self.ctx, r0, r1, c0, c1)
        return self._finish(res, free, sr.path, sa, sb)

    def _coarse_to_fine(self, res: LegResult, sa, sb, r0, r1, c0, c1) -> LegResult | None:
        ctx = self.ctx
        rows, cols = r1 - r0, c1 - c0
        f = max(2, int(math.ceil(math.sqrt(rows * cols / ctx.config.max_search_cells))))
        f = min(f, max(1, rows // 3), max(1, cols // 3))
        guide = guide_surface(self.terrain, ctx, r0, r1, c0, c1, f)
        gny, gnx = guide.shape
        gs = ((sa.row - r0) // f) * gnx + (sa.col - c0) // f
        gg = ((sb.row - r0) // f) * gnx + (sb.col - c0) // f
        costs = edge_costs(guide, ctx)
        sr = astar(costs, gs, gg, guide.dy, float(guide.dx_rows.min()), ctx.lower_bound_per_m)
        if sr is None:
            return None                                  # relaxation failed -> no native path here
        res.guide_factor = f
        res.expanded += sr.expanded
        coarse = np.zeros((gny, gnx), dtype=bool)
        coarse.flat[sr.path] = True
        width = max(1, ctx.config.refine_corridor_cells)
        for _attempt in range(4):
            m = coarse.copy()
            for _ in range(width):                       # dilate by one block per pass (8-neighbourhood)
                p = np.pad(m, 1)
                m = (p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
                     | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:])
            native = np.kron(m, np.ones((f, f), dtype=bool))[:rows, :cols]
            rr = np.flatnonzero(native.any(axis=1))
            cc = np.flatnonzero(native.any(axis=0))
            br0, br1 = r0 + int(rr[0]), r0 + int(rr[-1]) + 1
            bc0, bc1 = c0 + int(cc[0]), c0 + int(cc[-1]) + 1
            sub = native[br0 - r0:br1 - r0, bc0 - c0:bc1 - c0]
            out = self._native(res, sa, sb, br0, br1, bc0, bc1, mask=sub)
            if out is not None:
                out.notes.append(f"searched {rows}x{cols} cells via a {f}x{f}-block guide, then refined "
                                 f"on native {self.geom.cell_size_m:.0f} m cells in a corridor")
                return out
            if native.all():
                break
            width *= 2
        # The relaxation found a way but no corridor did: settle it exactly on the whole window.
        out = self._native(res, sa, sb, r0, r1, c0, c1)
        if out is not None:
            out.notes.append(f"searched all {rows}x{cols} native cells after corridor refinement failed")
        return out

    def _finish(self, res: LegResult, surf: SearchSurface, path: list[int], sa: SnapResult, sb: SnapResult) -> LegResult:
        ny, nx = surf.shape
        r0, c0 = surf.row0, surf.col0
        pts = [(sa.exact_rc[0] - r0, sa.exact_rc[1] - c0)]
        pts += [tuple(float(v) for v in divmod(p, nx)) for p in path]
        pts.append((sb.exact_rc[0] - r0, sb.exact_rc[1] - c0))
        ev = SegmentEvaluator(surf, self.ctx)
        if self.ctx.config.smoothing:
            pts, cost = string_pull(pts, ev, self.ctx.config.smoothing_tolerance)
        else:
            _clear, cost = polyline_cost(pts, ev)
        geo = surf.geometry
        res.points = [(float(geo.row_lat(r)), float(geo.col_lon(c))) for r, c in pts]
        res.cost = cost
        res.ok = True
        return res


def direct_line_stats(terrain: TerrainGrid, ctx: RoutingContext, a: tuple[float, float], b: tuple[float, float]) -> dict:
    """What the straight line a -> b would cross (reference only - not a route)."""
    from .smoothing import supercover
    g = terrain.geometry
    L = haversine_m(a[0], a[1], b[0], b[1], g.radius_m)
    pa, pb = g.rc(*a), g.rc(*b)
    slope_grid = terrain.slope_deg
    prohibited = unknown = 0.0
    smax = -math.inf
    for i, j, t0, t1 in supercover(pa, pb):        # exact cell-by-cell crossing lengths
        if not (0 <= i < g.nrows and 0 <= j < g.ncols):
            continue
        s = float(slope_grid[i, j])
        piece = (t1 - t0) * L
        if not math.isfinite(s):
            unknown += piece
            continue
        smax = max(smax, s)
        if s > ctx.max_slope_deg:
            prohibited += piece
    return {
        "distance_m": round(L, 1),
        "max_terrain_slope_deg": round(smax, 1) if math.isfinite(smax) else None,
        "prohibited_length_m": round(prohibited, 1),
        "unknown_length_m": round(unknown, 1),
        "note": "Straight line for reference only; it is not a planned route.",
    }
