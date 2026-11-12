"""Terrain package sanity checks (spec 9.3), run before a package is used for demonstrations.

The engine never treats no-data as flat ground, but it can only honour no-data that the DEM declares.
A raster whose uncovered area was filled with a constant (0, -32768, ...) and not tagged as no-data
looks "100 % valid" and contains vertical cliffs at the fill boundary. These checks surface that,
plus how the DEM's elevations compare with the science-target catalogue.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .grid import TerrainGrid

FILL_SHARE_WARN = 0.005        # one exact value on >= 0.5 % of valid cells: probably a fill constant
FLAT_SHARE_WARN = 0.02         # >= 2 % of valid cells with slope < 0.05 deg: flat patches, probably fill
TARGET_DIFF_WARN_M = 50.0      # |DEM - catalogue elevation| above this is flagged for the data team


@dataclass
class TargetCheck:
    target_id: str
    name: str
    source_file: str
    catalogue_elevation_m: float | None
    dem_elevation_m: float | None
    slope_deg: float | None
    note: str = ""

    @property
    def diff_m(self) -> float | None:
        if self.catalogue_elevation_m is None or self.dem_elevation_m is None:
            return None
        return self.dem_elevation_m - self.catalogue_elevation_m


@dataclass
class TerrainReport:
    label: str
    synthetic: bool
    status: str
    shape: tuple[int, int]
    cell_size_m: float
    valid_fraction: float
    elevation_m: dict[str, float]
    most_common_value: float | None
    most_common_share: float
    exact_zero_cells: int
    flat_share: float
    slope_deg: dict[str, float]
    targets: list[TargetCheck] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def load_targets(repo: Path) -> list[tuple[str, dict]]:
    """(source file, target) for every ScienceTarget in science_data/**/*.json and the frontend mock data."""
    out: list[tuple[str, dict]] = []
    for f in sorted((repo / "science_data").rglob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8-sig"))
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            data = [{**ft.get("properties", {}), "longitude": ft["geometry"]["coordinates"][0],
                     "latitude": ft["geometry"]["coordinates"][1]} for ft in data.get("features", [])]
        if isinstance(data, list):
            out += [(str(f.relative_to(repo)), t) for t in data
                    if isinstance(t, dict) and {"latitude", "longitude"} <= t.keys()]
    mock = repo / "frontend" / "src" / "services" / "mockData.ts"
    if mock.exists():
        pat = re.compile(r"(?<![\w])id:\s*'([^']+)',\s*name:\s*'([^']*)'[\s\S]*?latitude:\s*(-?[\d.]+),\s*"
                         r"longitude:\s*(-?[\d.]+),\s*elevation_m:\s*(-?[\d.]+)")
        for m in pat.finditer(mock.read_text(encoding="utf-8")):
            out.append((str(mock.relative_to(repo)), {"id": m.group(1), "name": m.group(2), "latitude": float(m.group(3)),
                                                      "longitude": float(m.group(4)), "elevation_m": float(m.group(5))}))
    return out


def check_terrain(t: TerrainGrid, targets: list[tuple[str, dict]] | None = None) -> TerrainReport:
    z = t.elevation
    valid = np.isfinite(z)
    zv = z[valid]
    s = t.slope_deg
    sv = s[np.isfinite(s)]
    d = t.describe()
    md = t.metadata
    warnings: list[str] = []

    if zv.size:
        vals, counts = np.unique(zv, return_counts=True)
        k = int(np.argmax(counts))
        mc_value, mc_share = float(vals[k]), float(counts[k] / zv.size)
        q = np.percentile(zv, [0, 1, 50, 99, 100])
        elev = dict(zip(("min", "p1", "median", "p99", "max"), (float(x) for x in q)))
    else:
        mc_value, mc_share, elev = None, 0.0, {}
    zeros = int(np.count_nonzero(zv == 0.0))
    flat = float(np.count_nonzero(sv < 0.05) / sv.size) if sv.size else 0.0
    slopes = ({"median": float(np.median(sv)), "p95": float(np.percentile(sv, 95)), "max": float(sv.max()),
               "pct_over_15": float(np.mean(sv > 15) * 100), "pct_over_25": float(np.mean(sv > 25) * 100)}
              if sv.size else {})

    if not zv.size:
        warnings.append("The package has no valid elevation cells.")
    if mc_share >= FILL_SHARE_WARN and mc_value is not None:
        warnings.append(f"{mc_share:.1%} of valid cells hold exactly {mc_value:g} m. A real DEM almost never repeats "
                        "one value that often: this is probably a fill value. If so, rebuild the package with "
                        f"--nodata {mc_value:g} so those cells become no-data.")
    if zeros and elev and abs(elev["median"]) > 500:
        warnings.append(f"{zeros} cells are exactly 0 m while the median is {elev['median']:.0f} m: zeros here are "
                        "almost certainly fill, not terrain.")
    if flat >= FLAT_SHARE_WARN:
        warnings.append(f"{flat:.1%} of cells are perfectly flat (slope < 0.05 deg): look for filled or "
                        "interpolated patches.")
    if d["valid_fraction"] < 0.9:
        warnings.append(f"Only {d['valid_fraction']:.1%} of cells have elevation data: check coverage of the "
                        "intended routes.")

    checks: list[TargetCheck] = []
    for src, tg in targets or []:
        tid, name = str(tg.get("id", "?")), str(tg.get("name", tg.get("id", "?")))
        cat = tg.get("elevation_m")
        cat = float(cat) if cat is not None else None
        la, lo = float(tg["latitude"]), float(tg["longitude"])
        if not t.geometry.contains(la, lo):
            checks.append(TargetCheck(tid, name, src, cat, None, None, "outside the package"))
            continue
        dem = float(t.sample_bilinear(np.array([la]), np.array([lo]))[0])
        sl = float(t.sample_nearest(s, np.array([la]), np.array([lo]))[0])
        note = "no elevation data here" if not np.isfinite(dem) else ""
        c = TargetCheck(tid, name, src, cat, dem if np.isfinite(dem) else None, sl if np.isfinite(sl) else None, note)
        if c.diff_m is not None and abs(c.diff_m) > TARGET_DIFF_WARN_M:
            c.note = f"differs from the catalogue by {c.diff_m:+.0f} m"
        checks.append(c)
    flagged = [c for c in checks if c.note]
    if flagged:
        warnings.append(f"{len(flagged)} target(s) need a look (see the target table): wrong coordinates, wrong "
                        "catalogue elevation, a different vertical datum, or a gap in the DEM.")

    return TerrainReport(label=md.label(), synthetic="SYNTHETIC" in md.label().upper() or "synthetic" in (md.status or ""),
                         status=md.status, shape=tuple(d["shape"]), cell_size_m=float(d["cell_size_m"]),
                         valid_fraction=float(d["valid_fraction"]), elevation_m=elev, most_common_value=mc_value,
                         most_common_share=mc_share, exact_zero_cells=zeros, flat_share=flat, slope_deg=slopes,
                         targets=checks, warnings=warnings)
