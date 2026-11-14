import re
from pathlib import Path

import pytest
from pyproj import CRS

from marga_gis import REPO
from marga_gis.crs import classify_crs, is_marga_crs, mars_crs, mars_crs_definition


def test_shared_definition_is_the_iau_mars_sphere():
    d = mars_crs_definition()
    assert d["code"] == "IAU_2015:49900"
    crs = mars_crs()
    assert crs.is_geographic
    assert crs.ellipsoid.semi_major_metre == crs.ellipsoid.semi_minor_metre == d["radius_m"] == 3396190.0


def test_python_and_typescript_engines_use_the_same_radius():
    from marga_engine.geodesy import MARS_RADIUS_M

    assert MARS_RADIUS_M == mars_crs_definition()["radius_m"]
    ts = (REPO / "shared" / "engine" / "geodesy.ts").read_text(encoding="utf-8")
    m = re.search(r"export const MARS_RADIUS_M\s*=\s*([\d_.]+)", ts)
    assert m and float(m.group(1).replace("_", "")) == mars_crs_definition()["radius_m"]


def test_typescript_reads_the_same_definition_file():
    ts = (REPO / "shared" / "gis" / "marsCrs.ts").read_text(encoding="utf-8")
    assert "from './mars_crs.json'" in ts


@pytest.mark.parametrize(
    "code,kind",
    [
        ("IAU_2015:49900", "mars_sphere_geographic"),
        ("ESRI:104905", "mars_ellipsoid_geographic"),  # GCS_Mars_2000: ellipsoid, planetographic by definition
        ("EPSG:4326", "earth"),
        ("EPSG:3857", "earth"),
    ],
)
def test_classification_uses_the_body_not_the_name(code, kind):
    assert classify_crs(CRS.from_user_input(code)) == kind
    assert is_marga_crs(code) is (kind == "mars_sphere_geographic")


def test_mars_projected_crs_is_recognised_as_projected():
    try:
        crs = CRS.from_user_input("IAU_2015:49910")  # Mars sphere, equirectangular
    except Exception:  # pragma: no cover - older PROJ without this code
        pytest.skip("IAU_2015:49910 not in this PROJ database")
    assert classify_crs(crs) == "mars_projected"


def test_definition_file_exists_where_both_languages_expect_it():
    assert (Path(REPO) / "shared" / "gis" / "mars_crs.json").is_file()
