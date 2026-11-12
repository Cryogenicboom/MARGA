"""Read a DEM as a georeferenced raster with Rasterio, keeping its CRS, transform, bounds,
resolution and no-data value, and refusing anything that is not an elevation raster.

What counts as an elevation raster here: one band of float or 16/32-bit integer values, georeferenced
(a CRS and a north-up affine transform), with values inside the range of Mars surface elevations.
A greyscale or colour image, a palette image, or an un-georeferenced raster is rejected.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from pyproj import CRS
from rasterio.enums import ColorInterp
from rasterio.windows import Window

from .crs import CrsError, classify_crs, describe_crs, is_marga_crs, mars_crs, mars_crs_definition

# Mars surface elevations relative to the areoid: about -8.2 km (Hellas) to +21.9 km (Olympus Mons).
MARS_ELEVATION_RANGE_M = (-9_000.0, 22_500.0)
_ELEVATION_DTYPES = {"float32", "float64", "int16", "int32"}
_METRE_UNITS = {"", "m", "metre", "metres", "meter", "meters"}


class DemValidationError(ValueError):
    """The raster is not a usable elevation raster."""


@dataclass
class Dem:
    """A georeferenced elevation raster. Row 0 is north; coordinates are [longitude, latitude]."""

    elevation: np.ndarray            # float64 metres, NaN = no data
    transform: Affine                # pixel corner -> (lon, lat) in `crs`
    crs: CRS                         # the CRS the coordinates are in (MARGA's Mars CRS)
    declared_crs: CRS                # the CRS the file declares
    crs_note: str                    # how `crs` was established from `declared_crs`
    nodata: float | None             # declared no-data value (None if the file declares none)
    source: str
    window: tuple[int, int, int, int]  # row_off, col_off, height, width in the source raster
    source_dtype: str
    units: str
    tags: dict[str, Any] = field(default_factory=dict)

    @property
    def height(self) -> int:
        return int(self.elevation.shape[0])

    @property
    def width(self) -> int:
        return int(self.elevation.shape[1])

    @property
    def res(self) -> tuple[float, float]:
        """(degrees of longitude, degrees of latitude) per pixel."""
        return (self.transform.a, -self.transform.e)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """(west, south, east, north) of the outer pixel edges."""
        t = self.transform
        return (t.c, t.f + t.e * self.height, t.c + t.a * self.width, t.f)

    def stats(self) -> dict[str, float]:
        v = self.elevation[np.isfinite(self.elevation)]
        return {
            "min": float(v.min()),
            "max": float(v.max()),
            "valid_fraction": float(v.size / self.elevation.size),
        }

    def spacing_m(self) -> tuple[float, np.ndarray]:
        """North-south spacing (m) and the east-west spacing of every row (m) on the Mars sphere."""
        r = float(mars_crs_definition()["radius_m"])
        dlon, dlat = self.res
        dy = r * math.radians(dlat)
        lat_rows = self.transform.f + (np.arange(self.height) + 0.5) * self.transform.e
        dx_rows = r * np.cos(np.radians(lat_rows)) * math.radians(dlon)
        return dy, dx_rows


def _pyproj(src_crs) -> CRS | None:
    return None if src_crs is None else CRS.from_wkt(src_crs.to_wkt())


def validate_elevation_raster(src: rasterio.io.DatasetReader) -> None:
    """Raise DemValidationError unless `src` looks like a georeferenced single-band elevation raster."""
    if src.count != 1:
        raise DemValidationError(
            f"{src.name}: {src.count} bands. An elevation raster has one band; a 3- or 4-band file is a colour image."
        )
    dtype = src.dtypes[0]
    if dtype not in _ELEVATION_DTYPES:
        raise DemValidationError(
            f"{src.name}: data type {dtype}. Elevation must be float32/float64 or int16/int32; "
            "an 8-bit raster is an image (for example a hillshade or greyscale map), not elevation."
        )
    if src.colorinterp and src.colorinterp[0] == ColorInterp.palette:
        raise DemValidationError(f"{src.name}: palette (colour-mapped) image, not an elevation raster.")
    if src.crs is None:
        raise DemValidationError(f"{src.name}: no CRS. A DEM must state its coordinate reference system.")
    t = src.transform
    if t == Affine.identity():
        raise DemValidationError(f"{src.name}: no geotransform (pixel coordinates only); not georeferenced.")
    if t.b != 0 or t.d != 0:
        raise DemValidationError(f"{src.name}: rotated or sheared grid; only north-up rasters are supported.")
    if not (t.a > 0 and t.e < 0):
        raise DemValidationError(f"{src.name}: expected a north-up grid (positive x step, negative y step).")
    unit = (src.units[0] or "").strip().lower() if src.units else ""
    if unit not in _METRE_UNITS:
        raise DemValidationError(f"{src.name}: elevation unit is '{unit}', expected metres.")


def inspect_dem(path: str | Path) -> dict[str, Any]:
    """What the file declares, without accepting it (for reports and the CLI)."""
    with rasterio.open(path) as src:
        declared = _pyproj(src.crs)
        return {
            "path": str(path),
            "driver": src.driver,
            "width": src.width,
            "height": src.height,
            "count": src.count,
            "dtype": src.dtypes[0],
            "nodata": src.nodata,
            "transform": list(src.transform)[:6],
            "bounds": list(src.bounds),
            "res": list(src.res),
            "declared_crs": describe_crs(declared) if declared else None,
            "declared_crs_kind": classify_crs(declared) if declared else None,
            "units": src.units[0] if src.units else None,
        }


def window_for_bbox(transform: Affine, height: int, width: int,
                    bbox: tuple[float, float, float, float]) -> Window:
    """Whole cells covering (min_lat, min_lon, max_lat, max_lon), plus one cell on the south/east side.

    This is the same rule as engine/marga_engine/terrain/package.py import_geotiff, so a DEM clipped
    here and the engine's terrain package share exactly the same rows and columns.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    dlon, dlat = transform.a, -transform.e
    west_c = transform.c + 0.5 * dlon          # centre of the first column
    north_c = transform.f - 0.5 * dlat         # centre of the first row
    r0 = max(0, int(math.floor((north_c - max_lat) / dlat)))
    r1 = min(height, int(math.ceil((north_c - min_lat) / dlat)) + 1)
    c0 = max(0, int(math.floor(((min_lon - west_c + 180) % 360 - 180) / dlon)))
    c1 = min(width, int(math.ceil(((max_lon - west_c + 180) % 360 - 180) / dlon)) + 1)
    if r1 - r0 < 3 or c1 - c0 < 3:
        raise DemValidationError("bbox does not overlap the raster (or covers fewer than 3 x 3 cells)")
    return Window(col_off=c0, row_off=r0, width=c1 - c0, height=r1 - r0)


def resolve_crs(declared: CRS | None, crs_override: str | None, crs_evidence: str | None) -> tuple[CRS, str]:
    """MARGA's CRS for data declared in `declared`, or CrsError. Never transforms coordinates."""
    code = mars_crs_definition()["code"]
    if declared is None:
        raise CrsError("the raster declares no CRS; MARGA will not guess one")
    kind = classify_crs(declared)
    desc = describe_crs(declared)
    if kind == "mars_sphere_geographic":
        return mars_crs(), f"Declared CRS {desc} is MARGA's Mars CRS ({code}); used as is."
    if kind == "earth":
        raise CrsError(
            f"declared CRS {desc} is an Earth CRS. Mars data must not be georeferenced to Earth; "
            "fix the source file's georeferencing."
        )
    if kind == "mars_projected":
        raise CrsError(
            f"declared CRS {desc} is a projected Mars CRS. Reprojecting to MARGA's geographic CRS is not "
            "implemented yet; export the DEM in geographic coordinates."
        )
    if kind == "mars_ellipsoid_geographic":
        if crs_override is None:
            raise CrsError(
                f"declared CRS {desc} is a Mars ellipsoid, so its latitudes would be planetographic. MARGA uses "
                f"planetocentric latitudes ({code}). Either the file's coordinates are really planetocentric "
                "(pass crs_override with recorded evidence, e.g. from evidence.verify_latitude_convention), or "
                "they must be converted, which this step does not do."
            )
        if not is_marga_crs(crs_override):
            raise CrsError(f"crs_override must be MARGA's CRS ({code}), got {crs_override}")
        if not (crs_evidence and crs_evidence.strip()):
            raise CrsError("a CRS override needs recorded evidence (crs_evidence)")
        return mars_crs(), (
            f"The file declares {desc}. Its coordinate values are used unchanged as {code} "
            f"(planetocentric latitude), because: {crs_evidence.strip()}"
        )
    raise CrsError(f"unrecognised CRS {desc}")


def read_dem(path: str | Path, *, bbox: tuple[float, float, float, float] | None = None,
             crs_override: str | None = None, crs_evidence: str | None = None) -> Dem:
    """Read, validate and (optionally) clip a DEM. No-data cells become NaN."""
    with rasterio.open(path) as src:
        validate_elevation_raster(src)
        declared = _pyproj(src.crs)
        crs, note = resolve_crs(declared, crs_override, crs_evidence)
        window = (window_for_bbox(src.transform, src.height, src.width, bbox) if bbox
                  else Window(0, 0, src.width, src.height))
        band = src.read(1, window=window, masked=True)
        elev = np.ma.filled(band.astype(np.float64), np.nan)
        elev[~np.isfinite(elev)] = np.nan
        transform = src.window_transform(window)
        dem = Dem(
            elevation=elev,
            transform=transform,
            crs=crs,
            declared_crs=declared,
            crs_note=note,
            nodata=src.nodata,
            source=str(path),
            window=(int(window.row_off), int(window.col_off), int(window.height), int(window.width)),
            source_dtype=src.dtypes[0],
            units="m",
            tags=dict(src.tags()),
        )
    finite = dem.elevation[np.isfinite(dem.elevation)]
    if finite.size == 0:
        raise DemValidationError(f"{path}: no valid elevation values in the requested area")
    lo, hi = float(finite.min()), float(finite.max())
    if lo < MARS_ELEVATION_RANGE_M[0] or hi > MARS_ELEVATION_RANGE_M[1]:
        raise DemValidationError(
            f"{path}: values {lo:.1f} to {hi:.1f} fall outside Mars surface elevations "
            f"({MARS_ELEVATION_RANGE_M[0]:.0f} to {MARS_ELEVATION_RANGE_M[1]:.0f} m); not an elevation raster in metres?"
        )
    return dem


def sample_bilinear(elev: np.ndarray, transform: Affine, lons, lats) -> np.ndarray:
    """Bilinear elevation at (lon, lat) points in the raster's own CRS; NaN outside or near no-data."""
    lons = np.asarray(lons, dtype=np.float64)
    lats = np.asarray(lats, dtype=np.float64)
    c = (lons - transform.c) / transform.a - 0.5
    r = (lats - transform.f) / transform.e - 0.5
    h, w = elev.shape
    ok = (r >= 0) & (r < h - 1) & (c >= 0) & (c < w - 1)
    out = np.full(lons.shape, np.nan)
    r0 = np.floor(r[ok]).astype(int)
    c0 = np.floor(c[ok]).astype(int)
    fr = r[ok] - r0
    fc = c[ok] - c0
    out[ok] = ((elev[r0, c0] * (1 - fc) + elev[r0, c0 + 1] * fc) * (1 - fr)
               + (elev[r0 + 1, c0] * (1 - fc) + elev[r0 + 1, c0 + 1] * fc) * fr)
    return out
