import math

import pytest

from marga_engine.geodesy import (MARS_RADIUS_M, compass_point, haversine_m, initial_bearing_deg, lon_delta,
                                  normalize_lon)


def test_one_degree_on_equator():
    assert haversine_m(0, 0, 0, 1) == pytest.approx(MARS_RADIUS_M * math.pi / 180, rel=1e-12)


def test_meridian_degree_is_latitude_independent():
    assert haversine_m(-4.5, 137.4, -5.5, 137.4) == pytest.approx(MARS_RADIUS_M * math.pi / 180, rel=1e-12)


def test_longitude_degree_shrinks_with_cos_lat():
    d = haversine_m(60, 10, 60, 10.001)
    assert d == pytest.approx(MARS_RADIUS_M * math.radians(0.001) * math.cos(math.radians(60)), rel=1e-6)


def test_antimeridian_wrap():
    assert haversine_m(0, 179.9, 0, -179.9) == pytest.approx(haversine_m(0, 0, 0, 0.2), rel=1e-9)
    assert lon_delta(-179.9, 179.9) == pytest.approx(0.2)


def test_normalize_lon_accepts_0_360():
    assert normalize_lon(137.4) == pytest.approx(137.4)
    assert normalize_lon(360 + 137.4) == pytest.approx(137.4)
    assert normalize_lon(200) == pytest.approx(-160)


def test_bearings():
    assert initial_bearing_deg(0, 0, 1, 0) == pytest.approx(0)
    assert initial_bearing_deg(0, 0, 0, 1) == pytest.approx(90)
    assert initial_bearing_deg(0, 0, -1, 0) == pytest.approx(180)
    assert compass_point(225) == "SW"
