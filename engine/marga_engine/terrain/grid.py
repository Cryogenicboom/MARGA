"""Regular latitude/longitude terrain grid with provenance.

Geometry: row 0 is the northernmost row; `north_lat` / `west_lon` are the CENTRES of the first
row/column; spacing is `dlat_deg` / `dlon_deg` (both positive). This is the equirectangular
(simple cylindrical) layout of NASA Mars Trek exports and of USGS equirectangular DEMs once their
metre coordinates are divided by the body radius.

True ground spacing:  dy = R * dlat (rad),  dx(row) = R * cos(lat_row) * dlon (rad).
Using a per-row dx keeps slopes and distances in true metres over the whole grid.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field, replace
from typing import Any

import numpy as np

from ..errors import CoverageError, TerrainDataError
from ..geodesy import MARS_RADIUS_M, lon_delta, normalize_lon
from . import analysis


@dataclass(frozen=True)
class GridGeometry:
    north_lat: float
    west_lon: float
    dlat_deg: float
    dlon_deg: float
    nrows: int
    ncols: int
    radius_m: float = MARS_RADIUS_M

    def __post_init__(self):
        if not (self.dlat_deg > 0 and self.dlon_deg > 0):
            raise TerrainDataError("grid spacing must be positive")
        if self.nrows < 3 or self.ncols < 3:
            raise TerrainDataError("terrain grid must be at least 3 x 3 cells")
        if not (-90 <= self.north_lat <= 90):
            raise TerrainDataError("north_lat out of range")

    # --- coordinates ---------------------------------------------------------------------
    def row_lat(self, r):
        return self.north_lat - np.asarray(r, dtype=np.float64) * self.dlat_deg

    def col_lon(self, c):
        return normalize_lon(self.west_lon + np.asarray(c, dtype=np.float64) * self.dlon_deg)

    def rc(self, lat: float, lon: float) -> tuple[float, float]:
        """Fractional (row, col) of a point; integer values are cell centres."""
        return (self.north_lat - lat) / self.dlat_deg, lon_delta(lon, self.west_lon) / self.dlon_deg

    def contains(self, lat: float, lon: float) -> bool:
        r, c = self.rc(lat, lon)
        return -0.5 <= r <= self.nrows - 0.5 and -0.5 <= c <= self.ncols - 0.5

    @property
    def bounds(self) -> dict[str, float]:
        """Outer cell edges."""
        return {
            "min_lat": self.north_lat - (self.nrows - 0.5) * self.dlat_deg,
            "max_lat": self.north_lat + 0.5 * self.dlat_deg,
            "min_lon": normalize_lon(self.west_lon - 0.5 * self.dlon_deg),
            "max_lon": normalize_lon(self.west_lon + (self.ncols - 0.5) * self.dlon_deg),
        }

    # --- metric spacing ------------------------------------------------------------------
    @property
    def dy_m(self) -> float:
        return self.radius_m * math.radians(self.dlat_deg)

    @property
    def dx_m_rows(self) -> np.ndarray:
        lats = self.row_lat(np.arange(self.nrows))
        return self.radius_m * np.cos(np.radians(lats)) * math.radians(self.dlon_deg)

    @property
    def cell_size_m(self) -> float:
        """Smallest ground spacing in the grid (used as the profile sampling step)."""
        return float(min(self.dy_m, float(self.dx_m_rows.min())))

    def window(self, r0: int, r1: int, c0: int, c1: int) -> "GridGeometry":
        return replace(self, north_lat=float(self.row_lat(r0)),
                       west_lon=float(normalize_lon(self.west_lon + c0 * self.dlon_deg)),
                       nrows=r1 - r0, ncols=c1 - c0)

    def coarsen(self, factor: int) -> "GridGeometry":
        """Geometry of `factor` x `factor` block aggregation (blocks start at row/col 0)."""
        ny, nx = -(-self.nrows // factor), -(-self.ncols // factor)
        off = (factor - 1) / 2.0
        return replace(self, north_lat=self.north_lat - off * self.dlat_deg,
                       west_lon=normalize_lon(self.west_lon + off * self.dlon_deg),
                       dlat_deg=self.dlat_deg * factor, dlon_deg=self.dlon_deg * factor,
                       nrows=max(3, ny), ncols=max(3, nx))


@dataclass
class TerrainMetadata:
    """Dataset record (spec section 19.2) plus the flags the engine needs to stay honest."""
    dataset_id: str
    name: str
    site_id: str | None = None
    mission: str | None = None
    instrument: str | None = None
    data_type: str = "elevation"
    source: str | None = None
    crs: str | None = None
    vertical_datum: str | None = None
    processing_level: str | None = None
    spatial_resolution_m: float | None = None
    observation_period: str | None = None
    synthetic: bool = False
    status: str = "unvalidated"
    limitations: list[str] = field(default_factory=list)
    lineage: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "TerrainMetadata":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})

    def label(self) -> str:
        res = f" ({self.spatial_resolution_m:g} m)" if self.spatial_resolution_m else ""
        return f"{self.name}{res}" + (" [SYNTHETIC TEST TERRAIN]" if self.synthetic else "")


class TerrainGrid:
    """Elevation (m, NaN = no data) on a GridGeometry, plus lazily computed derivatives."""

    def __init__(self, elevation: np.ndarray, geometry: GridGeometry, metadata: TerrainMetadata,
                 roughness: np.ndarray | None = None, *, _slope: np.ndarray | None = None,
                 _dem_roughness: np.ndarray | None = None):
        elev = np.asarray(elevation, dtype=np.float32)
        if elev.shape != (geometry.nrows, geometry.ncols):
            raise TerrainDataError(f"elevation shape {elev.shape} does not match geometry "
                                   f"{(geometry.nrows, geometry.ncols)}")
        elev = np.where(np.isfinite(elev), elev, np.nan).astype(np.float32)
        if not np.isfinite(elev).any():
            raise TerrainDataError("terrain grid contains no valid elevation values")
        if roughness is not None and np.asarray(roughness).shape != elev.shape:
            raise TerrainDataError("roughness layer shape does not match elevation")
        self.elevation = elev
        self.geometry = geometry
        self.metadata = metadata
        self.external_roughness = None if roughness is None else np.asarray(roughness, dtype=np.float32)
        self._slope = _slope
        self._dem_roughness = _dem_roughness

    # --- derived layers ------------------------------------------------------------------
    @property
    def valid(self) -> np.ndarray:
        return np.isfinite(self.elevation)

    @property
    def slope_deg(self) -> np.ndarray:
        if self._slope is None:
            g = self.geometry
            self._slope = analysis.slope_degrees(self.elevation, g.dy_m, g.dx_m_rows).astype(np.float32)
        return self._slope

    @property
    def dem_roughness_m(self) -> np.ndarray:
        if self._dem_roughness is None:
            g = self.geometry
            self._dem_roughness = analysis.detrended_roughness(self.elevation, g.dy_m, g.dx_m_rows).astype(np.float32)
        return self._dem_roughness

    def roughness_layer(self, max_cell_m: float) -> tuple[np.ndarray | None, str]:
        """(roughness metres or None, provenance). External layers win; DEM-derived roughness is
        only used when the DEM is fine enough to say something about walking-scale texture."""
        if self.external_roughness is not None:
            return self.external_roughness, "external roughness layer supplied with the terrain package"
        if self.geometry.cell_size_m <= max_cell_m:
            return self.dem_roughness_m, "detrended 3x3 residual RMS of the DEM"
        return None, (f"omitted: DEM spacing {self.geometry.cell_size_m:.0f} m is coarser than "
                      f"{max_cell_m:g} m, too coarse for walking-scale roughness")

    # --- sub-grids -----------------------------------------------------------------------
    def window(self, r0: int, r1: int, c0: int, c1: int) -> "TerrainGrid":
        """Sub-grid that keeps derivatives computed on the full grid (no artificial edges)."""
        g = self.geometry
        r0, c0 = max(0, r0), max(0, c0)
        r1, c1 = min(g.nrows, r1), min(g.ncols, c1)
        if r1 - r0 < 3 or c1 - c0 < 3:
            raise TerrainDataError("window too small")
        sl = (slice(r0, r1), slice(c0, c1))
        return TerrainGrid(self.elevation[sl], g.window(r0, r1, c0, c1), self.metadata,
                           None if self.external_roughness is None else self.external_roughness[sl],
                           _slope=self.slope_deg[sl], _dem_roughness=self.dem_roughness_m[sl])

    # --- sampling ------------------------------------------------------------------------
    def require_coverage(self, lat: float, lon: float, what: str = "point") -> None:
        if not (np.isfinite(lat) and np.isfinite(lon)):
            raise CoverageError(f"{what} has non-finite coordinates")
        if not self.geometry.contains(lat, lon):
            b = self.geometry.bounds
            raise CoverageError(
                f"{what} ({lat:.5f}, {lon:.5f}) is outside the terrain package "
                f"[lat {b['min_lat']:.4f}..{b['max_lat']:.4f}, lon {b['min_lon']:.4f}..{b['max_lon']:.4f}]")

    def _frac_rc(self, lats, lons):
        g = self.geometry
        lats = np.asarray(lats, dtype=np.float64)
        lons = np.asarray(lons, dtype=np.float64)
        r = (g.north_lat - lats) / g.dlat_deg
        c = (((lons - g.west_lon + 180.0) % 360.0) - 180.0) / g.dlon_deg
        return r, c

    def sample_bilinear(self, lats, lons) -> np.ndarray:
        """Bilinear elevation; NaN if any of the four surrounding cells is no-data or the point is
        outside the grid. No interpolation across data gaps."""
        r, c = self._frac_rc(lats, lons)
        ny, nx = self.elevation.shape
        rr = np.clip(r, 0, ny - 1)
        cc = np.clip(c, 0, nx - 1)
        r0 = np.clip(np.floor(rr).astype(np.int64), 0, ny - 2)
        c0 = np.clip(np.floor(cc).astype(np.int64), 0, nx - 2)
        fr, fc = rr - r0, cc - c0
        z = self.elevation.astype(np.float64)
        v = ((z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr)
             + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr)
        outside = (r < -0.5) | (r > ny - 0.5) | (c < -0.5) | (c > nx - 0.5)
        return np.where(outside, np.nan, v)

    def sample_nearest(self, layer: np.ndarray, lats, lons) -> np.ndarray:
        r, c = self._frac_rc(lats, lons)
        ny, nx = layer.shape
        ri = np.clip(np.rint(r).astype(np.int64), 0, ny - 1)
        ci = np.clip(np.rint(c).astype(np.int64), 0, nx - 1)
        out = layer[ri, ci].astype(np.float64)
        outside = (r < -0.5) | (r > ny - 0.5) | (c < -0.5) | (c > nx - 0.5)
        return np.where(outside, np.nan, out)

    def describe(self) -> dict[str, Any]:
        g = self.geometry
        return {
            "dataset": self.metadata.to_dict(),
            "label": self.metadata.label(),
            "shape": [g.nrows, g.ncols],
            "bounds": g.bounds,
            "cell_size_m": round(g.cell_size_m, 3),
            "radius_m": g.radius_m,
            "valid_fraction": round(float(self.valid.mean()), 6),
        }
