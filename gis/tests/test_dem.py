import numpy as np
import pytest
from affine import Affine
from conftest import PIXEL_DEG, write_tif

from marga_gis.crs import CrsError
from marga_gis.dem import DemValidationError, read_dem


def test_mars_dem_keeps_crs_transform_bounds_resolution_and_nodata(tmp_path, plane_dem):
    p = write_tif(tmp_path / "dem.tif", plane_dem, nodata=np.nan)
    dem = read_dem(p)
    assert dem.crs.ellipsoid.semi_major_metre == 3396190.0
    assert dem.transform == Affine(PIXEL_DEG, 0, 137.2, 0, -PIXEL_DEG, -4.45)
    assert dem.res == (PIXEL_DEG, PIXEL_DEG)
    w, s, e, n = dem.bounds
    assert (w, n) == (137.2, -4.45)
    assert e == pytest.approx(137.2 + 50 * PIXEL_DEG) and s == pytest.approx(-4.45 - 60 * PIXEL_DEG)
    assert np.isnan(dem.elevation[10, 10]) and np.isfinite(dem.elevation).sum() == 60 * 50 - 1
    assert "MARGA's Mars CRS" in dem.crs_note


def test_declared_integer_nodata_becomes_nan(tmp_path):
    z = np.full((20, 20), -4500, dtype=np.int16)
    z[3, 4] = -32768
    dem = read_dem(write_tif(tmp_path / "i16.tif", z, nodata=-32768))
    assert np.isnan(dem.elevation[3, 4]) and dem.elevation[0, 0] == -4500


def test_earth_crs_is_refused(tmp_path, plane_dem):
    with pytest.raises(CrsError, match="Earth CRS"):
        read_dem(write_tif(tmp_path / "wgs84.tif", plane_dem, crs="EPSG:4326"))


def test_missing_crs_is_refused(tmp_path, plane_dem):
    with pytest.raises(DemValidationError, match="no CRS"):
        read_dem(write_tif(tmp_path / "nocrs.tif", plane_dem, crs=None))


def test_ungeoreferenced_raster_is_refused(tmp_path, plane_dem):
    with pytest.raises(DemValidationError, match="not georeferenced"):
        read_dem(write_tif(tmp_path / "pix.tif", plane_dem, transform=Affine.identity()))


def test_greyscale_image_is_not_elevation(tmp_path):
    img = (np.arange(400) % 256).astype(np.uint8).reshape(20, 20)
    with pytest.raises(DemValidationError, match="8-bit raster is an image"):
        read_dem(write_tif(tmp_path / "grey.tif", img))


def test_colour_image_is_not_elevation(tmp_path):
    rgb = np.zeros((3, 20, 20), dtype=np.uint8)
    with pytest.raises(DemValidationError, match="3 bands"):
        read_dem(write_tif(tmp_path / "rgb.tif", rgb, count=3))


def test_values_outside_mars_elevations_are_refused(tmp_path):
    z = np.full((20, 20), 50_000.0, dtype=np.float32)
    with pytest.raises(DemValidationError, match="outside Mars surface elevations"):
        read_dem(write_tif(tmp_path / "high.tif", z))


def test_mars_ellipsoid_label_needs_explicit_override_with_evidence(tmp_path, plane_dem):
    p = write_tif(tmp_path / "gcs_mars_2000.tif", plane_dem, crs="ESRI:104905")
    with pytest.raises(CrsError, match="planetographic"):
        read_dem(p)
    with pytest.raises(CrsError, match="needs recorded evidence"):
        read_dem(p, crs_override="IAU_2015:49900")
    with pytest.raises(CrsError, match="must be MARGA's CRS"):
        read_dem(p, crs_override="EPSG:4326", crs_evidence="anything")
    dem = read_dem(p, crs_override="IAU_2015:49900", crs_evidence="checked against rover positions")
    assert "used unchanged as IAU_2015:49900" in dem.crs_note and "rover positions" in dem.crs_note
    # The coordinate values are not transformed: same transform as the file.
    assert dem.transform == Affine(PIXEL_DEG, 0, 137.2, 0, -PIXEL_DEG, -4.45)


def test_bbox_clip_selects_the_same_cells_as_the_engine_importer(tmp_path):
    """Map layers and the routing package must cover exactly the same rows and columns."""
    from marga_engine.terrain.grid import TerrainMetadata
    from marga_engine.terrain.package import import_geotiff

    r, c = np.mgrid[0:120, 0:110]
    z = (-4400.0 - 1.5 * r + 0.5 * c).astype(np.float32)
    p = write_tif(tmp_path / "big.tif", z)
    bbox = (-4.47, 137.205, -4.455, 137.225)
    dem = read_dem(p, bbox=bbox)
    eng = import_geotiff(p, TerrainMetadata(dataset_id="T", name="t"), bbox=bbox)
    g = eng.geometry
    assert (dem.height, dem.width) == (g.nrows, g.ncols)
    assert dem.transform.f + 0.5 * dem.transform.e == pytest.approx(g.north_lat, abs=1e-12)
    assert dem.transform.c + 0.5 * dem.transform.a == pytest.approx(g.west_lon, abs=1e-12)
    np.testing.assert_array_equal(dem.elevation.astype(np.float32), eng.elevation)
