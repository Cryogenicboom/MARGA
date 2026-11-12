"""Turn a DEM GeoTIFF into a MARGA terrain package (terrain.json + elevation.i16, or .f32 if the range needs it).

Example (the Mars Trek Gale export downloaded by tools/fetch_gale_dem.py):

    python tools/build_terrain_package.py \
        --geotiff ../data/raw/gale/gale_hirise_dtm_20m.tif \
        --out ../data/processed/gale/elevation/terrain_package \
        --dataset-id GALE-DEM-001 --site GALE \
        --name "Gale merged HiRISE DEM (Mars Trek Gale_DEM_SMG_1m export)" \
        --mission MRO --instrument "HiRISE (stereo-derived DEM)" \
        --source "<the exact export URL you downloaded>" \
        --bbox -4.85 137.20 -4.45 137.60

Every argument that describes provenance is recorded in the package and shown in every route
response. Leave a field out rather than guessing it.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from marga_engine.terrain.grid import TerrainMetadata  # noqa: E402
from marga_engine.terrain.package import import_geotiff, save_package  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--geotiff", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dataset-id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--site")
    ap.add_argument("--mission")
    ap.add_argument("--instrument")
    ap.add_argument("--source", help="URL or archive product id the file came from")
    ap.add_argument("--vertical-datum", default=None)
    ap.add_argument("--processing-level", default=None)
    ap.add_argument("--observation-period", default=None)
    ap.add_argument("--limitation", action="append", default=[], help="repeatable")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("MIN_LAT", "MIN_LON", "MAX_LAT", "MAX_LON"))
    ap.add_argument("--decimate", type=int, default=1, help="integer block-mean factor (coarser only)")
    ap.add_argument("--radius", type=float, help="body radius in m if the GeoTIFF does not state it")
    ap.add_argument("--lat-ts", type=float, help="standard parallel for equirectangular files without keys")
    ap.add_argument("--center-lon", type=float, help="central meridian for equirectangular files without keys")
    ap.add_argument("--z-scale", type=float, default=1.0, help="multiply raster values to get metres")
    ap.add_argument("--nodata", type=float, help="treat this raster value as no-data (fill the file does not declare)")
    a = ap.parse_args()

    md = TerrainMetadata(dataset_id=a.dataset_id, name=a.name, site_id=a.site, mission=a.mission,
                         instrument=a.instrument, source=a.source, vertical_datum=a.vertical_datum,
                         processing_level=a.processing_level, observation_period=a.observation_period,
                         limitations=a.limitation, status="unvalidated")
    t = import_geotiff(a.geotiff, md, bbox=tuple(a.bbox) if a.bbox else None, decimate=a.decimate,
                       radius_m=a.radius, lat_ts_deg=a.lat_ts, center_lon_deg=a.center_lon, z_scale=a.z_scale,
                       nodata_value=a.nodata)
    out = save_package(t, a.out)
    d = t.describe()
    print(f"package written to {out}")
    print(f"  grid {d['shape'][0]} x {d['shape'][1]}, cell {d['cell_size_m']} m, valid {d['valid_fraction']:.1%}")
    print(f"  bounds {d['bounds']}")
    if d["valid_fraction"] < 0.9:
        print("  WARNING: more than 10% of cells have no elevation data - check coverage of the intended routes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
