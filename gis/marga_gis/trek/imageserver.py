"""ArcGIS ImageServer exportImage: plan, fetch in chunks, validate and mosaic.

What the Mars Trek image services support (checked 2026-11): capability "Image" (exportImage),
at most 15000 x 4100 pixels per request, spatial reference 104905 (GCS_Mars_2000). A region is
exported on an explicit pixel grid; when the grid exceeds the request limit it is split into chunks
on the same grid, each chunk's returned georeferencing is checked against the requested one, and the
chunks are placed by pixel offset (no resampling between chunks).
"""
from __future__ import annotations

import math
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import rasterio
from affine import Affine

from .catalog import ARCGIS
from .net import Downloader, FetchResult

SERVICE_SR = 104905  # the spatial reference id the Mars Trek services use


@dataclass(frozen=True)
class ExportGrid:
    """A north-up pixel grid: top-left corner (west, north), pixel size in degrees, size in pixels.

    request_bbox, when set, is sent to the server verbatim (a request reproduced from an existing
    URL): recomputing it from the pixel size changes its last digits, and the server then resamples
    onto a fractionally different grid.
    """
    west: float
    north: float
    pixel_deg: float
    width: int
    height: int
    request_bbox: tuple[float, float, float, float] | None = None

    @property
    def transform(self) -> Affine:
        return Affine(self.pixel_deg, 0, self.west, 0, -self.pixel_deg, self.north)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        if self.request_bbox is not None:
            return self.request_bbox
        return (self.west, self.north - self.height * self.pixel_deg, self.west + self.width * self.pixel_deg, self.north)

    @classmethod
    def covering(cls, west: float, south: float, east: float, north: float, pixel_deg: float) -> "ExportGrid":
        width = int(math.ceil((east - west) / pixel_deg - 1e-9))
        height = int(math.ceil((north - south) / pixel_deg - 1e-9))
        return cls(west, north, pixel_deg, width, height)

    @classmethod
    def from_bbox_size(cls, bbox: tuple[float, float, float, float], width: int, height: int) -> "ExportGrid":
        """A request given as bbox + size (as in the legacy Gale DEM URL). Pixels must be square."""
        w, s, e, n = bbox
        px, py = (e - w) / width, (n - s) / height
        if abs(px - py) > 1e-12 * max(px, py):
            raise ValueError(f"non-square pixels {px} x {py}")
        return cls(w, n, px, width, height, request_bbox=(w, s, e, n))


@dataclass(frozen=True)
class Chunk:
    row_off: int
    col_off: int
    grid: ExportGrid


def plan_chunks(grid: ExportGrid, max_width: int, max_height: int) -> list[Chunk]:
    """Split `grid` into chunks of at most max_width x max_height pixels, all on the same grid."""
    if grid.width <= max_width and grid.height <= max_height:
        return [Chunk(0, 0, grid)]       # one request: keep the grid (and any verbatim bbox) as given
    chunks = []
    for r0 in range(0, grid.height, max_height):
        for c0 in range(0, grid.width, max_width):
            h, w = min(max_height, grid.height - r0), min(max_width, grid.width - c0)
            sub = ExportGrid(grid.west + c0 * grid.pixel_deg, grid.north - r0 * grid.pixel_deg, grid.pixel_deg, w, h)
            chunks.append(Chunk(r0, c0, sub))
    return chunks


def export_url(service: str, grid: ExportGrid, *, pixel_type: str, interpolation: str) -> str:
    w, s, e, n = grid.bbox
    q = {
        "bbox": f"{w!r},{s!r},{e!r},{n!r}",
        "bboxSR": SERVICE_SR,
        "imageSR": SERVICE_SR,
        "size": f"{grid.width},{grid.height}",
        "format": "tiff",
        "pixelType": pixel_type,
        "interpolation": interpolation,
        "f": "image",
    }
    return f"{ARCGIS}/{service}/ImageServer/exportImage?{urllib.parse.urlencode(q)}"


def check_chunk(path: str | Path, expected: ExportGrid, tol_px: float = 1e-3) -> dict[str, Any]:
    """The returned GeoTIFF must have the requested size and corner (within a thousandth of a pixel)."""
    with rasterio.open(path) as ds:
        t = ds.transform
        problems = []
        if (ds.width, ds.height) != (expected.width, expected.height):
            problems.append(f"size {ds.width}x{ds.height}, requested {expected.width}x{expected.height}")
        for name, got, want in (("west", t.c, expected.west), ("north", t.f, expected.north)):
            if abs(got - want) > tol_px * expected.pixel_deg:
                problems.append(f"{name} edge {got!r}, requested {want!r}")
        if abs(t.a - expected.pixel_deg) > 1e-9 * expected.pixel_deg or abs(-t.e - expected.pixel_deg) > 1e-9 * expected.pixel_deg:
            problems.append(f"pixel size {t.a!r} x {-t.e!r}, requested {expected.pixel_deg!r}")
        return {"ok": not problems, "problems": problems, "count": ds.count, "dtype": ds.dtypes[0],
                "crs_label": ds.crs.to_string() if ds.crs else None}


def fetch_export(dl: Downloader, service: str, grid: ExportGrid, out_dir: Path, *, pixel_type: str,
                 interpolation: str, max_width: int, max_height: int,
                 on_chunk: Callable[[int, int], None] | None = None) -> list[tuple[Chunk, FetchResult | None, dict]]:
    """Fetch every chunk (skipping chunks already on disk). Returns (chunk, fetch result or None if cached, check)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks = plan_chunks(grid, max_width, max_height)
    results = []
    for i, ch in enumerate(chunks):
        path = out_dir / f"export_r{ch.row_off}_c{ch.col_off}.tif"
        res = None
        if not path.exists():
            res = dl.fetch_to_file(export_url(service, ch.grid, pixel_type=pixel_type, interpolation=interpolation),
                                   path, expect=("image/tiff",), label=f"{service} chunk {i + 1}/{len(chunks)}")
        results.append((ch, res, check_chunk(path, ch.grid)))
        if on_chunk:
            on_chunk(i + 1, len(chunks))
    return results


def mosaic(grid: ExportGrid, chunk_files: list[tuple[Chunk, Path]], dtype: str) -> np.ndarray:
    """Place each chunk's band 1 at its pixel offset in the full grid."""
    out = np.zeros((grid.height, grid.width), dtype=dtype)
    for ch, path in chunk_files:
        with rasterio.open(path) as ds:
            out[ch.row_off:ch.row_off + ch.grid.height, ch.col_off:ch.col_off + ch.grid.width] = ds.read(1)
    return out
