"""Raster products derived from a Dem, and writing them as Cloud-Optimized GeoTIFFs (COG) that
OpenLayers reads directly in the browser. All rasters keep the DEM's transform and MARGA's CRS.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import rasterio.shutil
from affine import Affine
from rasterio.crs import CRS as RioCRS
from rasterio.io import MemoryFile

from .crs import mars_crs, mars_crs_definition
from .dem import Dem


def hillshade(dem: Dem, *, azimuth_deg: float = 315.0, altitude_deg: float = 45.0, z_factor: float = 4.0) -> np.ndarray:
    """Hillshade as uint8: 1-255 = shade (dark to light), 0 = no data.

    Gradients use the engine's own Horn implementation (marga_engine.terrain.analysis.horn_gradient)
    with true Mars ground spacing per row, so the shading matches the slopes the router uses.
    z_factor exaggerates relief for display only.
    """
    from marga_engine.terrain.analysis import horn_gradient

    dy, dx_rows = dem.spacing_m()
    dzdx, dzdy = horn_gradient(dem.elevation, dy, dx_rows)
    dzdx, dzdy = dzdx * z_factor, dzdy * z_factor
    az, alt = math.radians(azimuth_deg), math.radians(altitude_deg)
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    shade = np.clip((-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1.0), 0.0, 1.0)
    out = (1 + np.round(254 * shade)).astype(np.float64)
    out[~np.isfinite(shade) | ~np.isfinite(dem.elevation)] = 0
    return out.astype(np.uint8)


def sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_cog(path: str | Path, array: np.ndarray, *, transform: Affine, dtype: str, nodata: float | int,
              description: str, units: str | None = None, predictor: int = 2,
              overview_resampling: str = "average", tags: dict[str, Any] | None = None) -> Path:
    """Write one band as a Cloud-Optimized GeoTIFF in MARGA's CRS (deflate, 256 px tiles, overviews)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    crs = RioCRS.from_wkt(mars_crs().to_wkt())
    profile = dict(
        driver="GTiff", height=array.shape[0], width=array.shape[1], count=1, dtype=dtype,
        crs=crs, transform=transform, nodata=nodata, tiled=True, blockxsize=256, blockysize=256,
    )
    with MemoryFile() as mem:
        with mem.open(**profile) as ds:
            ds.write(array.astype(dtype), 1)
            ds.set_band_description(1, description)
            if units:
                ds.set_band_unit(1, units)
            ds.update_tags(MARGA_CRS=mars_crs_definition()["code"], **{k: str(v) for k, v in (tags or {}).items()})
        with mem.open() as src:
            rasterio.shutil.copy(
                src, path, driver="COG", compress="DEFLATE", predictor=predictor,
                overview_resampling=overview_resampling, blocksize=256,
            )
    return path
