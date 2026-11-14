import math

import numpy as np
import pytest

from marga_engine.errors import CoverageError, TerrainDataError
from marga_engine.terrain import synthetic
from marga_engine.terrain.analysis import detrended_roughness, slope_class
from marga_engine.terrain.grid import GridGeometry, TerrainGrid, TerrainMetadata
from marga_engine.terrain.package import import_geotiff, load_package, save_package


@pytest.mark.parametrize("slope,az", [(0.0, 0), (5.0, 0), (10.0, 45), (20.0, 135), (30.0, 270)])
def test_horn_slope_exact_on_planes_including_edges(slope, az):
    t = synthetic.tilted_plane(25, 31, 20.0, slope, az)
    s = t.slope_deg
    assert np.nanmax(np.abs(s - slope)) < 2e-3          # float32 elevations; edges included


def test_slope_uses_true_dx_at_high_latitude():
    # Same metric plane at 60 deg latitude: a geographic grid has dx = R cos(lat) dlon
    g = synthetic.geometry_for(21, 21, 25.0, center_lat=60.0)
    x = np.cumsum(np.broadcast_to(g.dx_m_rows[:, None], (21, 21)), axis=1)
    z = math.tan(math.radians(12.0)) * x
    t = TerrainGrid(z.astype(np.float32), g, synthetic.synthetic_metadata("SYNTH-HL", "hl", 25.0))
    assert np.nanmax(np.abs(t.slope_deg - 12.0)) < 5e-3


def test_no_data_makes_neighbourhood_unknown_not_flat():
    t = synthetic.flat(15, 15, 20.0)
    e = t.elevation.copy()
    e[7, 7] = np.nan
    g = TerrainGrid(e, t.geometry, t.metadata)
    s = g.slope_deg
    assert np.isnan(s[6:9, 6:9]).all()
    assert np.isfinite(s[0:5, 0:5]).all() and (s[0:5, 0:5] == 0).all()
    assert slope_class(float("nan")) == "unknown"


def test_roughness_zero_on_plane_and_known_on_checkerboard():
    t = synthetic.tilted_plane(15, 15, 10.0, 17.0, 30)
    assert float(np.nanmax(t.dem_roughness_m)) < 1e-3
    h = 2.0
    cb = h * (np.indices((15, 15)).sum(axis=0) % 2 * 2 - 1).astype(np.float64)
    r = detrended_roughness(cb, 10.0, np.full(15, 10.0))
    assert r[5:10, 5:10] == pytest.approx(h * math.sqrt(720 / 729), rel=1e-9)


def test_slope_classes_match_shared_terrain_summary():
    assert [slope_class(s) for s in (0, 4.99, 5, 11.99, 12, 19.99, 20, 45)] == \
        ["flat", "flat", "moderate", "moderate", "steep", "steep", "hazardous", "hazardous"]


def test_package_round_trip_and_checksum(tmp_path):
    t = synthetic.gale_demo(200.0)
    save_package(t, tmp_path / "f32", encoding="float32")
    u = load_package(tmp_path / "f32")
    assert u.geometry == t.geometry
    np.testing.assert_array_equal(np.isnan(u.elevation), np.isnan(t.elevation))
    np.testing.assert_array_equal(np.nan_to_num(u.elevation), np.nan_to_num(t.elevation))
    assert u.metadata.synthetic and u.metadata.dataset_id == "SYNTH-GALE-DEMO-001"
    raw = bytearray((tmp_path / "f32" / "elevation.f32").read_bytes())
    raw[100] ^= 0xFF
    (tmp_path / "f32" / "elevation.f32").write_bytes(bytes(raw))
    with pytest.raises(TerrainDataError, match="checksum"):
        load_package(tmp_path / "f32")


def test_int16_package_is_half_size_and_within_2cm(tmp_path):
    t = synthetic.gale_demo(200.0)
    save_package(t, tmp_path / "q")
    assert (tmp_path / "q" / "elevation.i16").stat().st_size == t.elevation.size * 2
    u = load_package(tmp_path / "q")
    np.testing.assert_array_equal(np.isnan(u.elevation), np.isnan(t.elevation))
    err = np.nanmax(np.abs(u.elevation.astype(np.float64) - t.elevation))
    assert err <= 0.02
    assert np.nanmax(np.abs(u.slope_deg - t.slope_deg)) < 0.05      # slopes unaffected in practice


def test_coverage_and_bilinear_sampling():
    t = synthetic.tilted_plane(21, 21, 20.0, 10.0, 0)
    g = t.geometry
    lat, lon = float(g.row_lat(10.5)), float(g.col_lon(7.25))
    expect = 0.5 * (t.elevation[10, 7] + t.elevation[11, 7])   # plane rises north only
    assert t.sample_bilinear([lat], [lon])[0] == pytest.approx(float(expect), abs=1e-3)
    with pytest.raises(CoverageError):
        t.require_coverage(0.0, 0.0)


def _write_geotiff(path, arr, *, model, pixel_scale, tiepoint, keys, doubles, nodata=None):
    import tifffile
    n = len(keys)
    gkd = [1, 1, 0, n]
    for k in keys:
        gkd += list(k)
    extratags = [(33550, "d", 3, pixel_scale, False), (33922, "d", 6, tiepoint, False),
                 (34735, "H", len(gkd), gkd, False), (34736, "d", len(doubles), doubles, False)]
    if nodata is not None:
        extratags.append((42113, "s", 0, str(nodata), False))
    tifffile.imwrite(path, arr.astype(np.float32), extratags=extratags)


def test_import_geographic_geotiff(tmp_path):
    pytest.importorskip("tifffile")
    R = 3396190.0
    arr = np.arange(40 * 50, dtype=np.float32).reshape(40, 50) - 4500
    arr[3, 4] = -3.4028234663852886e38                   # typical no-data
    dlon = dlat = 0.000337
    west_edge, north_edge = 137.20, -4.45
    keys = [(1024, 0, 1, 2), (1025, 0, 1, 1), (2057, 34736, 1, 0)]
    p = tmp_path / "geo.tif"
    _write_geotiff(p, arr, model=2, pixel_scale=(dlon, dlat, 0), tiepoint=(0, 0, 0, west_edge, north_edge, 0),
                   keys=keys, doubles=[R])
    md = TerrainMetadata(dataset_id="T", name="test")
    t = import_geotiff(p, md)
    g = t.geometry
    assert g.radius_m == R
    assert g.north_lat == pytest.approx(north_edge - dlat / 2)
    assert g.west_lon == pytest.approx(west_edge + dlon / 2)
    assert math.isnan(t.elevation[3, 4])
    lat, lon = float(g.row_lat(10)), float(g.col_lon(20))
    assert t.sample_bilinear([lat], [lon])[0] == pytest.approx(10 * 50 + 20 - 4500)
    sub = import_geotiff(p, md, bbox=(float(g.row_lat(30)), float(g.col_lon(5)), float(g.row_lat(5)), float(g.col_lon(40))))
    assert sub.sample_bilinear([lat], [lon])[0] == pytest.approx(10 * 50 + 20 - 4500)
    dec = import_geotiff(p, md, decimate=2)
    assert dec.geometry.dlat_deg == pytest.approx(2 * dlat)
    assert math.isnan(dec.elevation[1, 2])               # block containing the no-data cell stays no-data
    assert dec.metadata.spatial_resolution_m == pytest.approx(dec.geometry.cell_size_m, abs=0.01)


def test_import_equirectangular_geotiff(tmp_path):
    pytest.importorskip("tifffile")
    R = 3396190.0
    sx = 20.0
    lat_ts = 0.0
    x0 = math.radians(137.20) * R                       # metres from lon0 = 0
    y0 = math.radians(-4.45) * R
    arr = np.arange(30 * 30, dtype=np.float32).reshape(30, 30)
    keys = [(1024, 0, 1, 1), (1025, 0, 1, 1), (2057, 34736, 1, 0), (3075, 0, 1, 17),
            (3078, 34736, 1, 1), (3088, 34736, 1, 2)]
    p = tmp_path / "eqc.tif"
    _write_geotiff(p, arr, model=1, pixel_scale=(sx, sx, 0), tiepoint=(0, 0, 0, x0, y0, 0), keys=keys,
                   doubles=[R, lat_ts, 0.0])
    t = import_geotiff(p, TerrainMetadata(dataset_id="E", name="eqc"))
    g = t.geometry
    assert g.west_lon == pytest.approx(137.20 + math.degrees(sx / 2 / R))
    assert g.north_lat == pytest.approx(-4.45 - math.degrees(sx / 2 / R))
    assert g.dlon_deg == pytest.approx(math.degrees(sx / R))


def test_geometry_rejects_bad_grids():
    with pytest.raises(TerrainDataError):
        GridGeometry(0, 0, -1, 1, 10, 10)
    with pytest.raises(TerrainDataError):
        GridGeometry(0, 0, 1, 1, 2, 10)
    with pytest.raises(TerrainDataError):
        TerrainGrid(np.full((5, 5), np.nan), synthetic.geometry_for(5, 5, 20.0),
                    synthetic.synthetic_metadata("X", "x", 20.0))

