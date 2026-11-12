"""Path straightening ("string pulling") for 8-connected grid paths.

An 8-connected path can only turn in 45 degree steps, which makes open-ground routes zig-zag and
up to ~8% longer than the real walk. After A*, each vertex is joined to the farthest later vertex
that a straight line can reach when

  1. every cell the straight line touches is traversable - checked with an exact supercover
     traversal (Amanatides & Woo 1987); a line passing exactly through a cell corner must clear
     both cells beside the corner, matching the no-corner-cutting rule of the graph, and
  2. the straight line costs no more (same metric, same cell penalties) than the grid path it
     replaces, times (1 + smoothing_tolerance).

Both sides of test 2 are measured with the same evaluator: the line is cut into the pieces that
lie inside each cell and every piece is charged length x that cell's penalty factor (terrain),
plain length (distance), or length / v(grade) with grade from bilinear elevation (time).
Straightening therefore never increases route cost and never enters prohibited ground.
"""
from __future__ import annotations

import math

from .costs import RoutingContext, SearchSurface, cell_penalty_factor

EPS = 1e-12


def supercover(p: tuple[float, float], q: tuple[float, float]):
    """Cells crossed by segment p -> q in (row, col) coordinates (cell centres at integers).

    Yields (row, col, t0, t1): the parameter interval [t0, t1] of the segment inside that cell.
    Corner-touch cells are yielded with t0 == t1."""
    R0, C0 = p[0] + 0.5, p[1] + 0.5
    R1, C1 = q[0] + 0.5, q[1] + 0.5
    dr, dc = R1 - R0, C1 - C0
    i, j = math.floor(R0), math.floor(C0)
    ie, je = math.floor(R1), math.floor(C1)
    sr = 1 if dr > 0 else -1 if dr < 0 else 0
    sc = 1 if dc > 0 else -1 if dc < 0 else 0
    t_max_r = ((i + 1 - R0) / dr if dr > 0 else (R0 - i) / -dr) if sr else math.inf
    t_max_c = ((j + 1 - C0) / dc if dc > 0 else (C0 - j) / -dc) if sc else math.inf
    t_dr = abs(1.0 / dr) if sr else math.inf
    t_dc = abs(1.0 / dc) if sc else math.inf
    t = 0.0
    guard = abs(ie - i) + abs(je - j) + 4
    for _ in range(guard * 2 + 4):
        t_next = min(t_max_r, t_max_c, 1.0)
        yield i, j, t, t_next
        if t_next >= 1.0 or (i == ie and j == je):
            return
        if abs(t_max_r - t_max_c) <= 1e-9:       # through a corner: both side cells are touched
            yield i + sr, j, t_next, t_next
            yield i, j + sc, t_next, t_next
            i += sr
            j += sc
            t_max_r += t_dr
            t_max_c += t_dc
        elif t_max_r < t_max_c:
            i += sr
            t_max_r += t_dr
        else:
            j += sc
            t_max_c += t_dc
        t = t_next


class SegmentEvaluator:
    def __init__(self, surf: SearchSurface, ctx: RoutingContext):
        self.surf = surf
        self.ctx = ctx
        self.F = cell_penalty_factor(surf, ctx)
        self.dx = surf.dx_rows
        self.dy = surf.dy
        self.ny, self.nx = surf.shape
        self.tan_max = math.tan(math.radians(ctx.max_slope_deg))

    def _z(self, r: float, c: float) -> float:
        e = self.surf.elev
        r = min(max(r, 0.0), self.ny - 1.0)
        c = min(max(c, 0.0), self.nx - 1.0)
        r0 = min(int(r), self.ny - 2)
        c0 = min(int(c), self.nx - 2)
        fr, fc = r - r0, c - c0
        return ((e[r0, c0] * (1 - fc) + e[r0, c0 + 1] * fc) * (1 - fr)
                + (e[r0 + 1, c0] * (1 - fc) + e[r0 + 1, c0 + 1] * fc) * fr)

    def evaluate(self, p, q) -> tuple[bool, float]:
        """(clear, cost) of the straight segment p -> q (fractional row/col)."""
        dr, dc = q[0] - p[0], q[1] - p[1]
        if abs(dr) < EPS and abs(dc) < EPS:
            return True, 0.0
        pas = self.surf.passable
        metric = self.ctx.metric
        total = 0.0
        for i, j, t0, t1 in supercover(p, q):
            if not (0 <= i < self.ny and 0 <= j < self.nx) or not pas[i, j]:
                return False, math.inf
            if t1 - t0 <= EPS:
                continue
            ln = (t1 - t0) * math.hypot(dr * self.dy, dc * self.dx[i])
            if metric == "distance":
                total += ln
            elif metric == "terrain":
                total += ln * self.F[i, j]
            else:
                za = self._z(p[0] + dr * t0, p[1] + dc * t0)
                zb = self._z(p[0] + dr * t1, p[1] + dc * t1)
                g = (zb - za) / ln if (za == za and zb == zb) else self.tan_max
                total += float(self.ctx.mobility.minutes(ln, g))
        return True, total


def _compress(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Drop interior vertices in the middle of straight runs (geometry unchanged)."""
    if len(points) <= 2:
        return points
    out = [points[0]]
    for a, b, c in zip(points, points[1:], points[2:]):
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        if abs(cross) > 1e-9 or dot < 0:
            out.append(b)
    out.append(points[-1])
    return out


def string_pull(points: list[tuple[float, float]], evaluator: SegmentEvaluator,
                tolerance: float = 0.0, lookahead: int = 96) -> tuple[list[tuple[float, float]], float]:
    """Straighten a polyline whose consecutive segments are all clear. Returns (points, cost)."""
    pts = _compress(points)
    n = len(pts)
    seg_cost = []
    for a, b in zip(pts, pts[1:]):
        _clear, c = evaluator.evaluate(a, b)
        seg_cost.append(c)
    prefix = [0.0]
    for c in seg_cost:
        prefix.append(prefix[-1] + c)
    out = [pts[0]]
    total = 0.0
    i = 0
    while i < n - 1:
        best_j, best_c = i + 1, seg_cost[i]
        for j in range(min(n - 1, i + lookahead), i + 1, -1):
            clear, c = evaluator.evaluate(pts[i], pts[j])
            if clear and c <= (prefix[j] - prefix[i]) * (1.0 + tolerance) + 1e-9:
                best_j, best_c = j, c
                break
        out.append(pts[best_j])
        total += best_c
        i = best_j
    return out, total


def polyline_cost(points: list[tuple[float, float]], evaluator: SegmentEvaluator) -> tuple[bool, float]:
    total, clear = 0.0, True
    for a, b in zip(points, points[1:]):
        ok, c = evaluator.evaluate(a, b)
        clear &= ok
        total += c
    return clear, total


def cells_to_points(path: list[int], nx: int) -> list[tuple[float, float]]:
    return [tuple(float(v) for v in divmod(p, nx)) for p in path]


__all__ = ["supercover", "SegmentEvaluator", "string_pull", "polyline_cost", "cells_to_points"]
