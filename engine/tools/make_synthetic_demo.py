"""Build the labelled SYNTHETIC Gale demo terrain package used by the frontend and the engine.

    python tools/make_synthetic_demo.py            (from engine/)

Output: frontend/public/terrain/gale/ (terrain.json + elevation.i16), served statically by Vite so
the browser engine can route offline. The grid uses the region's 25 m spacing
(GALE_CRATER_METADATA.resolution_m_per_pixel) and its surface is pinned to the elevation_m of the
repo's science targets:

  * science_data/catalogue/*.json                 (Person 3's ScienceTarget catalogue)
  * frontend/src/services/mockData.ts              (targets the UI currently lists)

so the elevation profile between two targets agrees with the catalogue. Every route computed on
it is flagged "SYNTHETIC TEST TERRAIN". Replace it with a real DEM package (tools/fetch_gale_dem.py)
as soon as one is validated.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
REPO = ENGINE.parent
sys.path.insert(0, str(ENGINE))

from marga_engine.terrain.package import save_package  # noqa: E402
from marga_engine.terrain.synthetic import gale_demo  # noqa: E402

OUT = REPO / "frontend" / "public" / "terrain" / "gale"
BOX = (-4.85, -4.45, 137.20, 137.60)


def catalogue_anchors() -> tuple[list[tuple[float, float, float]], list[str]]:
    seen: dict[str, tuple[float, float, float]] = {}
    sources = []
    for f in sorted((REPO / "science_data").rglob("*.json")):
        try:
            data = json.loads(f.read_text())
        except ValueError:
            continue
        if isinstance(data, list) and data and "elevation_m" in data[0]:
            for t in data:
                seen.setdefault(t["id"], (float(t["latitude"]), float(t["longitude"]), float(t["elevation_m"])))
            sources.append(str(f.relative_to(REPO)))
    mock = REPO / "frontend" / "src" / "services" / "mockData.ts"
    if mock.exists():
        txt = mock.read_text()
        pat = re.compile(r"(?<![\w])id:\s*'([^']+)',\s*name:[\s\S]*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+),\s*elevation_m:\s*(-?[\d.]+)")
        n0 = len(seen)
        for m in pat.finditer(txt):
            seen.setdefault(m.group(1), (float(m.group(2)), float(m.group(3)), float(m.group(4))))
        if len(seen) > n0:
            sources.append(str(mock.relative_to(REPO)))
    unique = {(round(v[0], 6), round(v[1], 6)): v for v in seen.values()}      # one anchor per location
    inside = [v for v in unique.values() if BOX[0] <= v[0] <= BOX[1] and BOX[2] <= v[1] <= BOX[3]]
    return inside, sources


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", type=float, default=25.0)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--no-anchors", action="store_true")
    a = ap.parse_args()
    anchors, sources = ([], []) if a.no_anchors else catalogue_anchors()
    t = gale_demo(a.cell, anchors=anchors or None, anchor_source=", ".join(sources) or None)
    save_package(t, a.out)
    d = t.describe()
    print(f"wrote {a.out}: {d['shape']} cells at {d['cell_size_m']} m, {len(anchors)} anchors (SYNTHETIC)")
