"""Terrain package sanity checks: fill values, catalogue comparison, and the explicit no-data override."""
import math

import numpy as np
import pytest

from conftest import REPO
from marga_engine.terrain.grid import GridGeometry, TerrainGrid, TerrainMetadata
from marga_engine.terrain.package import import_geotiff
from marga_engine.terrain.validate import check_terrain, load_targets
from test_terrain import _write_geotiff


def _grid(z):
    g = GridGeometry(north_lat=-4.45, west_lon=137.20, dlat_deg=0.0002, dlon_deg=0.0002,
                     nrows=z.shape[0], ncols=z.shape[1])
    return TerrainGrid(z, g, TerrainMetadata(dataset_id="T", name="test DEM"))


def _rough_surface(n=120, seed=3):
    rng = np.random.default_rng(seed)
    r, c = np.mgrid[0:n, 0:n]
    return (-4500 + 0.8 * r + 0.3 * c + rng.normal(0, 0.7, (n, n))).astype(np.float64)


def test_clean_dem_has_no_fill_warnings():
    rep = check_terrain(_grid(_rough_surface()))
    assert rep.valid_fraction == 1.0
    assert not any("fill" in w for w in rep.warnings)
    assert rep.exact_zero_cells == 0


def test_zero_filled_gap_is_reported_even_though_it_looks_valid():
    z = _rough_surface()
    z[:, :18] = 0.0                                   # uncovered strip written as 0 with no no-data tag
    rep = check_terrain(_grid(z))
    assert rep.valid_fraction == 1.0                  # looks complete ...
    assert rep.most_common_value == 0.0 and rep.most_common_share > 0.1
    text = " ".join(rep.warnings)
    assert "--nodata 0" in text and "exactly 0 m" in text   # ... but the checker says why it is not


def test_targets_are_compared_with_the_dem(demo):
    rep = check_terrain(demo, [("cat.json", {"id": "a", "name": "A", "latitude": -4.60, "longitude": 137.42,
                                             "elevation_m": -1000.0}),
                               ("cat.json", {"id": "b", "name": "B", "latitude": 10.0, "longitude": 10.0,
                                             "elevation_m": -4500.0})])
    a, b = rep.targets
    assert a.dem_elevation_m is not None and abs(a.diff_m) > 50 and "differs" in a.note
    assert b.note == "outside the package"
    assert any("target(s) need a look" in w for w in rep.warnings)


def test_repo_target_lists_load():
    ids = {t["id"] for _, t in load_targets(REPO)}
    assert {"target_bradbury", "target_murray_buttes"} <= ids     # catalogue + frontend mock data


def test_explicit_nodata_value_masks_an_undeclared_fill(tmp_path):
    pytest.importorskip("tifffile")
    arr = np.full((20, 30), -4500.0, dtype=np.float32)
    arr[:, :5] = 0.0                                   # fill without a GDAL_NODATA tag
    keys = [(1024, 0, 1, 2), (1025, 0, 1, 1), (2057, 34736, 1, 0)]
    p = tmp_path / "fill.tif"
    _write_geotiff(p, arr, model=2, pixel_scale=(0.0003, 0.0003, 0), tiepoint=(0, 0, 0, 137.2, -4.45, 0),
                   keys=keys, doubles=[3396190.0])
    md = TerrainMetadata(dataset_id="T", name="fill test")
    assert not np.isnan(import_geotiff(p, md).elevation).any()
    masked = import_geotiff(p, md, nodata_value=0.0).elevation
    assert np.isnan(masked[:, :5]).all() and not np.isnan(masked[:, 5:]).any()
    assert math.isclose(float(np.nanmean(masked)), -4500.0)
