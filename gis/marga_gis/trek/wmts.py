"""Mars Trek WMTS (RESTful) tiles: tile matrices from GetCapabilities, region tile ranges, cached
parallel download, mosaic on the native tile grid.

Georeferencing comes from the tile-matrix geometry (TopLeftCorner, TileWidth/Height,
MatrixWidth/Height spanning 360 x 180 degrees), not from ScaleDenominator: on Mars Trek the
ScaleDenominator values only match the grid if Earth's metres per degree is assumed, so using them
with Mars units would mis-scale the imagery by ~1.88x. The grid georeferencing was cross-checked
against an ImageServer export of the same product (pixel correlation 0.965 at zero offset).
Missing tiles (HTTP 404) are areas outside the mosaic: they become no-data, never an error.
"""
from __future__ import annotations

import json
import math
import warnings
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import rasterio
import rasterio.errors
from affine import Affine

from .net import Cancelled, Downloader, NotFound, sha256_file, utc_now

TILES = "https://trek.nasa.gov/tiles/Mars/EQ"
_NS = {"w": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}


@dataclass(frozen=True)
class TileMatrix:
    identifier: str
    left: float
    top: float
    tile_width: int
    tile_height: int
    matrix_width: int
    matrix_height: int

    @property
    def pixel_deg(self) -> float:
        """Degrees per pixel, from the matrix spanning 360 degrees of longitude."""
        return 360.0 / (self.matrix_width * self.tile_width)

    @property
    def pixel_deg_y(self) -> float:
        return 180.0 / (self.matrix_height * self.tile_height)


@dataclass(frozen=True)
class Capabilities:
    layer: str
    tile_matrix_set: str
    supported_crs: str
    style: str
    format: str
    matrices: dict[str, TileMatrix]
    bbox: tuple[float, float, float, float] | None   # layer BoundingBox in the service CRS (lon/lat)


def capabilities_url(layer: str) -> str:
    return f"{TILES}/{layer}/1.0.0/WMTSCapabilities.xml"


def parse_capabilities(xml_text: str) -> Capabilities:
    root = ET.fromstring(xml_text)
    lyr = root.find(".//w:Contents/w:Layer", _NS)
    tms = root.find(".//w:Contents/w:TileMatrixSet", _NS)
    if lyr is None or tms is None:
        raise ValueError("WMTSCapabilities without Layer/TileMatrixSet")
    num = lambda e, tag: float(e.find(tag, _NS).text)  # noqa: E731  (capabilities write "2.0" for integers)
    matrices = {}
    for tm in tms.findall("w:TileMatrix", _NS):
        left, top = (float(v) for v in tm.find("w:TopLeftCorner", _NS).text.split())
        ident = tm.find("ows:Identifier", _NS).text
        matrices[ident] = TileMatrix(ident, left, top, int(num(tm, "w:TileWidth")), int(num(tm, "w:TileHeight")),
                                     int(num(tm, "w:MatrixWidth")), int(num(tm, "w:MatrixHeight")))
    bb = lyr.find("ows:BoundingBox", _NS)
    if bb is None:
        bb = lyr.find("ows:WGS84BoundingBox", _NS)
    bbox = None
    if bb is not None:
        lo = [float(v) for v in bb.find("ows:LowerCorner", _NS).text.split()]
        hi = [float(v) for v in bb.find("ows:UpperCorner", _NS).text.split()]
        bbox = (lo[0], lo[1], hi[0], hi[1])
    fmt = (lyr.find("w:Format", _NS).text or "image/png").strip()
    style_el = lyr.find("w:Style/ows:Identifier", _NS)
    return Capabilities(
        layer=lyr.find("ows:Identifier", _NS).text,
        tile_matrix_set=tms.find("ows:Identifier", _NS).text,
        supported_crs=tms.find("ows:SupportedCRS", _NS).text,
        style=style_el.text if style_el is not None else "default",
        format=fmt,
        matrices=matrices,
        bbox=bbox,
    )


def check_grid(tm: TileMatrix) -> None:
    """The matrix must tile the whole globe from (-180, 90) with square pixels, or we refuse to guess."""
    if (tm.left, tm.top) != (-180.0, 90.0):
        raise ValueError(f"tile matrix {tm.identifier}: top-left {tm.left},{tm.top} is not -180,90")
    if abs(tm.pixel_deg - tm.pixel_deg_y) > 1e-12:
        raise ValueError(f"tile matrix {tm.identifier}: pixels are not square in degrees")


def tile_range(tm: TileMatrix, west: float, south: float, east: float, north: float) -> tuple[int, int, int, int]:
    """(row0, row1, col0, col1) inclusive tile indices covering the box."""
    tdeg = tm.tile_width * tm.pixel_deg
    col0 = int(math.floor((west - tm.left) / tdeg))
    col1 = int(math.floor((east - tm.left) / tdeg - 1e-12))
    row0 = int(math.floor((tm.top - north) / tdeg))
    row1 = int(math.floor((tm.top - south) / tdeg - 1e-12))
    return (max(0, row0), min(tm.matrix_height - 1, row1), max(0, col0), min(tm.matrix_width - 1, col1))


def tile_url(caps: Capabilities, layer: str, tm: TileMatrix, row: int, col: int) -> str:
    ext = "png" if "png" in caps.format else "jpg"
    return f"{TILES}/{layer}/1.0.0/{caps.style}/{caps.tile_matrix_set}/{tm.identifier}/{row}/{col}.{ext}"


def fetch_tiles(dl: Downloader, caps: Capabilities, layer: str, tm: TileMatrix, rng: tuple[int, int, int, int],
                out_dir: Path, *, workers: int = 6, on_tile: Callable[[int, int], None] | None = None) -> dict[str, Any]:
    """Download every tile in range (cached tiles are reused). Returns a tile index for the manifest."""
    r0, r1, c0, c1 = rng
    ext = "png" if "png" in caps.format else "jpg"
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    index: dict[str, Any] = {"tiles": {}, "missing": []}
    done = 0

    def one(rc: tuple[int, int]):
        r, c = rc
        path = out_dir / tm.identifier / str(r) / f"{c}.{ext}"
        url = tile_url(caps, layer, tm, r, c)
        if path.exists():
            return rc, url, {"file": path, "bytes": path.stat().st_size, "sha256": sha256_file(path), "cached": True}
        try:
            res = dl.fetch_to_file(url, path, expect=("image/",), label=f"{layer} tile {r}/{c}")
            return rc, url, {"file": path, "bytes": res.bytes, "sha256": res.sha256, "downloaded_at": res.downloaded_at}
        except NotFound:
            return rc, url, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(one, rc) for rc in jobs]
        try:
            for fut in as_completed(futures):
                (r, c), url, info = fut.result()
                key = f"{r}/{c}"
                if info is None:
                    index["missing"].append({"tile": key, "url": url, "reason": "HTTP 404 (outside the mosaic)"})
                else:
                    info["file"] = Path(info["file"]).as_posix()
                    index["tiles"][key] = {"url": url, **info}
                done += 1
                if on_tile:
                    on_tile(done, len(jobs))
        except (Cancelled, KeyboardInterrupt):
            dl.cancel.set()          # running downloads stop at their next chunk
            for f in futures:
                f.cancel()           # queued tiles never start
            raise
    index["requested"] = len(jobs)
    index["completed_at"] = utc_now()
    return index


def mosaic_tiles(tm: TileMatrix, rng: tuple[int, int, int, int], index: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, Affine]:
    """(grey, valid mask, transform) on the native tile grid. Missing tiles and transparent pixels are invalid."""
    r0, r1, c0, c1 = rng
    th, tw = tm.tile_height, tm.tile_width
    h, w = (r1 - r0 + 1) * th, (c1 - c0 + 1) * tw
    grey = np.zeros((h, w), dtype=np.uint8)
    valid = np.zeros((h, w), dtype=bool)
    for key, info in index["tiles"].items():
        r, c = (int(v) for v in key.split("/"))
        with warnings.catch_warnings():   # tiles are plain PNGs; their georeferencing is the matrix position
            warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
            with rasterio.open(info["file"]) as ds:
                a = ds.read()
        y, x = (r - r0) * th, (c - c0) * tw
        grey[y:y + th, x:x + tw] = a[0]
        if a.shape[0] in (2, 4):          # grey+alpha or RGBA: alpha 0 = no data
            valid[y:y + th, x:x + tw] = a[-1] > 0
        else:
            valid[y:y + th, x:x + tw] = True
    transform = Affine(tm.pixel_deg, 0, tm.left + c0 * tw * tm.pixel_deg, 0, -tm.pixel_deg, tm.top - r0 * th * tm.pixel_deg)
    return grey, valid, transform


def save_index(index: dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(index, indent=1), encoding="utf-8")
