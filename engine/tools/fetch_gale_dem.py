"""Download the Gale Crater DEM used by the baseline app and package it for the engine.

Run on a machine with internet access (from engine/ or the repo root):

    python tools/fetch_gale_dem.py                 (then: python tools/check_terrain.py)
    python tools/fetch_gale_dem.py --nodata 0      (if check_terrain reports 0 as a fill value)

Source: the NASA Mars Trek ImageServer export of the Gale_DEM_SMG_1m layer at ~20 m/px, exactly
as in the baseline repository's scripts/fetch_data.py (MRO HiRISE-derived 1 m DEM of the
Curiosity traverse, served by Mars Trek). The file is ~16 MB and is NOT committed to git
(data/raw is git-ignored, spec section 20). The package is written to frontend/public/terrain/gale,
replacing the synthetic demo, so the browser engine and the Python service both pick it up.

After building, check the package before using it for demonstrations (spec 9.3):
python tools/check_terrain.py. Cells the export marks as no-data are never treated as flat, but if
the server writes a constant (for example 0) where the DEM has no data, the file looks complete;
check_terrain reports that, and --nodata <value> rebuilds the package with those cells masked.
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from marga_engine.terrain.grid import TerrainMetadata  # noqa: E402
from marga_engine.terrain.package import import_geotiff, save_package  # noqa: E402

GALE_EXPORT = ("https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/exportImage"
               "?bbox=137.12247113204074,-4.925474311955841,137.72981290693286,-4.248963057145466&bboxSR=104905"
               "&imageSR=104905&size=1800,2005&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image")
RAW = ROOT / "data" / "raw" / "gale" / "gale_hirise_dtm_20m.tif"
OUT = ROOT / "frontend" / "public" / "terrain" / "gale"     # replaces the synthetic demo package
MARGA_GALE_BBOX = (-4.85, 137.20, -4.45, 137.60)     # frontend mockData GALE_CRATER_METADATA


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nodata", type=float, help="treat this raster value as no-data (an undeclared fill value)")
    a = ap.parse_args()
    if not RAW.exists() or RAW.stat().st_size < 14_000_000:
        RAW.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading Mars Trek Gale DEM export (~16 MB) -> {RAW}")
        tmp = RAW.with_suffix(".part")
        urllib.request.urlretrieve(GALE_EXPORT, tmp)
        if tmp.stat().st_size < 14_000_000:
            raise SystemExit("download looks incomplete; try again")
        tmp.replace(RAW)
    md = TerrainMetadata(
        dataset_id="GALE-DEM-001",
        name="Gale merged HiRISE DEM (Mars Trek Gale_DEM_SMG_1m), ~20 m export",
        site_id="GALE", mission="MRO", instrument="HiRISE (stereo-derived DEM)", source=GALE_EXPORT,
        vertical_datum="as served by Mars Trek (MOLA-referenced)",
        processing_level="Mars Trek ImageServer export, bilinear resampling to ~20 m",
        limitations=["Resampled from a 1 m DEM to ~20 m: features smaller than ~20 m are not represented.",
                     "Cells the export marks as no-data are never treated as flat; run tools/check_terrain.py "
                     "to look for undeclared fill values.",
                     "Coverage and vertical datum must be verified by the data team before operational use."],
        status="unvalidated")
    t = import_geotiff(RAW, md, bbox=MARGA_GALE_BBOX, nodata_value=a.nodata)
    save_package(t, OUT)
    d = t.describe()
    print(f"package: {OUT}\n  {d['shape'][0]} x {d['shape'][1]} cells, {d['cell_size_m']} m, valid {d['valid_fraction']:.1%}")
    print("next: python engine/tools/check_terrain.py   (coverage, fill values, catalogue elevations)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
