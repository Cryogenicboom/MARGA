"""Build a site's map layers and its routing terrain package from ONE georeferenced DEM read.

Run from gis/ (Windows paths shown; use .venv/bin/python on macOS/Linux):

    ..\\engine\\.venv\\Scripts\\python -m marga_gis.build_site --site gale ^
        --dem ../data/raw/gale/gale_hirise_dtm_20m.tif --bbox -4.85 137.20 -4.45 137.60 ^
        --provenance ../frontend/public/terrain/gale/terrain.json ^
        --evidence-points ../data/raw/msl/MSL_waypoints.json --evidence-elevation elev_geoid ^
        --evidence-crs-reason "MSL rover localization from NASA MMGIS: planetocentric Mars coordinates"

Writes:
    frontend/public/gis/<site>/elevation.tif   float32 COG, metres, NaN = no data
    frontend/public/gis/<site>/hillshade.tif   uint8 COG (display only), 1-255 shade, 0 = no data
    frontend/public/gis/<site>/layers.json     CRS, transform, bounds, resolution, statistics, provenance
    frontend/public/terrain/<site>/            the route engine's terrain package, from the same pixels

The engine is used read-only (GridGeometry, TerrainGrid, save_package): routing and display share the
same rows, columns and transform by construction.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pyproj
import rasterio

from . import REPO
from .crs import CrsError, describe_crs, mars_crs_definition
from .dem import DemValidationError, inspect_dem, read_dem
from .evidence import verify_latitude_convention
from .raster import hillshade, sha256, write_cog
from .vector import read_mars_vector

HILLSHADE = {"azimuth_deg": 315.0, "altitude_deg": 45.0, "z_factor": 4.0}


def _evidence_text(res: dict, points_path: str) -> str:
    a, b = res["planetocentric"], res["planetographic"]
    return (
        f"{res['points_used']} independent points ({Path(points_path).name}) agree with the DEM to a median "
        f"{a['median_abs_m']:.1f} m (max {a['max_abs_m']:.0f} m) if its latitudes are planetocentric, versus "
        f"{b['median_abs_m']:.1f} m (max {b['max_abs_m']:.0f} m) if planetographic "
        f"(the conventions differ by {res['shift_at_mean_latitude_km']:.2f} km here)"
    )



def _source_label(path: str) -> str:
    """The DEM's path relative to the repository when it is inside it (a bare file name says too little)."""
    p = Path(path).resolve()
    try:
        return p.relative_to(REPO.resolve()).as_posix()
    except ValueError:
        return p.name

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, help="short site id, e.g. gale (output folder name)")
    ap.add_argument("--dem", required=True, help="DEM GeoTIFF (single band, metres, georeferenced)")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("MIN_LAT", "MIN_LON", "MAX_LAT", "MAX_LON"))
    ap.add_argument("--provenance", help="terrain.json whose 'dataset' block describes this DEM (carried over)")
    ap.add_argument("--crs-override", help=f"use the coordinates unchanged as {mars_crs_definition()['code']}")
    ap.add_argument("--crs-evidence", help="recorded reason for --crs-override")
    ap.add_argument("--evidence-points", help="vector file of points with known planetocentric position and elevation")
    ap.add_argument("--evidence-elevation", default="elevation_m", help="elevation column in --evidence-points")
    ap.add_argument("--evidence-crs-reason", help="why --evidence-points coordinates are MARGA Mars coordinates")
    ap.add_argument("--out-gis", help="default: frontend/public/gis/<site>")
    ap.add_argument("--out-terrain", help="default: frontend/public/terrain/<site>")
    ap.add_argument("--no-terrain-package", action="store_true", help="only write the map layers")
    a = ap.parse_args(argv)

    code = mars_crs_definition()["code"]
    out_gis = Path(a.out_gis) if a.out_gis else REPO / "frontend" / "public" / "gis" / a.site
    out_terrain = Path(a.out_terrain) if a.out_terrain else REPO / "frontend" / "public" / "terrain" / a.site
    dataset = json.loads(Path(a.provenance).read_text(encoding="utf-8"))["dataset"] if a.provenance else None

    info = inspect_dem(a.dem)
    print(f"DEM {a.dem}\n  {info['width']} x {info['height']} {info['dtype']}, declared CRS: {info['declared_crs']} "
          f"[{info['declared_crs_kind']}], nodata: {info['nodata']}")

    override, evidence, evidence_result = a.crs_override, a.crs_evidence, None
    if a.evidence_points:
        pts = read_mars_vector(a.evidence_points, assume_marga_crs=a.evidence_crs_reason)
        evidence_result = verify_latitude_convention(a.dem, pts, a.evidence_elevation)
        print(f"latitude convention test on {evidence_result['points_used']} points: "
              f"planetocentric median |dz| {evidence_result['planetocentric']['median_abs_m']:.1f} m, "
              f"planetographic {evidence_result['planetographic']['median_abs_m']:.1f} m -> {evidence_result['verdict']}")
        if info["declared_crs_kind"] == "mars_ellipsoid_geographic":
            if evidence_result["verdict"] != "planetocentric":
                print("  the evidence does not show planetocentric coordinates; refusing to relabel the CRS", file=sys.stderr)
                return 2
            override = code
            evidence = _evidence_text(evidence_result, a.evidence_points)

    try:
        dem = read_dem(a.dem, bbox=tuple(a.bbox) if a.bbox else None, crs_override=override, crs_evidence=evidence)
    except (CrsError, DemValidationError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    print(f"  {dem.crs_note}")
    st = dem.stats()
    dy, dx_rows = dem.spacing_m()
    w, s, e, n = dem.bounds
    print(f"  window rows {dem.window[0]}:{dem.window[0] + dem.window[2]}, cols {dem.window[1]}:{dem.window[1] + dem.window[3]} "
          f"-> {dem.width} x {dem.height}, bounds W{w:.6f} S{s:.6f} E{e:.6f} N{n:.6f}, "
          f"{dem.res[0]:.9f} deg ({dy:.2f} m N-S), elevation {st['min']:.1f} to {st['max']:.1f} m, valid {st['valid_fraction']:.1%}")

    tags = {"MARGA_SOURCE": _source_label(a.dem), "MARGA_DATASET": (dataset or {}).get("dataset_id", "")}
    elev_path = write_cog(out_gis / "elevation.tif", dem.elevation, transform=dem.transform, dtype="float32",
                          nodata=float("nan"), description="elevation", units="m", predictor=3, tags=tags)
    hs_path = write_cog(out_gis / "hillshade.tif", hillshade(dem, **HILLSHADE), transform=dem.transform, dtype="uint8",
                        nodata=0, description="hillshade (display only)", predictor=2, tags=tags)

    # Terrain derivatives with the engine's own functions, on the same grid the router uses.
    from marga_engine.terrain.analysis import detrended_roughness, slope_degrees

    slope = slope_degrees(dem.elevation, dy, dx_rows)
    rough = detrended_roughness(dem.elevation, dy, dx_rows)
    slope_path = write_cog(out_gis / "slope.tif", slope, transform=dem.transform, dtype="float32", nodata=float("nan"),
                           description="terrain slope", units="degree", predictor=3, tags=tags)
    rough_path = write_cog(out_gis / "roughness.tif", rough, transform=dem.transform, dtype="float32", nodata=float("nan"),
                           description="surface roughness", units="m", predictor=3, tags=tags)

    def pct(a: np.ndarray) -> dict[str, float]:
        v = a[np.isfinite(a)]
        return {"min": float(v.min()), "p50": float(np.percentile(v, 50)), "p95": float(np.percentile(v, 95)),
                "p98": float(np.percentile(v, 98)), "max": float(v.max())}

    package_info = None
    if not a.no_terrain_package:
        from marga_engine.terrain.grid import GridGeometry, TerrainGrid, TerrainMetadata
        from marga_engine.terrain.package import save_package

        t = dem.transform
        geom = GridGeometry(north_lat=t.f + 0.5 * t.e, west_lon=t.c + 0.5 * t.a, dlat_deg=-t.e, dlon_deg=t.a,
                            nrows=dem.height, ncols=dem.width, radius_m=float(mars_crs_definition()["radius_m"]))
        md = TerrainMetadata.from_dict(dataset) if dataset else TerrainMetadata(dataset_id=a.site.upper(), name=Path(a.dem).name)
        md.crs = f"{code} ({mars_crs_definition()['name']})"
        md.spatial_resolution_m = round(geom.cell_size_m, 2)
        md.lineage = [
            f"source raster {_source_label(a.dem)}: {info['height']} x {info['width']} px, read with rasterio "
            f"{rasterio.__version__} (GDAL {rasterio.__gdal_version__})",
            f"clipped to rows {dem.window[0]}:{dem.window[0] + dem.window[2]}, cols {dem.window[1]}:{dem.window[1] + dem.window[3]}",
            dem.crs_note,
        ]
        save_package(TerrainGrid(dem.elevation.astype(np.float32), geom, md), out_terrain)
        meta = json.loads((out_terrain / "terrain.json").read_text(encoding="utf-8"))
        package_info = {"path": f"terrain/{a.site}/", "files": meta.get("checksums", {}),
                        "alignment": "same rows, columns and transform as elevation.tif"}

    manifest = {
        "format": "marga-gis-layers",
        "format_version": 1,
        "site": a.site,
        "generated": date.today().isoformat(),
        "crs": {"code": code, "name": mars_crs_definition()["name"], "note": dem.crs_note},
        "declared_crs": describe_crs(dem.declared_crs),
        "crs_evidence": evidence_result,
        "grid": {
            "width": dem.width,
            "height": dem.height,
            "transform": [dem.transform.a, dem.transform.b, dem.transform.c, dem.transform.d, dem.transform.e, dem.transform.f],
            "bounds": [w, s, e, n],
            "resolution_deg": [dem.res[0], dem.res[1]],
            "resolution_m": {"north_south": dy, "east_west_at_centre": float(dx_rows[len(dx_rows) // 2])},
            "pixel_registration": "area (transform gives the outer corner of pixel 0,0)",
        },
        "layers": {
            "elevation": {"file": "elevation.tif", "band": 1, "dtype": "float32", "units": "m", "nodata": "NaN",
                          "min": st["min"], "max": st["max"], "valid_fraction": st["valid_fraction"],
                          "vertical_datum": (dataset or {}).get("vertical_datum"), "sha256": sha256(elev_path)},
            "hillshade": {"file": "hillshade.tif", "band": 1, "dtype": "uint8", "nodata": 0,
                          "values": "1-255 shade (dark to light), 0 = no data; display only, not elevation",
                          **HILLSHADE, "derived_from": "elevation", "sha256": sha256(hs_path)},
            "slope": {"file": "slope.tif", "band": 1, "dtype": "float32", "units": "degree", "nodata": "NaN",
                      "method": "Horn (1981) 3x3 on Mars ground spacing; engine marga_engine.terrain.analysis.slope_degrees "
                                "(the slope the router uses)",
                      **pct(slope), "derived_from": "elevation", "sha256": sha256(slope_path)},
            "roughness": {"file": "roughness.tif", "band": 1, "dtype": "float32", "units": "m", "nodata": "NaN",
                          "method": "RMS of residuals from a least-squares plane in each 3x3 window; engine "
                                    "marga_engine.terrain.analysis.detrended_roughness (the roughness term the router uses)",
                          **pct(rough), "derived_from": "elevation", "sha256": sha256(rough_path)},
        },
        "terrain_package": package_info,
        "dataset": {k: (dataset or {}).get(k) for k in ("dataset_id", "name", "mission", "instrument", "source",
                                                        "status", "synthetic", "limitations")},
        "tools": {"rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__, "pyproj": pyproj.__version__,
                  "proj": pyproj.proj_version_str, "generated_by": "gis/marga_gis/build_site.py"},
    }
    out_gis.mkdir(parents=True, exist_ok=True)
    (out_gis / "layers.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    sizes = ", ".join(f"{p.name} ({p.stat().st_size / 1e6:.2f} MB)" for p in (elev_path, hs_path, slope_path, rough_path))
    print(f"wrote {sizes}, layers.json -> {out_gis}")
    if package_info:
        print(f"wrote terrain package -> {out_terrain} {package_info['files']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
