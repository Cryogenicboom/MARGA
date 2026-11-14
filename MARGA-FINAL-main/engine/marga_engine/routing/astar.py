"""A* and Dijkstra over the 8-connected cost tensor from routing.costs.

    f(n) = g(n) + h(n)

g(n) is the accumulated edge cost from the start. h(n) is an ANISOTROPIC OCTILE distance to the
goal times the smallest possible cost per metre:

    a = |dcol|, b = |drow|
    octile = min(a, b) * hypot(dy, dx_min) + (a - b) * dx_min   if a >= b
                                           + (b - a) * dy       otherwise
    h(n) = lower_bound_per_m * octile

dx_min is the smallest east-west spacing in the grid. Every edge is at least as long as the
corresponding octile step and costs at least `lower_bound_per_m` per metre, and octile distance
obeys the triangle inequality on the lattice, so h is admissible AND consistent: the first time
the goal is popped its cost is optimal, and each node needs expanding only once.

Determinism: heap entries are (f, h, insertion counter, node). Ties prefer the node nearer the
goal, then the earlier insertion, so the same inputs always give the same path.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

from .costs import MOVES, OPPOSITE

INF = math.inf


@dataclass
class SearchResult:
    path: list[int]      # flat indices start .. goal
    cost: float
    expanded: int


def octile_factory(nx: int, dy: float, dx_min: float, goal: int, scale: float):
    gi, gj = divmod(goal, nx)
    diag = math.hypot(dy, dx_min)

    def h(n: int) -> float:
        i, j = divmod(n, nx)
        b, a = abs(i - gi), abs(j - gj)
        if a >= b:
            return scale * (b * diag + (a - b) * dx_min)
        return scale * (a * diag + (b - a) * dy)
    return h


def astar(costs: np.ndarray, start: int, goal: int, dy: float, dx_min: float, scale: float) -> SearchResult | None:
    _, ny, nx = costs.shape
    n = ny * nx
    if not (0 <= start < n and 0 <= goal < n):
        raise ValueError("start/goal outside the search grid")
    flat = [memoryview(np.ascontiguousarray(costs[k]).reshape(-1)) for k in range(8)]
    offs = [di * nx + dj for di, dj in MOVES]
    h = octile_factory(nx, dy, dx_min, goal, scale)
    g = [INF] * n
    came = [-1] * n
    closed = bytearray(n)
    g[start] = 0.0
    h0 = h(start)
    heap = [(h0, h0, 0, start)]
    counter = 1
    expanded = 0
    while heap:
        _f, _h, _c, u = heapq.heappop(heap)
        if closed[u]:
            continue
        if u == goal:
            path = [u]
            while path[-1] != start:
                path.append(came[path[-1]])
            path.reverse()
            return SearchResult(path, g[goal], expanded)
        closed[u] = 1
        expanded += 1
        gu = g[u]
        for k in range(8):
            c = flat[k][u]
            if c == INF:
                continue
            v = u + offs[k]
            if closed[v]:
                continue
            nv = gu + c
            if nv < g[v]:
                g[v] = nv
                came[v] = u
                hv = h(v)
                heapq.heappush(heap, (nv + hv, hv, counter, v))
                counter += 1
    return None


def dijkstra_field(costs: np.ndarray, source: int, reverse: bool = False, max_cost: float = INF) -> np.ndarray:
    """Cost of the cheapest path between `source` and every cell (inf where unreachable).

    reverse=False : cost source -> cell.
    reverse=True  : cost cell -> source (uses the opposite edge, which matters for the
                    direction-dependent 'time' metric). This is the return-to-habitat field.
    """
    _, ny, nx = costs.shape
    n = ny * nx
    flat = [memoryview(np.ascontiguousarray(costs[k]).reshape(-1)) for k in range(8)]
    offs = [di * nx + dj for di, dj in MOVES]
    dist = [INF] * n
    dist[source] = 0.0
    done = bytearray(n)
    heap = [(0.0, 0, source)]
    counter = 1
    while heap:
        d, _c, u = heapq.heappop(heap)
        if done[u]:
            continue
        done[u] = 1
        if d > max_cost:
            break
        for k in range(8):
            if reverse:
                # walker moves v -> u where v = u + offs[k]; that move leaves v in direction OPPOSITE[k]
                c0 = flat[k][u]          # u -> v exists iff v is in-grid & passable (edges are symmetric in existence)
                if c0 == INF:
                    continue
                v = u + offs[k]
                c = flat[OPPOSITE[k]][v]
            else:
                c = flat[k][u]
                if c == INF:
                    continue
                v = u + offs[k]
            if c == INF or done[v]:
                continue
            nd = d + c
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, counter, v))
                counter += 1
    out = np.array(dist, dtype=np.float64).reshape(ny, nx)
    if max_cost < INF:
        out[out > max_cost] = INF
    return out
