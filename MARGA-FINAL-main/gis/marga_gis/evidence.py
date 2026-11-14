"""Evidence for a DEM's latitude convention, from independent elevation measurements.

A raster declared on a Mars ellipsoid nominally carries planetographic latitudes; many Mars products
nevertheless store planetocentric latitudes under that label. At 4.7 deg S the two differ by about
3.3 km, so the label alone cannot be trusted. This test samples the DEM at points with known
planetocentric positions and measured elevations under both hypotheses; the right one agrees within
metres, the wrong one by hundreds of metres. It changes no coordinates; it only decides the label.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import rasterio
from pyproj import CRS

from .crs import classify_crs, is_marga_crs
from .dem import sample_bilinear


def ocentric_to_ographic_deg(lat_c: np.ndarray, flattening: float) -> np.ndarray:
    """Planetocentric to planetographic latitude on an ellipsoid of the given flattening."""
    return np.degrees(np.arctan(np.tan(np.radians(lat_c)) / (1.0 - flattening) ** 2))


def verify_latitude_convention(dem_path: str | Path, points: gpd.GeoDataFrame, elevation_column: str) -> dict[str, Any]:
    """Compare DEM elevations with point elevations under both latitude hypotheses.

    points must be in MARGA's CRS (planetocentric). Returns residual statistics and a verdict:
    'planetocentric', 'planetographic' or 'inconclusive'.
    """
    if points.crs is None or not is_marga_crs(points.crs):
        raise ValueError("points must be in MARGA's Mars CRS (planetocentric); see vector.read_mars_vector")
    with rasterio.open(dem_path) as src:
        declared = CRS.from_wkt(src.crs.to_wkt())
        z = src.read(1, masked=True).astype(np.float64).filled(np.nan)
        transform = src.transform
    e = declared.ellipsoid
    flattening = 1.0 - e.semi_minor_metre / e.semi_major_metre
    lons = points.geometry.x.to_numpy()
    lats = points.geometry.y.to_numpy()
    ref = points[elevation_column].to_numpy(dtype=np.float64)

    a = sample_bilinear(z, transform, lons, lats)                                      # file lat = planetocentric
    b = sample_bilinear(z, transform, lons, ocentric_to_ographic_deg(lats, flattening))  # file lat = planetographic
    ok = np.isfinite(a) & np.isfinite(b) & np.isfinite(ref)
    da, db = np.abs(a[ok] - ref[ok]), np.abs(b[ok] - ref[ok])

    def stats(d: np.ndarray) -> dict[str, float]:
        return {"median_abs_m": float(np.median(d)), "p95_abs_m": float(np.percentile(d, 95)), "max_abs_m": float(d.max())}

    result: dict[str, Any] = {
        "points_used": int(ok.sum()),
        "declared_crs_kind": classify_crs(declared),
        "declared_flattening": flattening,
        "shift_at_mean_latitude_km": float(
            abs(ocentric_to_ographic_deg(np.array([np.mean(lats)]), flattening)[0] - np.mean(lats))
            * math.pi / 180 * e.semi_major_metre / 1000
        ),
        "planetocentric": stats(da) if ok.any() else None,
        "planetographic": stats(db) if ok.any() else None,
    }
    if ok.sum() < 10:
        result["verdict"] = "inconclusive"
    else:
        ma, mb = result["planetocentric"]["median_abs_m"], result["planetographic"]["median_abs_m"]
        if ma < 50 and ma < 0.2 * mb:
            result["verdict"] = "planetocentric"
        elif mb < 50 and mb < 0.2 * ma:
            result["verdict"] = "planetographic"
        else:
            result["verdict"] = "inconclusive"
    return result
