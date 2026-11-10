"""Along-route sampling: elevation profile, distances, travel time and terrain classes.

The route polyline is resampled every `step` metres (the DEM cell size - sampling finer would
imply detail the DEM does not have). For samples i = 1..n with horizontal step l_i (haversine on
the reference sphere) and elevation z_i (bilinear from the DEM):

    distance_2d      = sum l_i
    dz_i             = z_i - z_{i-1}
    distance_3d      = sum sqrt(l_i^2 + dz_i^2)
    elevation gain   = sum max(dz_i, 0);  loss = sum max(-dz_i, 0)
    grade_i          = dz_i / l_i                 (signed, direction of travel)
    along-track slope= atan(|grade_i|)            (ElevationPoint.slope_deg)
    time             = sum l_i / v(grade_i)       (eva.mobility)

Terrain slope (Horn, cross-slope included) is reported separately as terrain_slope_deg and
drives the TerrainSummary classes; a step counts in the class of the steeper of its two ends.

Where the DEM has no data (only possible with unknown_policy='penalize'), the elevation is
linearly interpolated along the route and flagged `data_quality = 'interpolated'`, and the step's
travel time assumes the slowest allowed climb, tan(maxSlopeDegrees).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..config import SLOPE_CLASS_FLAT_MAX, SLOPE_CLASS_MODERATE_MAX, SLOPE_CLASS_STEEP_MAX
from ..eva.mobility import MobilityModel
from ..terrain.grid import TerrainGrid


def _haversine_vec(lat1, lon1, lat2, lon2, R):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(((lon2 - lon1 + 180.0) % 360.0) - 180.0)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.minimum(1.0, np.sqrt(a)))


@dataclass
class RouteProfile:
    lat: np.ndarray
    lon: np.ndarray
    leg: np.ndarray              # leg index of each sample
    dist: np.ndarray             # cumulative horizontal metres
    elev: np.ndarray             # metres (interpolated where unknown)
    quality: np.ndarray          # True = DEM value, False = interpolated
    grade: np.ndarray            # rise/run of the step ending at the sample (0 for the first)
    terrain_slope: np.ndarray    # Horn degrees at the sample (NaN unknown)
    time: np.ndarray             # cumulative minutes
    step_class: np.ndarray       # class of the step ending at each sample (object)
    step_len: np.ndarray
    step_dz: np.ndarray
    step_time: np.ndarray

    @property
    def distance_m(self) -> float:
        return float(self.dist[-1])

    @property
    def distance_3d_m(self) -> float:
        return float(np.sqrt(self.step_len ** 2 + self.step_dz ** 2).sum())

    @property
    def gain_m(self) -> float:
        return float(np.clip(self.step_dz, 0, None).sum())

    @property
    def loss_m(self) -> float:
        return float(np.clip(-self.step_dz, 0, None).sum())

    @property
    def time_min(self) -> float:
        return float(self.time[-1])

    @property
    def max_terrain_slope(self) -> float:
        return float(np.nanmax(self.terrain_slope)) if np.isfinite(self.terrain_slope).any() else math.nan

    def summary_fractions(self, mask: np.ndarray | None = None) -> dict[str, float]:
        """Fraction of horizontal distance per terrain class (steps selected by mask)."""
        ln = self.step_len if mask is None else self.step_len * mask
        tot = ln.sum()
        out = {}
        for cls in ("flat", "moderate", "steep", "hazardous", "unknown"):
            out[cls] = float(ln[self.step_class == cls].sum() / tot) if tot > 0 else 0.0
        return out

    def leg_stats(self, k: int) -> dict:
        """Statistics of leg k. Step i (ending at sample i) belongs to the leg of sample i."""
        steps = self.leg == k
        steps[0] = False
        ln = self.step_len[steps]
        dist = float(ln.sum())
        along = np.degrees(np.arctan(np.abs(self.grade[steps])))
        cls = self.step_class[steps]
        ts = self.terrain_slope[steps]
        known = np.isfinite(ts)
        kl = ln[known].sum()
        return {
            "distance_m": dist,
            "time_min": float(self.step_time[steps].sum()),
            "mean_along_track_slope_deg": float((along * ln).sum() / dist) if dist > 0 else 0.0,
            "mean_terrain_slope_deg": float((ts[known] * ln[known]).sum() / kl) if kl > 0 else math.nan,
            "max_terrain_slope_deg": float(ts[known].max()) if known.any() else math.nan,
            "gain_m": float(np.clip(self.step_dz[steps], 0, None).sum()),
            "loss_m": float(np.clip(-self.step_dz[steps], 0, None).sum()),
            "unknown_m": float(ln[cls == "unknown"].sum()),
            "fractions": self.summary_fractions(steps.astype(np.float64)),
        }


def _classify(s: np.ndarray) -> np.ndarray:
    out = np.full(s.shape, "unknown", dtype=object)
    k = np.isfinite(s)
    out[k & (s < SLOPE_CLASS_FLAT_MAX)] = "flat"
    out[k & (s >= SLOPE_CLASS_FLAT_MAX) & (s < SLOPE_CLASS_MODERATE_MAX)] = "moderate"
    out[k & (s >= SLOPE_CLASS_MODERATE_MAX) & (s < SLOPE_CLASS_STEEP_MAX)] = "steep"
    out[k & (s >= SLOPE_CLASS_STEEP_MAX)] = "hazardous"
    return out


def build_profile(terrain: TerrainGrid, legs: list[list[tuple[float, float]]], mobility: MobilityModel,
                  max_slope_deg: float, step_m: float | None = None) -> RouteProfile:
    R = terrain.geometry.radius_m
    step = step_m or terrain.geometry.cell_size_m
    lats, lons, legi = [], [], []
    for k, pts in enumerate(legs):
        for s_i, (p, q) in enumerate(zip(pts, pts[1:])):
            L = float(_haversine_vec(p[0], p[1], q[0], q[1], R))
            n = max(1, int(math.ceil(L / step)))
            t = np.arange(0 if (k == 0 and s_i == 0) else 1, n + 1) / n
            dlon = ((q[1] - p[1] + 180.0) % 360.0) - 180.0
            lats.append(p[0] + (q[0] - p[0]) * t)
            lons.append(p[1] + dlon * t)
            legi.append(np.full(t.size, k))
        if len(pts) == 1 and k == 0:
            lats.append(np.array([pts[0][0]])); lons.append(np.array([pts[0][1]])); legi.append(np.array([0]))
    lat = np.concatenate(lats)
    lon = ((np.concatenate(lons) + 180.0) % 360.0) - 180.0
    leg = np.concatenate(legi)

    z = terrain.sample_bilinear(lat, lon)
    quality = np.isfinite(z)
    step_len = np.zeros(lat.size)
    step_len[1:] = _haversine_vec(lat[:-1], lon[:-1], lat[1:], lon[1:], R)
    dist = np.cumsum(step_len)
    if not quality.all():
        if not quality.any():
            z = np.zeros_like(z)        # no data anywhere on the route: profile is flat-unknown
        else:
            z = np.interp(dist, dist[quality], z[quality])
    dz = np.zeros(lat.size)
    dz[1:] = np.diff(z)
    grade = np.zeros(lat.size)
    nz = step_len > 0
    grade[nz] = dz[nz] / step_len[nz]
    both = quality.copy()
    both[1:] = quality[1:] & quality[:-1]
    g_time = np.where(both, grade, math.tan(math.radians(max_slope_deg)))
    t_step = np.where(nz, mobility.minutes(np.where(nz, step_len, 1.0), g_time), 0.0)
    time = np.cumsum(t_step)

    ts = terrain.sample_nearest(terrain.slope_deg, lat, lon)
    step_slope = ts.copy()
    step_slope[1:] = np.fmax(ts[1:], ts[:-1])
    unknown_step = np.zeros(lat.size, dtype=bool)
    unknown_step[1:] = ~np.isfinite(ts[1:]) | ~np.isfinite(ts[:-1])
    step_slope[unknown_step] = np.nan
    cls = _classify(step_slope)
    return RouteProfile(lat, lon, leg, dist, z, quality, grade, ts, time, cls, step_len, dz, t_step)
