"""Check a terrain package before using it for demonstrations (spec 9.3).

    python tools/check_terrain.py                        (from engine/; checks frontend/public/terrain/gale)
    python tools/check_terrain.py --terrain <package dir>

Reports coverage, elevation range, suspected fill values (a constant written where the DEM has no
data, which would otherwise look "100 % valid"), slope statistics, and the DEM elevation at every
science target next to its catalogue elevation. Exit code 1 if anything needs a look.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
REPO = ENGINE.parent
sys.path.insert(0, str(ENGINE))

from marga_engine.terrain.package import load_package  # noqa: E402
from marga_engine.terrain.validate import check_terrain, load_targets  # noqa: E402


def fmt(x, spec=".0f", empty="-"):
    return empty if x is None else format(x, spec)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--terrain", default=str(REPO / "frontend" / "public" / "terrain" / "gale"))
    a = ap.parse_args()

    t = load_package(a.terrain)
    r = check_terrain(t, load_targets(REPO))

    print(f"Terrain package: {a.terrain}")
    print(f"  dataset   {r.label}  (status: {r.status}{', SYNTHETIC' if r.synthetic else ''})")
    print(f"  grid      {r.shape[0]} x {r.shape[1]} cells at {r.cell_size_m:.2f} m, {r.valid_fraction:.1%} with data")
    e = r.elevation_m
    if e:
        print(f"  elevation min {e['min']:.0f}  p1 {e['p1']:.0f}  median {e['median']:.0f}  p99 {e['p99']:.0f}  max {e['max']:.0f} m")
    print(f"  most common exact value {fmt(r.most_common_value, 'g')} m on {r.most_common_share:.2%} of cells; "
          f"cells exactly 0 m: {r.exact_zero_cells}; flat cells (<0.05 deg): {r.flat_share:.2%}")
    sl = r.slope_deg
    if sl:
        print(f"  slope     median {sl['median']:.1f}  p95 {sl['p95']:.1f}  max {sl['max']:.1f} deg; "
              f"{sl['pct_over_15']:.1f}% over 15 deg, {sl['pct_over_25']:.1f}% over 25 deg")

    if r.targets:
        print("\nScience targets (DEM elevation is bilinear at the target; diff = DEM - catalogue):")
        print(f"  {'target':26s} {'listed in':24s} {'catalogue':>9s} {'DEM':>8s} {'diff':>7s} {'slope':>6s}  note")
        for c in r.targets:
            diff = None if c.diff_m is None else round(c.diff_m, 1) + 0.0
            print(f"  {c.target_id[:26]:26s} {Path(c.source_file).name[:24]:24s} {fmt(c.catalogue_elevation_m):>9s} "
                  f"{fmt(c.dem_elevation_m, '.1f'):>8s} {fmt(diff, '+.1f'):>7s} {fmt(c.slope_deg, '.1f'):>6s}  {c.note}")

    if r.warnings:
        print("\nNeeds a look:")
        for w in r.warnings:
            print(f"  - {w}")
        return 1
    print("\nNo problems found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
