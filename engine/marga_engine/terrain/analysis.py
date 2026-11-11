"""Terrain derivatives computed from a DEM grid (row 0 = north, columns increase eastward).

Slope - Horn (1981) 3x3 finite differences, the method used by GDAL `gdaldem slope`:

        a b c        dz/dx = ((c + 2f + i) - (a + 2d + g)) / (8 dx)      (x = east)
        d e f        dz/dy = ((a + 2b + c) - (g + 2h + i)) / (8 dy)      (y = north)
        g h i        S     = atan( sqrt( (dz/dx)^2 + (dz/dy)^2 ) )

dx is the true east-west ground spacing of the row (it shrinks with cos(latitude) on a
geographic grid) and dy the north-south spacing, both in metres, so slope is in true degrees.
Any no-data value inside the 3x3 window makes the slope unknown (NaN): a cell next to a data gap
is not treated as flat. At the outer edge of the grid the DEM is extended by odd reflection
(2 z_edge - z_inner), which is exact for planar ground and avoids halving the edge gradient.

Roughness - detrended residual RMS: fit the least-squares plane through the 3x3 window and take
the RMS of the nine residuals. A perfectly planar slope therefore has zero roughness, so this
term does not double-count steepness. It describes surface texture at the DEM's own scale only.
"""
from __future__ import annotations

import numpy as np

from ..config import SLOPE_CLASS_FLAT_MAX, SLOPE_CLASS_MODERATE_MAX, SLOPE_CLASS_STEEP_MAX
from ..errors import TerrainDataError


def _windows(elev: np.ndarray):
    if elev.ndim != 2 or elev.shape[0] < 2 or elev.shape[1] < 2:
        raise TerrainDataError("terrain grid must be 2-D with at least 2 rows and 2 columns")
    z = np.pad(elev.astype(np.float64), 1, mode="reflect", reflect_type="odd")
    return (z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:],
            z[1:-1, :-2], z[1:-1, 1:-1], z[1:-1, 2:],
            z[2:, :-2], z[2:, 1:-1], z[2:, 2:])


def horn_gradient(elev: np.ndarray, dy_m: float, dx_m_rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(dz/dx east, dz/dy north), both rise/run, NaN where the 3x3 window has no-data."""
    a, b, c, d, _e, f, g, h, i = _windows(elev)
    dx = np.asarray(dx_m_rows, dtype=np.float64)[:, None]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx)
    dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8.0 * dy_m)
    return dzdx, dzdy


def slope_degrees(elev: np.ndarray, dy_m: float, dx_m_rows: np.ndarray) -> np.ndarray:
    dzdx, dzdy = horn_gradient(elev, dy_m, dx_m_rows)
    s = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    s[~np.isfinite(elev)] = np.nan       # Horn ignores the centre value; a no-data cell has no slope
    return s


def detrended_roughness(elev: np.ndarray, dy_m: float, dx_m_rows: np.ndarray) -> np.ndarray:
    """RMS (m) of residuals from the least-squares plane through each 3x3 window."""
    a, b, c, d, e, f, g, h, i = _windows(elev)
    dx = np.asarray(dx_m_rows, dtype=np.float64)[:, None]
    zs = (a, b, c, d, e, f, g, h, i)
    xs = (-1, 0, 1, -1, 0, 1, -1, 0, 1)   # column offset (east)
    ys = (1, 1, 1, 0, 0, 0, -1, -1, -1)   # row offset (north)
    mean = sum(zs) / 9.0
    gx = ((c + f + i) - (a + d + g)) / (6.0 * dx)
    gy = ((a + b + c) - (g + h + i)) / (6.0 * dy_m)
    ss = np.zeros_like(mean)
    for z, xo, yo in zip(zs, xs, ys):
        r = z - (mean + gx * (xo * dx) + gy * (yo * dy_m))
        ss += r * r
    return np.sqrt(ss / 9.0)


def slope_class(slope_deg: float) -> str:
    """Terrain class used by TerrainSummary. NaN -> 'unknown'."""
    if slope_deg != slope_deg:  # NaN
        return "unknown"
    if slope_deg < SLOPE_CLASS_FLAT_MAX:
        return "flat"
    if slope_deg < SLOPE_CLASS_MODERATE_MAX:
        return "moderate"
    if slope_deg < SLOPE_CLASS_STEEP_MAX:
        return "steep"
    return "hazardous"
