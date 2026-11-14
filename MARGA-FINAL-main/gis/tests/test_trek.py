"""Mars Trek acquisition: grid maths, request planning, Esri geometry, the downloader, image offsets.

No test touches the network: the downloader is exercised against a local HTTP server.
"""
import http.server
import math
import threading
import urllib.parse

import numpy as np
import pytest
from affine import Affine

from marga_gis.imagery import _xcorr_offset, clip_to_bbox, image_offset_check, prepare_cog_values
from marga_gis.trek import imageserver, mapserver, wmts
from marga_gis.trek.net import Cancelled, Downloader, NotFound, ServiceError, sha256_file

# --- WMTS -----------------------------------------------------------------------------------------

CAPS = """<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1">
 <Contents>
  <Layer>
   <ows:Identifier>Test_Layer</ows:Identifier>
   <ows:BoundingBox><ows:LowerCorner>137.0 -5.5</ows:LowerCorner><ows:UpperCorner>138.0 -4.0</ows:UpperCorner></ows:BoundingBox>
   <Style><ows:Identifier>default</ows:Identifier></Style>
   <Format>image/png</Format>
  </Layer>
  <TileMatrixSet>
   <ows:Identifier>default028mm</ows:Identifier>
   <ows:SupportedCRS>urn:ogc:def:crs:EPSG::104905</ows:SupportedCRS>
   <TileMatrix><ows:Identifier>0</ows:Identifier><ScaleDenominator>1.0</ScaleDenominator>
    <TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight>
    <MatrixWidth>2.0</MatrixWidth><MatrixHeight>1.0</MatrixHeight></TileMatrix>
   <TileMatrix><ows:Identifier>12</ows:Identifier><ScaleDenominator>1.0</ScaleDenominator>
    <TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight>
    <MatrixWidth>8192</MatrixWidth><MatrixHeight>4096</MatrixHeight></TileMatrix>
  </TileMatrixSet>
 </Contents>
</Capabilities>"""


def test_capabilities_parse_and_grid_from_matrix_geometry():
    caps = wmts.parse_capabilities(CAPS)
    assert caps.layer == "Test_Layer" and caps.tile_matrix_set == "default028mm"
    assert caps.bbox == (137.0, -5.5, 138.0, -4.0)
    tm0, tm12 = caps.matrices["0"], caps.matrices["12"]
    assert tm0.matrix_width == 2 and tm0.pixel_deg == pytest.approx(0.703125)
    # Level L: 0.703125 / 2^L degrees per pixel, from the matrix spanning 360 degrees (not ScaleDenominator).
    assert tm12.pixel_deg == pytest.approx(0.703125 / 2**12)
    wmts.check_grid(tm12)


def test_check_grid_refuses_unexpected_origin():
    tm = wmts.TileMatrix("x", -180.0, 85.0, 256, 256, 2, 1)
    with pytest.raises(ValueError, match="top-left"):
        wmts.check_grid(tm)


def test_tile_range_covers_region_and_mosaic_transform():
    tm = wmts.parse_capabilities(CAPS).matrices["12"]
    rng = wmts.tile_range(tm, 137.2, -4.85, 137.6, -4.45)
    r0, r1, c0, c1 = rng
    tdeg = 256 * tm.pixel_deg
    # The tiles' union contains the region, and no tile row/column lies wholly outside it.
    assert -180 + c0 * tdeg <= 137.2 < -180 + (c0 + 1) * tdeg
    assert -180 + c1 * tdeg < 137.6 <= -180 + (c1 + 1) * tdeg
    assert 90 - r0 * tdeg >= -4.45 > 90 - (r0 + 1) * tdeg
    assert 90 - (r1 + 1) * tdeg <= -4.85 < 90 - r1 * tdeg
    assert (r0, r1, c0, c1) == (2149, 2158, 7218, 7227)   # the Gale request recorded in the manifest


def test_tile_url():
    caps = wmts.parse_capabilities(CAPS)
    url = wmts.tile_url(caps, "Test_Layer", caps.matrices["12"], 2150, 7220)
    assert url.endswith("/Test_Layer/1.0.0/default/default028mm/12/2150/7220.png")


# --- ImageServer export planning ------------------------------------------------------------------

LEGACY_BBOX = (137.12247113204074, -4.925474311955841, 137.72981290693286, -4.248963057145466)


def test_bbox_and_size_request_is_sent_verbatim():
    grid = imageserver.ExportGrid.from_bbox_size(LEGACY_BBOX, 1800, 2005)
    assert grid.bbox == LEGACY_BBOX                  # not recomputed from the pixel size
    url = imageserver.export_url("Gale_DEM_SMG_1m", grid, pixel_type="F32", interpolation="RSP_BilinearInterpolation")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["bbox"] == [",".join(repr(v) for v in LEGACY_BBOX)]
    assert q["size"] == ["1800,2005"] and q["bboxSR"] == ["104905"] and q["imageSR"] == ["104905"]
    chunks = imageserver.plan_chunks(grid, 15000, 4100)
    assert len(chunks) == 1 and chunks[0].grid == grid


def test_non_square_pixels_are_refused():
    with pytest.raises(ValueError, match="non-square"):
        imageserver.ExportGrid.from_bbox_size((0.0, 0.0, 2.0, 1.0), 100, 100)


def test_large_grid_is_split_on_the_same_pixel_grid():
    px = 5 / 59274.69752330622
    grid = imageserver.ExportGrid.covering(137.2, -4.85, 137.6, -4.45, px)
    assert (grid.width, grid.height) == (4742, 4742)
    chunks = imageserver.plan_chunks(grid, 15000, 4100)
    assert [(c.row_off, c.grid.height) for c in chunks] == [(0, 4100), (4100, 642)]
    for c in chunks:
        # Each chunk's corner is a whole number of pixels from the grid's corner.
        assert (grid.north - c.grid.north) / px == pytest.approx(c.row_off, abs=1e-6)
        assert c.grid.pixel_deg == px
    assert sum(c.grid.height for c in chunks) == grid.height


# --- Esri JSON geometry ---------------------------------------------------------------------------

def test_esri_points_and_paths():
    assert mapserver.esri_geometry({"x": 137.4, "y": -4.6}).coords[0] == (137.4, -4.6)
    line = mapserver.esri_geometry({"paths": [[[137.0, -4.0], [137.1, -4.1]]]})
    assert line.geom_type == "LineString" and len(line.coords) == 2
    multi = mapserver.esri_geometry({"paths": [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]})
    assert multi.geom_type == "MultiLineString"
    assert mapserver.esri_geometry(None) is None


def test_esri_rings_clockwise_outer_counter_clockwise_hole():
    outer_cw = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]   # clockwise: outer ring (Esri rule)
    hole_ccw = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]       # counter-clockwise: hole
    poly = mapserver.esri_geometry({"rings": [outer_cw, hole_ccw]})
    assert poly.geom_type == "Polygon" and len(poly.interiors) == 1
    assert poly.area == pytest.approx(100 - 4)
    two = mapserver.esri_geometry({"rings": [outer_cw, [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]]]})
    assert two.geom_type == "MultiPolygon"


def test_unknown_esri_geometry_is_an_error():
    with pytest.raises(ValueError):
        mapserver.esri_geometry({"curvePaths": []})


# --- Downloader (local HTTP server) ---------------------------------------------------------------

class _Handler(http.server.BaseHTTPRequestHandler):
    calls: dict[str, int] = {}
    body = bytes(range(256)) * 4096          # 1 MB, several chunks

    def log_message(self, *args):            # keep test output quiet
        pass

    def do_GET(self):
        n = _Handler.calls[self.path] = _Handler.calls.get(self.path, 0) + 1
        if self.path == "/missing":
            self.send_error(404)
        elif self.path == "/flaky" and n == 1:
            self.send_error(503)
        elif self.path == "/arcgis-error":
            self._send(b'{"error": {"code": 400, "message": "Invalid bbox"}}', "application/json")
        elif self.path == "/short":
            self.send_response(200)
            self.send_header("Content-Type", "image/tiff")
            self.send_header("Content-Length", str(len(self.body) + 10))
            self.end_headers()
            self.wfile.write(self.body)
        else:
            self._send(self.body, "image/tiff")

    def _send(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture
def server():
    _Handler.calls = {}
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def test_download_streams_with_progress_and_checksum(server, tmp_path):
    seen = []
    dl = Downloader(retries=0, on_progress=lambda p: seen.append((p.done_bytes, p.total_bytes)))
    res = dl.fetch_to_file(server + "/ok.tif", tmp_path / "ok.tif", expect=("image/tiff",))
    assert res.bytes == len(_Handler.body) and res.http_status == 200
    assert res.sha256 == sha256_file(tmp_path / "ok.tif")
    assert len(seen) >= 4 and seen[-1] == (len(_Handler.body), len(_Handler.body))
    assert not (tmp_path / "ok.tif.part").exists()
    rec = res.record(tmp_path)
    assert rec["file"] == "ok.tif" and rec["url"].endswith("/ok.tif") and rec["downloaded_at"].endswith("Z")


def test_404_is_not_found_and_not_retried(server, tmp_path):
    dl = Downloader(retries=3, backoff_s=0.01)
    with pytest.raises(NotFound):
        dl.fetch_to_file(server + "/missing", tmp_path / "m.tif", expect=("image/",))
    assert _Handler.calls["/missing"] == 1


def test_server_errors_are_retried(server, tmp_path):
    dl = Downloader(retries=2, backoff_s=0.01)
    res = dl.fetch_to_file(server + "/flaky", tmp_path / "f.tif", expect=("image/tiff",))
    assert res.bytes == len(_Handler.body) and _Handler.calls["/flaky"] == 2


def test_error_document_is_not_saved_as_data(server, tmp_path):
    dl = Downloader(retries=0)
    with pytest.raises(ServiceError, match="Invalid bbox"):
        dl.fetch_to_file(server + "/arcgis-error", tmp_path / "e.tif", expect=("image/tiff",))
    assert not (tmp_path / "e.tif").exists()
    with pytest.raises(ServiceError, match="Invalid bbox"):
        dl.fetch_json(server + "/arcgis-error")


def test_truncated_download_leaves_no_file(server, tmp_path):
    dl = Downloader(retries=0)
    with pytest.raises(ServiceError):
        dl.fetch_to_file(server + "/short", tmp_path / "s.tif", expect=("image/tiff",))
    assert not (tmp_path / "s.tif").exists() and not (tmp_path / "s.tif.part").exists()


def test_cancel_stops_between_chunks_and_cleans_up(server, tmp_path):
    cancel = threading.Event()

    def on_progress(p):
        cancel.set()                         # cancel after the first chunk arrives

    dl = Downloader(retries=0, cancel=cancel, on_progress=on_progress)
    with pytest.raises(Cancelled):
        dl.fetch_to_file(server + "/ok.tif", tmp_path / "c.tif", expect=("image/tiff",))
    assert not (tmp_path / "c.tif").exists() and not (tmp_path / "c.tif.part").exists()


# --- Imagery processing ---------------------------------------------------------------------------

def _texture(shape, seed=0):
    rng = np.random.default_rng(seed)
    a = rng.normal(size=shape)
    # smooth a little so features span a few cells, like real terrain texture
    for _ in range(2):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a


def test_cross_correlation_recovers_a_known_shift():
    ref = _texture((200, 220))
    img = np.roll(np.roll(ref, 3, axis=0), -5, axis=1)   # features 3 rows south, 5 columns west
    r = _xcorr_offset(ref, img, max_shift=10)
    assert (r["sy"], r["sx"]) == (3, -5) and r["best"] > 0.9


def test_image_offset_check_reports_metres_and_direction():
    px = 10 / 59274.69752330622                          # 10 m cells
    ref = (_texture((240, 240), 1) * 40 + 120).astype(np.float32)
    img = np.roll(np.roll(ref, 6, axis=0), -4, axis=1)   # 60 m south, 40 m west of the reference
    t = Affine(px, 0, 137.3, 0, -px, -4.5)
    bbox = (137.3, -4.5 - 240 * px, 137.3 + 240 * px, -4.5)
    ok = np.ones_like(ref, dtype=bool)
    rec = image_offset_check(ref, ok, t, img, ok, t, bbox, px, reference="imagery:test", max_shift=12)
    assert rec["verdict"] == "offset"
    assert rec["image_offset_m"]["north"] == pytest.approx(-60, abs=0.5)
    assert rec["image_offset_m"]["east"] == pytest.approx(-40, abs=0.5)
    assert rec["image_offset_m"]["total"] == pytest.approx(math.hypot(60, 40), abs=0.5)
    same = image_offset_check(ref, ok, t, ref, ok, t, bbox, px, reference="imagery:test", max_shift=12)
    assert same["verdict"] == "aligned" and same["image_offset_m"]["total"] == 0


def test_clip_to_bbox_keeps_whole_pixels_on_the_native_grid():
    px = 0.01
    a = np.arange(100 * 100, dtype=np.uint8).reshape(100, 100)
    t = Affine(px, 0, 137.0, 0, -px, -4.0)
    out, valid, t2, (r0, r1, c0, c1) = clip_to_bbox(a, np.ones_like(a, bool), t, (137.205, -4.5, 137.4, -4.3))
    assert (r0, r1, c0, c1) == (30, 50, 20, 40)
    assert t2.c == pytest.approx(137.2) and t2.f == pytest.approx(-4.3) and t2.a == px
    assert np.array_equal(out, a[30:50, 20:40])


def test_zero_is_reserved_for_no_data():
    img = np.array([[0, 5], [0, 255]], dtype=np.uint8)
    valid = np.array([[True, True], [False, True]])
    out, raised = prepare_cog_values(img, valid)
    assert out.tolist() == [[1, 5], [0, 255]] and raised == 1
