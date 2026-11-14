import json

import geopandas as gpd
import numpy as np
import pytest
import rasterio
from conftest import write_tif
from pyproj import CRS
from shapely.geometry import Point

from marga_gis.build_site import main as build_site
from marga_gis.crs import CrsError, classify_crs, is_marga_crs
from marga_gis.dem import sample_bilinear
from marga_gis.evidence import verify_latitude_convention
from marga_gis.vector import read_mars_vector


def _geojson(path, features):
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return path


def _pt(lon, lat, **props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


def test_geojson_is_not_silently_treated_as_earth(tmp_path):
    p = _geojson(tmp_path / "pts.geojson", [_pt(137.44, -4.59, name="a")])
    with pytest.raises(CrsError, match="will not treat it as Earth data"):
        read_mars_vector(p)
    gdf = read_mars_vector(p, assume_marga_crs="rover localization, planetocentric")
    assert is_marga_crs(gdf.crs)
    assert "planetocentric" in gdf.attrs["crs_note"]
    assert (gdf.geometry.x.iloc[0], gdf.geometry.y.iloc[0]) == (137.44, -4.59)  # unchanged


def test_latitude_convention_test_identifies_planetocentric_data(tmp_path):
    # Elevation rises steeply to the south, so a 0.05 deg latitude error is obvious.
    r, c = np.mgrid[0:400, 0:60]
    z = (-4500.0 + 3.0 * r).astype(np.float32)
    dem = write_tif(tmp_path / "ell.tif", z, crs="ESRI:104905")
    with rasterio.open(dem) as src:
        arr, tr = src.read(1).astype(np.float64), src.transform
    lats = np.linspace(-4.46, -4.52, 30)
    lons = np.full_like(lats, 137.205)
    elev = sample_bilinear(arr, tr, lons, lats)          # truth: the file's latitudes are planetocentric
    pts = gpd.GeoDataFrame({"elevation_m": elev}, geometry=[Point(x, y) for x, y in zip(lons, lats)],
                           crs=CRS.from_user_input("IAU_2015:49900"))
    res = verify_latitude_convention(dem, pts, "elevation_m")
    assert res["verdict"] == "planetocentric"
    assert res["planetocentric"]["median_abs_m"] < 0.01 < res["planetographic"]["median_abs_m"]


def test_build_site_writes_aligned_cogs_and_engine_package(tmp_path, plane_dem):
    src = write_tif(tmp_path / "dem.tif", plane_dem, nodata=np.nan)
    out_gis, out_terrain = tmp_path / "gis", tmp_path / "terrain"
    assert build_site(["--site", "t", "--dem", str(src), "--out-gis", str(out_gis), "--out-terrain", str(out_terrain)]) == 0

    manifest = json.loads((out_gis / "layers.json").read_text())
    assert manifest["crs"]["code"] == "IAU_2015:49900"
    for name, dtype, nodata in (("elevation.tif", "float32", None), ("hillshade.tif", "uint8", 0)):
        with rasterio.open(out_gis / name) as ds:
            assert classify_crs(CRS.from_wkt(ds.crs.to_wkt())) == "mars_sphere_geographic"
            assert ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
            assert ds.dtypes[0] == dtype
            assert list(ds.transform)[:6] == manifest["grid"]["transform"]
            if nodata is not None:
                assert ds.nodata == nodata
            if name == "elevation.tif":
                cog = ds.read(1)
                assert np.isnan(ds.nodata)
                assert np.isnan(cog[10, 10]) and cog[0, 0] == plane_dem[0, 0]

    pkg = json.loads((out_terrain / "terrain.json").read_text())
    g = pkg["geometry"]
    west, south, east, north = manifest["grid"]["bounds"]
    assert g["west_lon"] - g["dlon_deg"] / 2 == pytest.approx(west, abs=1e-12)
    assert g["north_lat"] + g["dlat_deg"] / 2 == pytest.approx(north, abs=1e-12)
    assert (g["nrows"], g["ncols"]) == (manifest["grid"]["height"], manifest["grid"]["width"])
    assert pkg["dataset"]["crs"].startswith("IAU_2015:49900")
    values = np.fromfile(out_terrain / pkg["layers"]["elevation"]["file"], dtype="<i2" if pkg["layers"]["elevation"]["dtype"] == "int16" else "<f4")
    assert values.size == g["nrows"] * g["ncols"]
