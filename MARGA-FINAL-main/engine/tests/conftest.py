import sys
from pathlib import Path

import numpy as np
import pytest

ENGINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE))

from marga_engine.config import DEFAULT_CONFIG  # noqa: E402
from marga_engine.eva.mobility import MobilityModel  # noqa: E402
from marga_engine.routing.costs import RoutingContext  # noqa: E402
from marga_engine.terrain import synthetic  # noqa: E402

REPO = ENGINE.parent


def make_ctx(terrain, metric="terrain", max_slope=15.0, cfg=DEFAULT_CONFIG, speed=1.2, policy=None):
    rough, note = terrain.roughness_layer(cfg.roughness_max_cell_m)
    return RoutingContext(metric, max_slope, cfg.weights, policy or cfg.unknown_policy, MobilityModel(speed),
                          cfg, rough, note)


def base_request(a, b, **constraints):
    c = {"walkingSpeedKmh": 1.2, "maxSlopeDegrees": 15, "maxEvaHours": 8.0, "reserveEvaHours": 1.5,
         "maxDistanceMeters": 20000}
    c.update(constraints)
    return {"start": {"latitude": a[0], "longitude": a[1], "name": "Habitat"},
            "destination": {"latitude": b[0], "longitude": b[1], "name": "Target"},
            "constraints": c}


def ll(terrain, r, c):
    g = terrain.geometry
    return float(g.row_lat(r)), float(g.col_lon(c))


@pytest.fixture(scope="session")
def demo():
    return synthetic.gale_demo()


@pytest.fixture
def rng():
    return np.random.default_rng(20261109)
