"""Curiosity surface data: CheMin parsing, rover localisation, Navcam camera geometry and the horizon check (no network)."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from marga_gis.msl import chemin
from marga_gis.msl.camera import (
    Cahvor,
    Frame,
    PanoGrid,
    dem_horizon,
    detect_skyline,
    parse_vector,
    quat_matrix,
    render,
    skyline_offset,
    yaw_deg,
)
from marga_gis.msl.waypoints import Waypoints

# The Rock Hall label (PDS3, CMA_598547494MIN22650731206CH00111P1), SPREADSHEET description shortened.
ROCK_HALL_LABEL = '''PDS_VERSION_ID                = PDS3
PRODUCT_ID                    = "CMA_598547494MIN22650731206CH00111P1"
RELEASE_ID                    = "0021"
SOURCE_PRODUCT_ID             = "CMA_598547494RDA22650731206CH00111P1"
START_TIME                    = 2018-12-20T03:45:16.451
OBJECT                        = HEADER
 DESCRIPTION                  = "This header record contains column headings
 for the following table."
END_OBJECT                    = HEADER
OBJECT                        = SPREADSHEET
 ROWS                         = 7
DESCRIPTION                   = "This table contains mineral abundances and
 analytical errors derived from diffraction-all K-alpha diffraction data for
 the Rock Hall drill sample, analyzed in CheMin cell number 7b (Mylar
 window). Mineral identifications, abundances and analytical errors for
 crystalline phases, other than clay minerals, were determined using the
 program JADE. In addition to the crystalline phases, the abundance of
 poorly-crystalline clay minerals was modeled using the program FULLPAT at
 ~13 +/- 6 weight% of the total sample. A broad rise in background is present
 and has been modeled using FULLPAT to indicate that ~34 +/- 15 weight% of the
 total sample consists of X-ray amorphous material. Column 1 of the table lists
 mineral identifications."
END_OBJECT                    = SPREADSHEET
END
'''

ROCK_HALL_CSV = "MINERAL,PERCENT,ERROR\r\nPLAGIOCLASE,38.2,4.1\r\nHEMATITE,5.4,0.4\r\nPYROXENE,17.1,1.9\r\nAKAGANEITE,11.3,0.9\r\n"


def test_product_name_follows_the_archive_sis():
    n = chemin.parse_product_name("cma_598547494min22650731206ch00111p1.csv")
    assert (n.config, n.sclk, n.prod, n.sol, n.site, n.drive) == ("A_", 598547494, "MIN", 2265, 73, 1206)
    assert (n.producer, n.ver) == ("P", "1")
    with pytest.raises(ValueError):
        chemin.parse_product_name("not_a_chemin_file.csv")


def test_label_names_the_sample_and_states_fractions():
    lab = chemin.parse_label(ROCK_HALL_LABEL)
    assert lab["product_id"] == "CMA_598547494MIN22650731206CH00111P1"
    assert (lab["sample"], lab["sample_kind"]) == ("Rock Hall", "drill")
    assert lab["fractions"]["clay"]["wt_pct"] == 13.0 and lab["fractions"]["clay"]["plus_minus"] == 6.0
    assert lab["fractions"]["amorphous"]["wt_pct"] == 34.0 and lab["fractions"]["amorphous"]["plus_minus"] == 15.0
    assert "FULLPAT" in lab["fractions"]["clay"]["statement"]
    assert lab["reanalysis"] is False


def test_label_variants():
    rocknest = ("This table contains mineral abundances derived from data for the fifth scooped soil sample from the "
                "Rocknest target, analyzed in CheMin cell number 7a. A broad rise in background indicates that ~27 weight% of "
                "this sample consists of X-ray amorphous material; errors on this estimate may be ~50% relative.")
    assert chemin.sample_from_description(rocknest) == ("Rocknest", "scoop")
    amorphous = chemin.fractions_from_description(rocknest)["amorphous"]
    assert (amorphous["wt_pct"], amorphous["plus_minus"]) == (27.0, None)
    etive = "This table contains mineral abundances derived from data for the first Glen Etive drill sample, analyzed in CheMin."
    assert chemin.sample_from_description(etive) == ("Glen Etive", "drill")
    assert chemin.sample_phrase(etive) == "the first Glen Etive drill sample"
    # A revised label that first mentions the superseded combined value must not be read as the clay fraction.
    revised = ("This is a P2 revision of label file X. The label for the P1 version had reported amorphous and clay mineral values "
               "with a single percentage value of ~58 weight%. The table contains mineral abundances for the Kings Canyon drill "
               "sample. In addition, the program FULLPAT was used to estimate the abundance of poorly crystalline clay minerals at "
               "~7 +/- 3 weight% of the total sample. A broad amorphous hump was modeled to indicate that ~51 +/- 25 weight% of the "
               "total sample consists of X-ray amorphous materials.")
    f = chemin.fractions_from_description(revised)
    assert (f["clay"]["wt_pct"], f["amorphous"]["wt_pct"]) == (7.0, 51.0)
    stored = "This is a reanalysis of this sample, which was originally analyzed in sequences uploaded from sol 0283."
    assert chemin.parse_label(f'OBJECT = SPREADSHEET\nDESCRIPTION = "{stored}"\nEND_OBJECT = SPREADSHEET')["reanalysis"] is True


def test_table_and_versions():
    rows = chemin.parse_table(ROCK_HALL_CSV)
    assert rows[0] == {"mineral": "PLAGIOCLASE", "wt_pct": 38.2, "err_2sigma": 4.1}
    with pytest.raises(ValueError):
        chemin.parse_table("A,B,C\n1,2,3\n")
    kept, superseded = chemin.latest_versions(["cmb_1min2p1", "cmb_1min2p2", "cmb_9min9p1"])
    assert kept == ["cmb_1min2p2", "cmb_9min9p1"]
    assert superseded == {"cmb_1min2p2": ["cmb_1min2p1"]}
    assert chemin.display_mineral("PLAGIOCLASE") == "Plagioclase"
    assert chemin.display_mineral("Mg-sulfate.4H2O") == "Mg-sulfate.4H2O"
    assert chemin.mineral_family("HEMATITE") == "oxide" and chemin.mineral_family("Gypsum") == "sulfate"


def _waypoints(tmp_path):
    feats = []
    for site, drive, sol, lat, lon in [(73, 1104, 2256, -4.7286, 137.3780), (73, 1206, 2257, -4.7284, 137.3782), (73, 1482, 2297, -4.7280, 137.3790)]:
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {"site": site, "drive": drive, "sol": sol, "lat": lat, "lon": lon, "elev_geoid": -4144.0, "yaw": 10.0}})
    p = tmp_path / "w.json"
    p.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    return Waypoints.load(p)


def test_waypoint_lookup(tmp_path):
    wp = _waypoints(tmp_path)
    w, how = wp.at(73, 1206)
    assert w.sol == 2257 and how == "exact RMC"
    w, how = wp.at(73, 1300)
    assert w.drive == 1206 and "last localised drive" in how
    assert wp.at(99, 1)[0] is None
    assert wp.departure_sol(wp.by_rmc["73_1206"]) == 2297
    assert [x.rmc for _, x in wp.near(-4.7284, 137.3782, 30)] == ["73_1206", "73_1104"]


def _pinhole(f=500.0, cx=511.5, cy=511.5, R=(0.0, 0.0, 0.0), a=(1.0, 0.0, 0.0)) -> Cahvor:
    A = np.array(a, float)
    # image x to the right (+Y rover), y down (+Z rover)
    Hp = np.array([0.0, 1.0, 0.0]) if abs(A[1]) < 0.9 else np.array([-1.0, 0.0, 0.0])
    Vp = np.cross(A, Hp)
    return Cahvor(np.zeros(3), A, f * Hp + cx * A, f * Vp + cx * 0 + cy * A, A.copy(), np.array(R, float))


def test_cahvor_projection():
    m = _pinhole()
    assert m.centre() == pytest.approx((511.5, 511.5))
    x, y, front = m.project(np.array([[1.0, 0.0, 0.0], [1.0, 0.1, 0.0], [1.0, 0.0, 0.2], [-1.0, 0.0, 0.0]]))
    assert x[0] == pytest.approx(511.5) and y[0] == pytest.approx(511.5)
    assert x[1] == pytest.approx(511.5 + 50.0) and y[2] == pytest.approx(511.5 + 100.0)
    assert front.tolist() == [True, True, True, False]
    # radial distortion moves an off-axis point away from the centre; the axis stays put
    md = _pinhole(R=(0.0, 0.2, 0.0))
    xd, yd, _ = md.project(np.array([[1.0, 0.0, 0.0], [1.0, 0.3, 0.0]]))
    assert xd[0] == pytest.approx(511.5) and xd[1] > 511.5 + 150.0
    # CAHV text (4 vectors) and CAHVOR text (6 vectors) both parse
    cahv = Cahvor.parse("(0.9,0.3,-1.9);(1,0,0);(506.6,1225.3,0.3);(498.9,1.1,1225.6)")
    assert cahv.O.tolist() == [1.0, 0.0, 0.0] and cahv.R.tolist() == [0.0, 0.0, 0.0]
    assert Cahvor.supported("(1,2,3);(4,5,6)") is False


def test_rover_attitude_matches_the_waypoint_yaw():
    # NAV_LEFT_B NLB_618186378EDR_F0763002NCAM00309M_ (sol 2486, RMC 76_3002); NASA waypoint yaw -123.48 deg
    R = quat_matrix(parse_vector("(0.472669,0.0600383,0.0396398,-0.878299)"))
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-9)
    assert yaw_deg(R) == pytest.approx(-123.48, abs=0.5)


def test_render_places_a_frame_by_its_pointing():
    grid = PanoGrid(width=720, height=180, el_top=30.0, el_bottom=-60.0)
    img = np.full((1024, 1024), 120.0, np.float32)
    # rover facing east (yaw 90): rover X = site east
    yaw = math.radians(90.0)
    R = np.array([[math.cos(yaw), -math.sin(yaw), 0.0], [math.sin(yaw), math.cos(yaw), 0.0], [0.0, 0.0, 1.0]])
    frame = Frame(img, _pinhole(), R)
    assert frame.pointing()[0] == pytest.approx(90.0) and frame.pointing()[1] == pytest.approx(0.0, abs=1e-9)
    pano, owner, _ = render([frame], grid)
    row0 = int(grid.row_of(0.0))
    assert not np.isnan(pano[row0, int(90 / grid.deg_per_px)])
    assert np.isnan(pano[row0, int(270 / grid.deg_per_px)])
    seen = np.nonzero(~np.isnan(pano[row0]))[0] * grid.deg_per_px
    # half-width of a 1024 px frame at f = 500 px: atan(512 / 500) = 45.7 deg
    assert seen.min() == pytest.approx(90 - 45.7, abs=1.0) and seen.max() == pytest.approx(90 + 45.7, abs=1.0)


def test_skyline_detection_and_offset():
    grid = PanoGrid(width=720, height=360, el_top=30.0, el_bottom=-60.0)
    az = grid.az(np.arange(grid.width))
    true_sky = 4.0 + 3.0 * np.sin(np.radians(az)) + 1.5 * np.sin(np.radians(3 * az))
    rng = np.random.default_rng(1)
    pano = np.empty((grid.height, grid.width), np.float32)
    el = grid.el(np.arange(grid.height))
    for c in range(grid.width):
        pano[:, c] = np.where(el > true_sky[c], 200.0, 70.0 + 30.0 * rng.random(grid.height))
    sky = detect_skyline(pano, grid)
    ok = ~np.isnan(sky)
    assert ok.mean() > 0.9
    assert np.median(np.abs(sky[ok] - true_sky[ok])) < 0.4
    dem_az = np.arange(0.0, 360.0, 0.5)
    dem = 4.0 + 3.0 * np.sin(np.radians(dem_az)) + 1.5 * np.sin(np.radians(3 * dem_az))
    resolved = np.ones(dem_az.size, bool)
    aligned = skyline_offset(sky, az, dem, dem_az, resolved)
    assert aligned["verdict"] == "aligned" and abs(aligned["azimuth_offset_deg"]) <= 0.5
    # the DEM rotated by 6 deg: its horizon at (image azimuth + 6) matches the image
    dem_shift = 4.0 + 3.0 * np.sin(np.radians(dem_az - 6)) + 1.5 * np.sin(np.radians(3 * (dem_az - 6)))
    off = skyline_offset(sky, az, dem_shift, dem_az, resolved)
    assert off["verdict"] == "offset" and off["azimuth_offset_deg"] == pytest.approx(6.0, abs=0.5)
    flat = skyline_offset(sky, az, np.zeros_like(dem), dem_az, resolved)
    assert flat["verdict"] == "inconclusive"


def test_dem_horizon_sees_a_wall():
    mpd = 59274.6975
    n = 401
    elev = np.zeros((n, n))
    elev[:150, :] = 100.0  # rows 0-149 (north of the centre) are 100 m high
    cell_deg = 20.0 / mpd
    # transform: lon = c + col * a, lat = f + row * e (north up)
    transform = (cell_deg, 0.0, 137.0, 0.0, -cell_deg, -4.7)
    lat0, lon0 = -4.7 - 200 * cell_deg, 137.0 + 200 * cell_deg
    ang, resolved = dem_horizon(elev, transform, lat0, lon0, 2.0, mpd, 3396190.0, np.array([0.0, 180.0]))
    # the wall edge is 50 cells (1 km) north: atan((100 - 2) / 1000) = 5.6 deg
    assert ang[0] == pytest.approx(math.degrees(math.atan(98 / 1000)), abs=0.4)
    assert resolved[0]
    assert ang[1] < 0.0
