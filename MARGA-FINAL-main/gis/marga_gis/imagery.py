"""Regional imagery: clip to the region on the native grid, validate, check registration against the
DEM, and write display COGs. Pixel values are kept as delivered (8-bit brightness); nothing is
resampled except for the registration check, which works on a copy.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from affine import Affine
from rasterio.crs import CRS as RioCRS
from rasterio.warp import Resampling, reproject

from .crs import mars_crs, mars_crs_definition
from .dem import Dem


def clip_to_bbox(array: np.ndarray, valid: np.ndarray, transform: Affine,
                 bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, np.ndarray, Affine, tuple[int, int, int, int]]:
    """Whole pixels covering (west, south, east, north); returns (array, valid, transform, (r0, r1, c0, c1))."""
    w, s, e, n = bbox
    px, py = transform.a, -transform.e
    c0 = max(0, int(math.floor((w - transform.c) / px + 1e-9)))
    c1 = min(array.shape[1], int(math.ceil((e - transform.c) / px - 1e-9)))
    r0 = max(0, int(math.floor((transform.f - n) / py + 1e-9)))
    r1 = min(array.shape[0], int(math.ceil((transform.f - s) / py - 1e-9)))
    if r1 - r0 < 2 or c1 - c0 < 2:
        raise ValueError("the imagery does not cover the region")
    t = Affine(px, 0, transform.c + c0 * px, 0, -py, transform.f - r0 * py)
    return array[r0:r1, c0:c1], valid[r0:r1, c0:c1], t, (r0, r1, c0, c1)


def _onto_grid(image: np.ndarray, valid: np.ndarray, transform: Affine, dst_transform: Affine,
               shape: tuple[int, int]) -> np.ndarray:
    """Area-average an image onto another grid in the same CRS (a pure resampling; NaN = no data)."""
    crs = RioCRS.from_wkt(mars_crs().to_wkt())
    src = np.where(valid, image.astype(np.float32), np.nan)
    dst = np.full(shape, np.nan, dtype=np.float32)
    reproject(src, dst, src_transform=transform, src_crs=crs, dst_transform=dst_transform, dst_crs=crs,
              resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
    return dst


def _box_mean(a: np.ndarray, k: int) -> np.ndarray:
    """Mean over a k x k window (k odd), NaN-aware; edges use the part of the window inside the array."""
    ok = np.isfinite(a)
    p = k // 2

    def box_sum(x: np.ndarray) -> np.ndarray:
        s = np.pad(x, ((p + 1, p), (p + 1, p))).cumsum(0).cumsum(1)
        return s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]

    total = box_sum(np.where(ok, a, 0.0).astype(np.float64))
    count = box_sum(ok.astype(np.float64))
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def _xcorr_offset(ref: np.ndarray, img: np.ndarray, max_shift: int) -> dict[str, Any] | None:
    """Normalised cross-correlation of two co-gridded fields for every integer shift up to max_shift.

    corr[sy, sx] ~ sum ref[i, j] * img[i + sy, j + sx], computed with FFTs on the mean-removed fields
    (no-data set to zero) and normalised by their norms, so it equals the NCC up to the small loss of
    overlap at the shift. A peak at (sy, sx) means the image's features lie sy rows south and sx columns
    east of the same features in the reference.
    """
    ok = np.isfinite(ref) & np.isfinite(img)
    if ok.sum() < 1000:
        return None
    a = np.where(ok, ref - ref[ok].mean(), 0.0)
    b = np.where(ok, img - img[ok].mean(), 0.0)
    norm = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
    if norm == 0:
        return None
    h, w = a.shape
    fh, fw = h + max_shift + 1, w + max_shift + 1
    corr = np.fft.irfft2(np.conj(np.fft.rfft2(a, (fh, fw))) * np.fft.rfft2(b, (fh, fw)), (fh, fw)) / norm
    shifts = range(-max_shift, max_shift + 1)
    window = np.array([[corr[sy % fh, sx % fw] for sx in shifts] for sy in shifts])
    iy, ix = np.unravel_index(int(np.argmax(window)), window.shape)
    best = float(window[iy, ix])
    sigma = float(window.std())
    return {
        "sy": int(iy - max_shift), "sx": int(ix - max_shift), "best": best,
        "zero": float(window[max_shift, max_shift]),
        "significance": (best - float(window.mean())) / sigma if sigma > 0 else 0.0,
    }


def _offset_record(r: dict[str, Any] | None, cell_m: float, max_shift: int, method: str, reference: str) -> dict[str, Any]:
    base = {"method": method, "reference": reference, "cell_m": round(cell_m, 2), "max_shift_m": round(max_shift * cell_m)}
    if r is None:
        return {**base, "verdict": "inconclusive", "reason": "too little overlap"}
    north, east = -r["sy"] * cell_m, r["sx"] * cell_m
    if r["best"] < 0.05 or r["significance"] < 4:
        verdict = "inconclusive"
    elif max(abs(r["sy"]), abs(r["sx"])) <= 1:
        verdict = "aligned"
    elif max(abs(r["sy"]), abs(r["sx"])) >= max_shift:
        verdict = "inconclusive"      # the peak is at the edge of the search window
    else:
        verdict = "offset"
    return {
        **base,
        "ncc_at_zero_shift": round(r["zero"], 3), "ncc_best": round(r["best"], 3),
        "peak_significance_sigma": round(r["significance"], 1),
        "image_offset_m": {"north": round(north, 1), "east": round(east, 1), "total": round(math.hypot(north, east), 1)},
        "offset_meaning": "where the image's features lie relative to the same features in the reference "
                          "(negative north = south, negative east = west); the image is displayed as delivered, not shifted",
        "verdict": verdict,
    }


def registration_check(image: np.ndarray, valid: np.ndarray, transform: Affine, dem: Dem, max_shift: int = 15) -> dict[str, Any]:
    """Where do image edges best line up with DEM slope? Shift search of +-max_shift DEM cells.

    The image is area-averaged onto the DEM grid (same CRS, so a pure resampling), and the normalised
    cross-correlation between DEM slope and image gradient magnitude is computed for every integer
    shift. Illumination direction does not matter for edge strength, so crater rims and scarps
    dominate. A best shift within one cell means the products are registered to each other.
    """
    from marga_engine.terrain.analysis import slope_degrees

    on_dem = _onto_grid(image, valid, transform, dem.transform, dem.elevation.shape)
    gy, gx = np.gradient(on_dem)
    edges = np.hypot(gx, gy)
    dy, dx_rows = dem.spacing_m()
    slope = slope_degrees(dem.elevation, dy, dx_rows)
    r = _xcorr_offset(slope, edges, max_shift)
    return _offset_record(r, float(dy), max_shift, "NCC of DEM slope vs image gradient magnitude on the DEM grid, integer shifts",
                          "DEM")


def image_offset_check(ref: np.ndarray, ref_valid: np.ndarray, ref_transform: Affine, img: np.ndarray,
                       img_valid: np.ndarray, img_transform: Affine, bbox: tuple[float, float, float, float],
                       cell_deg: float, reference: str, max_shift: int = 30, highpass_cells: int = 15) -> dict[str, Any]:
    """Offset of one image relative to another, independent of the DEM.

    Both are area-averaged onto a common grid over bbox, high-passed (minus a highpass_cells box mean,
    which removes albedo and illumination gradients) and cross-correlated over integer shifts.
    """
    w, s, e, n = bbox
    shape = (int(round((n - s) / cell_deg)), int(round((e - w) / cell_deg)))
    grid = Affine(cell_deg, 0, w, 0, -cell_deg, n)
    a = _onto_grid(ref, ref_valid, ref_transform, grid, shape)
    b = _onto_grid(img, img_valid, img_transform, grid, shape)
    a, b = a - _box_mean(a, highpass_cells), b - _box_mean(b, highpass_cells)
    r = _xcorr_offset(a, b, max_shift)
    return _offset_record(r, metres_per_pixel(cell_deg), max_shift,
                          f"NCC of high-passed brightness ({highpass_cells}-cell box) on a common grid, integer shifts", reference)


def prepare_cog_values(image: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, int]:
    """uint8 with 0 reserved for no data: valid pixels that are 0 become 1 (count returned)."""
    out = image.astype(np.uint8).copy()
    raised = int(((out == 0) & valid).sum())
    out[(out == 0) & valid] = 1
    out[~valid] = 0
    return out, raised


def metres_per_pixel(pixel_deg: float) -> float:
    return pixel_deg * float(mars_crs_definition()["metres_per_degree"])
