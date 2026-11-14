"""A*, costs, straightening and leg planning on artificial grids with known answers (spec 23.3)."""
import math

import numpy as np
import pytest

from conftest import ll, make_ctx
from marga_engine.config import DEFAULT_CONFIG
from marga_engine.geodesy import haversine_m
from marga_engine.routing.astar import astar, dijkstra_field, octile_factory
from marga_engine.routing.costs import MOVES, edge_costs, native_surface
from marga_engine.routing.planner import LegPlanner, direct_line_stats
from marga_engine.routing.smoothing import supercover
from marga_engine.terrain import synthetic
from marga_engine.terrain.grid import TerrainGrid


def grid_from(elev, cell=20.0):
    return synthetic.from_array(np.asarray(elev, dtype=np.float32), cell)


def wall_grid(ny=41, nx=41, wall_col=20, gap_rows=(), height=200.0, cell=20.0):
    """Flat plain with a vertical cliff band (prohibited) at wall_col, optional gap rows."""
    e = np.full((ny, nx), -4500.0)
    e[:, wall_col:wall_col + 3] += height
    for r in gap_rows:
        e[r - 2:r + 3, :] = -4500.0
    return grid_from(e, cell)


def path_cells_ok(terrain, ctx, points):
    """Every cell touched by the polyline is traversable at native resolution."""
    surf = native_surface(terrain, ctx, 0, terrain.geometry.nrows, 0, terrain.geometry.ncols)
    for p, q in zip(points, points[1:]):
        for i, j, _t0, _t1 in supercover(terrain.geometry.rc(*p), terrain.geometry.rc(*q)):
            if not surf.passable[i, j]:
                return False
    return True


def polyline_len(points):
    return sum(haversine_m(p[0], p[1], q[0], q[1]) for p, q in zip(points, points[1:]))


# --- A* core -----------------------------------------------------------------------------------

def test_flat_grid_astar_cost_is_octile_distance():
    t = synthetic.flat(30, 40, 20.0)
    ctx = make_ctx(t, "distance")
    surf = native_surface(t, ctx, 0, 30, 0, 40)
    costs = edge_costs(surf, ctx)
    start, goal = 2 * 40 + 3, 25 * 40 + 37
    r = astar(costs, start, goal, surf.dy, float(surf.dx_rows.min()), 1.0)
    lo = octile_factory(40, surf.dy, float(surf.dx_rows.min()), goal, 1.0)(start)
    hi = octile_factory(40, surf.dy, float(surf.dx_rows.max()), goal, 1.0)(start)
    assert lo - 1e-9 <= r.cost <= hi + 1e-9                 # dx varies with cos(latitude) per row
    assert hi - lo < 0.01
    assert r.path[0] == start and r.path[-1] == goal


@pytest.mark.parametrize("metric", ["distance", "terrain", "time"])
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_astar_matches_dijkstra_on_random_terrain(metric, seed):
    rng = np.random.default_rng(seed)
    e = -4500 + np.cumsum(np.cumsum(rng.normal(0, 1.5, (35, 45)), axis=0), axis=1) * 0.3
    t = grid_from(e, 15.0)
    ctx = make_ctx(t, metric, max_slope=18.0)
    surf = native_surface(t, ctx, 0, 35, 0, 45)
    costs = edge_costs(surf, ctx)
    passable = np.flatnonzero(surf.passable.reshape(-1))
    start, goal = int(passable[0]), int(passable[-1])
    field = dijkstra_field(costs, start)
    r = astar(costs, start, goal, surf.dy, float(surf.dx_rows.min()), ctx.lower_bound_per_m)
    if math.isinf(field.reshape(-1)[goal]):
        assert r is None
    else:
        assert r.cost == pytest.approx(field.reshape(-1)[goal], rel=1e-9)


@pytest.mark.parametrize("metric", ["distance", "terrain", "time"])
def test_heuristic_is_consistent_on_every_edge(metric):
    rng = np.random.default_rng(7)
    e = -4500 + rng.normal(0, 2.0, (20, 25))
    t = grid_from(e, 10.0)
    ctx = make_ctx(t, metric, max_slope=25)
    surf = native_surface(t, ctx, 0, 20, 0, 25)
    costs = edge_costs(surf, ctx)
    goal = 17 * 25 + 21
    h = octile_factory(25, surf.dy, float(surf.dx_rows.min()), goal, ctx.lower_bound_per_m)
    for k, (di, dj) in enumerate(MOVES):
        for u in range(20 * 25):
            c = costs[k].reshape(-1)[u]
            if math.isfinite(c):
                v = u + di * 25 + dj
                assert h(u) <= c + h(v) + 1e-9


def test_no_corner_cutting_between_diagonal_obstacles():
    e = np.full((5, 5), -4500.0)
    t = grid_from(e)
    ctx = make_ctx(t, "distance")
    surf = native_surface(t, ctx, 0, 5, 0, 5)
    surf.passable[1, 2] = False
    surf.passable[2, 1] = False
    costs = edge_costs(surf, ctx)
    k = MOVES.index((1, 1))
    assert math.isinf(costs[k][1, 1])                       # (1,1) -> (2,2) squeezes between blocks
    k2 = MOVES.index((-1, -1))
    assert math.isinf(costs[k2][2, 2])
    assert math.isfinite(costs[MOVES.index((1, 1))][0, 0])  # unrelated diagonal still fine


def test_astar_is_deterministic():
    rng = np.random.default_rng(11)
    e = -4500 + rng.normal(0, 0.5, (40, 40))
    t = grid_from(e)
    ctx = make_ctx(t)
    surf = native_surface(t, ctx, 0, 40, 0, 40)
    costs = edge_costs(surf, ctx)
    a = astar(costs, 0, 40 * 40 - 1, surf.dy, float(surf.dx_rows.min()), 1.0)
    b = astar(costs, 0, 40 * 40 - 1, surf.dy, float(surf.dx_rows.min()), 1.0)
    assert a.path == b.path and a.cost == b.cost


def test_reverse_field_equals_forward_costs_for_time_metric():
    t = synthetic.tilted_plane(15, 15, 20.0, 8.0, 0)       # uphill to the north -> asymmetric times
    ctx = make_ctx(t, "time")
    surf = native_surface(t, ctx, 0, 15, 0, 15)
    costs = edge_costs(surf, ctx)
    hab = 7 * 15 + 7
    back = dijkstra_field(costs, hab, reverse=True)       # time from every cell TO the habitat
    for cell in (0, 14, 200, 224):
        fwd = dijkstra_field(costs, cell)                 # time from cell to everywhere
        assert back.reshape(-1)[cell] == pytest.approx(fwd.reshape(-1)[hab], rel=1e-12)
    out = dijkstra_field(costs, hab)
    assert out.reshape(-1)[0] != pytest.approx(back.reshape(-1)[0])   # uphill != downhill


# --- planner -----------------------------------------------------------------------------------

def test_route_never_crosses_prohibited_cells_and_uses_the_gap():
    t = wall_grid(gap_rows=(33,))
    ctx = make_ctx(t)
    a, b = ll(t, 5, 5), ll(t, 5, 35)
    r = LegPlanner(t, ctx).plan(a, b)
    assert r.ok
    assert path_cells_ok(t, ctx, r.points)
    rows = [t.geometry.rc(*p)[0] for p in r.points]
    assert max(rows) >= 30                                  # had to go down to the gap
    ds = direct_line_stats(t, ctx, a, b)
    assert ds["prohibited_length_m"] > 0


def test_steep_region_is_prohibited_by_slope_limit():
    # 12 deg ramp band crossing the grid: allowed at limit 15, prohibited at limit 10
    e = np.full((31, 31), -4500.0)
    rise = math.tan(math.radians(12)) * 20.0
    e[:, 12:19] += np.arange(1, 8) * rise
    e[:, 19:] += 7 * rise
    t = grid_from(e)
    a, b = ll(t, 15, 3), ll(t, 15, 27)
    assert LegPlanner(t, make_ctx(t, max_slope=15)).plan(a, b).ok
    blocked = LegPlanner(t, make_ctx(t, max_slope=10)).plan(a, b)
    assert not blocked.ok and blocked.reason == "no_traversable_path"


def test_destination_with_no_valid_route():
    e = np.full((41, 41), -4500.0)
    yy, xx = np.indices(e.shape)
    ring = (np.hypot(yy - 20, xx - 20) > 6) & (np.hypot(yy - 20, xx - 20) < 9)
    e[ring] += 300.0
    t = grid_from(e)
    r = LegPlanner(t, make_ctx(t)).plan(ll(t, 2, 2), ll(t, 20, 20))
    assert not r.ok and r.reason == "no_traversable_path"


def test_terrain_aware_route_goes_around_a_hill_that_shortest_route_crosses():
    ny, nx = 61, 81
    yy, xx = np.indices((ny, nx))
    e = -4500 + 60.0 * np.exp(-(((yy - 30) ** 2 + (xx - 40) ** 2) / (2 * 9.0 ** 2)))   # max ~8 deg flanks
    t = grid_from(e)
    a, b = ll(t, 30, 5), ll(t, 30, 75)
    rd = LegPlanner(t, make_ctx(t, "distance")).plan(a, b)
    rt = LegPlanner(t, make_ctx(t, "terrain")).plan(a, b)
    assert rd.ok and rt.ok
    assert polyline_len(rd.points) < polyline_len(rt.points)
    slope_on = lambda pts: float(np.nanmax(t.sample_nearest(t.slope_deg,
                                 *zip(*[(p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s)
                                        for p, q in zip(pts, pts[1:]) for s in np.linspace(0, 1, 50)]))))
    assert slope_on(rt.points) < slope_on(rd.points)


def test_straightening_gives_great_circle_on_open_ground():
    t = synthetic.flat(60, 90, 20.0)
    a, b = ll(t, 7.3, 4.6), ll(t, 51.2, 83.9)
    r = LegPlanner(t, make_ctx(t)).plan(a, b)
    assert len(r.points) == 2
    assert polyline_len(r.points) == pytest.approx(haversine_m(*a, *b), rel=1e-9)


def test_straightening_never_increases_cost():
    rng = np.random.default_rng(5)
    e = -4500 + np.cumsum(rng.normal(0, 2.0, (50, 50)), axis=1)
    t = grid_from(e)
    a, b = ll(t, 3, 3), ll(t, 46, 46)
    no = LegPlanner(t, make_ctx(t, cfg=DEFAULT_CONFIG.with_overrides(smoothing=False))).plan(a, b)
    yes = LegPlanner(t, make_ctx(t)).plan(a, b)
    assert yes.cost <= no.cost + 1e-9
    assert path_cells_ok(t, make_ctx(t), yes.points)


def test_window_escalation_finds_far_detour():
    # Wall across the grid with the only gap far outside the initial search window
    t = wall_grid(ny=401, nx=60, wall_col=28, gap_rows=(390,), cell=10.0)
    ctx = make_ctx(t)
    r = LegPlanner(t, ctx).plan(ll(t, 20, 20), ll(t, 20, 40))
    assert r.ok and path_cells_ok(t, ctx, r.points)


@pytest.mark.parametrize("cells", [20_000, 6_000])
def test_coarse_to_fine_matches_native_search(demo, cells):
    a, b = (-4.5895, 137.4417), (-4.74, 137.33)
    native = LegPlanner(demo, make_ctx(demo)).plan(a, b)
    cfg = DEFAULT_CONFIG.with_overrides(max_search_cells=cells)
    c2f = LegPlanner(demo, make_ctx(demo, cfg=cfg)).plan(a, b)
    assert c2f.ok and c2f.guide_factor > 1
    assert c2f.cost == pytest.approx(native.cost, rel=0.02)
    assert path_cells_ok(demo, make_ctx(demo), c2f.points)


def test_endpoint_on_cliff_is_snapped_and_reported():
    t = wall_grid(gap_rows=(33,))
    ctx = make_ctx(t)
    target = ll(t, 5, 20)                                   # cliff face (prohibited)
    r = LegPlanner(t, ctx).plan(ll(t, 5, 5), target)
    # nearest traversable cell is the enclosed band top (col 21, 20 m) - an isolated pocket;
    # the connected choice is the plain at col 18, 40 m away
    assert r.ok and r.goal_snap_m == pytest.approx(40.0, rel=0.01)
    assert path_cells_ok(t, ctx, r.points)
    far = LegPlanner(t, make_ctx(t, cfg=DEFAULT_CONFIG.with_overrides(endpoint_snap_m=5.0))).plan(ll(t, 5, 5), target)
    assert not far.ok and far.reason == "destination_not_traversable"


def test_unknown_cells_excluded_by_default_and_penalised_otherwise():
    e = np.full((41, 41), -4500.0)
    e[:, 18:23] = np.nan                                    # data gap across the whole grid
    t = grid_from(e)
    a, b = ll(t, 20, 5), ll(t, 20, 35)
    assert not LegPlanner(t, make_ctx(t)).plan(a, b).ok      # exclude: cannot cross a gap
    pen = LegPlanner(t, make_ctx(t, policy="penalize")).plan(a, b)
    assert pen.ok
    # crossing unknown ground is charged as worst-allowed slope plus the uncertainty weight
    w = DEFAULT_CONFIG.weights
    assert pen.cost > polyline_len(pen.points) * 1.0
    assert pen.cost >= (polyline_len(pen.points) - 7 * 20.0) + 5 * 20.0 * (1 + w.slope + w.uncertainty) - 1


def test_missing_data_is_not_treated_as_flat():
    """A small hole on an otherwise flat plain: penalize policy detours around it if cheap."""
    e = np.full((41, 41), -4500.0)
    e[18:23, 18:23] = np.nan
    t = grid_from(e)
    ctx = make_ctx(t, policy="penalize")
    r = LegPlanner(t, ctx).plan(ll(t, 20, 3), ll(t, 20, 37))
    assert r.ok
    lat, lon = zip(*[(p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s)
                     for p, q in zip(r.points, r.points[1:]) for s in np.linspace(0, 1, 200)])
    assert np.isfinite(t.sample_nearest(t.slope_deg, lat, lon)).all()


def test_connected_components_match_reachability():
    from marga_engine.routing.planner import connected_components
    t = wall_grid(gap_rows=(33,))
    p = LegPlanner(t, make_ctx(t))
    lab = p.components
    assert lab[5, 5] == lab[5, 35] != 0                     # joined through the gap
    assert lab[5, 21] != lab[5, 5]                          # band top is its own pocket
    m = np.array([[1, 0, 1], [0, 1, 0], [1, 0, 1]], dtype=bool)
    assert len(set(connected_components(m)[m].tolist())) == 5   # diagonal-only contacts never connect


def test_disconnected_target_reported_without_search():
    e = np.full((41, 41), -4500.0)
    yy, xx = np.indices(e.shape)
    e[(np.hypot(yy - 20, xx - 20) > 6) & (np.hypot(yy - 20, xx - 20) < 9)] += 300.0
    t = grid_from(e)
    r = LegPlanner(t, make_ctx(t)).plan(ll(t, 2, 2), ll(t, 20, 20))
    assert r.reason == "no_traversable_path" and r.expanded == 0


def test_planner_rejects_bad_context():
    t = synthetic.flat()
    from marga_engine.errors import InvalidInputError
    with pytest.raises(InvalidInputError):
        make_ctx(t, metric="fastest")
    with pytest.raises(InvalidInputError):
        make_ctx(t, max_slope=0)


_ = TerrainGrid


@pytest.mark.parametrize("metric", ["terrain", "distance", "time"])
def test_random_demo_routes_respect_constraints(demo, metric):
    """Property check on the demo terrain: every returned route stays on traversable native cells,
    its reported distance equals the haversine length of its polyline, and the response's own
    EVA arithmetic is consistent."""
    from marga_engine import plan_route
    from conftest import base_request
    rng = np.random.default_rng(1453)
    g = demo.geometry
    ctx = make_ctx(demo, metric)
    checked = 0
    for _ in range(12):
        a = ll(demo, rng.uniform(5, g.nrows - 5), rng.uniform(5, g.ncols - 5))
        b = ll(demo, rng.uniform(5, g.nrows - 5), rng.uniform(5, g.ncols - 5))
        req = base_request(a, b, maxDistanceMeters=50_000)
        req["options"] = {"metric": metric, "compute_alternatives": False}
        r = plan_route(req, demo)
        if not r["coordinates"]:
            assert r["status"] == "unreachable" and r["status_reason"] in (
                "no_traversable_path", "start_not_traversable", "destination_not_traversable")
            continue
        pts = [(lat, lon) for lon, lat in r["coordinates"]]
        assert path_cells_ok(demo, ctx, pts)
        assert r["distance_m"] == pytest.approx(polyline_len(pts), abs=1.0)
        e = r["eva_assessment"]
        assert e["return_margin_min"] == pytest.approx(
            e["eva_duration_min"] - e["outbound_min"] - e["science_min"] - e["return_min"] - e["reserve_min"], abs=0.2)
        ret = [(lat, lon) for lon, lat in r["return_route"]["coordinates"]]
        assert path_cells_ok(demo, ctx, ret)
        checked += 1
    assert checked >= 8
