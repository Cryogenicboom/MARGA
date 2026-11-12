"""Regional NASA Mars Trek data acquisition and processing for MARGA.

Run from gis/ with the engine's Python environment (see gis/README.md):

    python -m marga_gis.region fetch gale --dry-run     # what would be requested, nothing downloaded
    python -m marga_gis.region fetch gale               # download (resumable; Ctrl+C cancels cleanly)
    python -m marga_gis.region fetch gale --only ctx    # one product
    python -m marga_gis.region build gale               # process into the app's map layers + routing package
    python -m marga_gis.region status gale              # what is in the local package

The products are listed in gis/regions/<region>.json. Originals go to data/regions/<region>/raw/,
provenance to data/regions/<region>/manifest.json; processed layers to frontend/public/gis/<region>/
and the routing package to frontend/public/terrain/<region>/ (format unchanged).
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import warnings
from pathlib import Path
from typing import Any

import numpy as np

from . import REPO
from .crs import mars_crs, mars_crs_definition
from .package import RegionPackage, bbox_tuple, load_region
from .trek import catalog, imageserver, mapserver, wmts
from .trek.net import Cancelled, Downloader, NotFound, Progress, ServiceError, sha256_file, utc_now

FGDC_NOTE = ("Mars Trek's FGDC metadata pages (TrekWS/rest/cat/metadata/fgdc) returned empty responses when checked "
             "(2026-11); provenance is taken from the catalogue record, the service metadata and the request URLs.")


class ProgressPrinter:
    """Throttled one-line progress for bytes (single files) and items (chunks, tiles)."""

    def __init__(self, every_s: float = 1.0):
        self.every_s = every_s
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def _emit(self, key: str, text: str, final: bool) -> None:
        now = time.monotonic()
        with self._lock:
            if final or now - self._last.get(key, 0) >= self.every_s:
                self._last[key] = now
                print(f"    {text}", flush=True)

    @staticmethod
    def _size(n: int) -> str:
        return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB"

    def bytes(self, p: Progress) -> None:
        total = f" of {self._size(p.total_bytes)}" if p.total_bytes else ""
        self._emit(p.label, f"{p.label}: {self._size(p.done_bytes)}{total}", p.total_bytes is not None and p.done_bytes == p.total_bytes)

    def items(self, label: str):
        return lambda done, total: self._emit(label, f"{label}: {done}/{total}", done == total)


def _prev_requests(entry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["file"]: r for r in entry.get("requests", [])}


# --- fetch -------------------------------------------------------------------------------------

def fetch_imageserver(pkg: RegionPackage, dl: Downloader, p: dict[str, Any], printer: ProgressPrinter, dry_run: bool) -> None:
    pid, layer = p["id"], p["layer"]
    info = catalog.image_service_info(dl, layer)
    if "Image" not in (info.get("capabilities") or ""):
        raise ServiceError(f"{layer}: the image service does not allow exports (capabilities {info.get('capabilities')})")
    if "bbox" in p["grid"]:
        grid = imageserver.ExportGrid.from_bbox_size(tuple(p["grid"]["bbox"]), *p["grid"]["size"])
    else:
        pixel_deg = p["grid"]["resolution_m"] / float(mars_crs_definition()["metres_per_degree"])
        grid = imageserver.ExportGrid.covering(*bbox_tuple(pkg.region), pixel_deg)
    chunks = imageserver.plan_chunks(grid, int(info["maxImageWidth"]), int(info["maxImageHeight"]))
    pixel_m = grid.pixel_deg * float(mars_crs_definition()["metres_per_degree"])
    print(f"  {pid}: {layer} export {grid.width} x {grid.height} px at {pixel_m:.2f} m in {len(chunks)} request(s) "
          f"(service limit {info['maxImageWidth']} x {info['maxImageHeight']})")
    if dry_run:
        return
    entry = pkg.product(pid)
    prev = _prev_requests(entry)
    cat = catalog.find_product(dl, layer)
    raw = pkg.raw_dir(pid)
    results = imageserver.fetch_export(dl, layer, grid, raw, pixel_type=p["pixel_type"], interpolation=p["interpolation"],
                                       max_width=int(info["maxImageWidth"]), max_height=int(info["maxImageHeight"]),
                                       on_chunk=printer.items(f"{pid} chunks"))
    requests, checks = [], []
    for ch, res, check in results:
        path = raw / f"export_r{ch.row_off}_c{ch.col_off}.tif"
        if res is not None:
            rec = res.record(pkg.root)
        else:
            rel = path.relative_to(pkg.root).as_posix()
            rec = {**prev.get(rel, {}), "file": rel, "bytes": path.stat().st_size, "sha256": sha256_file(path), "cached": True,
                   "url": imageserver.export_url(layer, ch.grid, pixel_type=p["pixel_type"], interpolation=p["interpolation"])}
        rec.update({"row_off": ch.row_off, "col_off": ch.col_off, "width": ch.grid.width, "height": ch.grid.height})
        requests.append(rec)
        checks.append({"file": rec["file"], **check})
    entry.update({
        "role": p["role"], "service": "imageserver", "layer": layer, "title": p.get("title") or cat.get("title"),
        "catalogue": cat or None, "service_info": info,
        "grid": {"west": grid.west, "north": grid.north, "pixel_deg": grid.pixel_deg, "pixel_m": pixel_m,
                 "width": grid.width, "height": grid.height},
        "requests": requests,
        "validation": {"chunks": checks, "georeferencing_matches_request": all(c["ok"] for c in checks)},
        "status": "complete" if all(c["ok"] for c in checks) else "invalid",
        "fetched_at": utc_now(),
        "notes": [n for n in (p.get("note"), p.get("nodata_reason")) if n] + ([] if cat else ["No catalogue record found for this label."]),
    })


def fetch_wmts(pkg: RegionPackage, dl: Downloader, p: dict[str, Any], printer: ProgressPrinter, dry_run: bool, workers: int) -> None:
    pid, layer = p["id"], p["layer"]
    raw = pkg.raw_dir(pid)
    caps_res = dl.fetch_to_file(wmts.capabilities_url(layer), raw / "WMTSCapabilities.xml",
                                expect=("text/xml", "application/xml", "text/plain"), label=f"{pid} capabilities")
    caps = wmts.parse_capabilities((raw / "WMTSCapabilities.xml").read_text(encoding="utf-8"))
    tm = caps.matrices[p["tile_matrix"]]
    wmts.check_grid(tm)
    rng = wmts.tile_range(tm, *bbox_tuple(pkg.region))
    n = (rng[1] - rng[0] + 1) * (rng[3] - rng[2] + 1)
    pixel_m = tm.pixel_deg * float(mars_crs_definition()["metres_per_degree"])
    print(f"  {pid}: {layer} tile matrix {tm.identifier} ({pixel_m:.2f} m/px), rows {rng[0]}-{rng[1]}, cols {rng[2]}-{rng[3]}: {n} tiles")
    if dry_run:
        return
    cat = catalog.find_product(dl, layer)
    index = wmts.fetch_tiles(dl, caps, layer, tm, rng, raw / "tiles", workers=workers, on_tile=printer.items(f"{pid} tiles"))
    for t in index["tiles"].values():
        t["file"] = Path(t["file"]).resolve().relative_to(pkg.root.resolve()).as_posix()
    wmts.save_index(index, raw / "tiles.json")
    downloaded = sum(1 for t in index["tiles"].values() if not t.get("cached"))
    cached = sum(1 for t in index["tiles"].values() if t.get("cached"))
    complete = len(index["tiles"]) + len(index["missing"]) == index["requested"]
    pkg.product(pid).update({
        "role": p["role"], "service": "wmts", "layer": layer, "title": p.get("title") or cat.get("title"),
        "catalogue": cat or None,
        "capabilities": {**caps_res.record(pkg.root), "tile_matrix_set": caps.tile_matrix_set, "supported_crs": caps.supported_crs,
                         "format": caps.format, "layer_bbox": caps.bbox},
        "tile_matrix": {"identifier": tm.identifier, "pixel_deg": tm.pixel_deg, "pixel_m": pixel_m, "tile_size": [tm.tile_width, tm.tile_height],
                        "matrix_size": [tm.matrix_width, tm.matrix_height], "top_left": [tm.left, tm.top]},
        "tile_range": {"rows": [rng[0], rng[1]], "cols": [rng[2], rng[3]]},
        "tiles": {"requested": index["requested"], "downloaded": downloaded, "cached": cached, "missing": len(index["missing"]),
                  "bytes": sum(t["bytes"] for t in index["tiles"].values()),
                  "index_file": (raw / "tiles.json").relative_to(pkg.root).as_posix(), "index_sha256": sha256_file(raw / "tiles.json")},
        "georeferencing": "from the tile-matrix geometry (top-left -180,90; 256 px tiles; matrix spans 360 deg); "
                          "ScaleDenominator is not used because on Mars Trek it matches only Earth metres per degree",
        "status": "complete" if complete else "incomplete",
        "fetched_at": utc_now(),
        "notes": [n for n in (p.get("note"),) if n] + ([] if cat else ["No catalogue record found for this label."]),
    })


def fetch_vector(pkg: RegionPackage, dl: Downloader, v: dict[str, Any], dry_run: bool) -> None:
    vid, service, layer = v["id"], v["service"], int(v["layer"])
    bbox = bbox_tuple(pkg.region)
    info = catalog.map_service_layer_info(dl, service, layer)
    if dry_run:
        ids = dl.fetch_json(mapserver.ids_url(service, layer, bbox)).get("objectIds") or []
        print(f"  {vid}: {service}/{layer} ({info['geometryType']}): {len(ids)} feature(s) in the region")
        return
    features, files, ids = mapserver.fetch_layer(dl, service, layer, bbox, pkg.raw_dir(vid), max_records=int(info.get("maxRecordCount") or 1000))
    print(f"  {vid}: {service}/{layer}: {len(features)} feature(s)")
    pkg.product(vid).update({
        "role": "vector", "service": "mapserver", "layer": f"{service}/{layer}", "title": v.get("title"),
        "service_info": info, "ids_query": {"url": ids["query_url"], "objectIdFieldName": ids["objectIdFieldName"], "count": len(ids["objectIds"])},
        "requests": [f.record(pkg.root) for f in files],
        "features": len(features),
        "status": "complete", "fetched_at": utc_now(),
    })


def cmd_fetch(region: dict[str, Any], only: set[str] | None, dry_run: bool, workers: int) -> int:
    pkg = RegionPackage(region)
    pkg.note(FGDC_NOTE)
    printer = ProgressPrinter()
    dl = Downloader(on_progress=printer.bytes)
    print(f"{'Planning' if dry_run else 'Fetching'} region '{region['id']}' bbox {bbox_tuple(region)} -> {pkg.root}")
    failed: list[str] = []
    try:
        for p in region.get("products", []):
            if only and p["id"] not in only:
                continue
            try:
                if p["service"] == "imageserver":
                    fetch_imageserver(pkg, dl, p, printer, dry_run)
                elif p["service"] == "wmts":
                    fetch_wmts(pkg, dl, p, printer, dry_run, workers)
                else:
                    raise ValueError(f"unknown service type {p['service']}")
            except (ServiceError, NotFound, ValueError) as e:
                failed.append(p["id"])
                pkg.product(p["id"]).update({"status": "failed", "error": str(e), "fetched_at": utc_now()})
                print(f"  {p['id']}: FAILED: {e}", file=sys.stderr)
            if not dry_run:
                pkg.save()
        for v in region.get("vectors", []):
            if only and v["id"] not in only:
                continue
            try:
                fetch_vector(pkg, dl, v, dry_run)
            except (ServiceError, NotFound, ValueError) as e:
                failed.append(v["id"])
                pkg.product(v["id"]).update({"status": "failed", "error": str(e), "fetched_at": utc_now()})
                print(f"  {v['id']}: FAILED: {e}", file=sys.stderr)
            if not dry_run:
                pkg.save()
    except (KeyboardInterrupt, Cancelled):
        dl.cancel.set()
        if not dry_run:
            pkg.save()
        print("\nCancelled. Completed files are kept in the cache; run fetch again to resume.", file=sys.stderr)
        return 130
    if not dry_run:
        pkg.save()
        print(f"manifest: {pkg.path}")
    return 1 if failed else 0


# --- build -------------------------------------------------------------------------------------

def _write_geojson(gdf, path: Path, crs_note: str) -> None:
    with warnings.catch_warnings():   # GeoPandas can't name a Mars CRS as an OGC URN; the crs member is set below
        warnings.simplefilter("ignore", UserWarning)
        doc = json.loads(gdf.to_json(drop_id=True))
    code = mars_crs_definition()["code"]
    doc["crs"] = {"type": "name", "properties": {"name": code}}
    doc["marga_crs_note"] = crs_note
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")


def _traverse_check(gdf, points_path: Path) -> dict[str, Any] | None:
    """Distance from Curiosity's localized positions (MMGIS) to the Mars Trek traverse line, by sol."""
    if not points_path.exists() or gdf.empty:
        return None
    import geopandas as gpd
    from shapely.ops import unary_union

    pts = gpd.read_file(points_path)
    line = unary_union(list(gdf.geometry))
    lat0 = float(np.mean(pts.geometry.y))
    mpd = float(mars_crs_definition()["metres_per_degree"])
    sx, sy = mpd * np.cos(np.radians(lat0)), mpd
    from shapely import affinity
    line_m = affinity.scale(line, xfact=sx, yfact=sy, origin=(0, 0))
    dist = np.array([line_m.distance(affinity.scale(g, xfact=sx, yfact=sy, origin=(0, 0))) for g in pts.geometry])
    sols = pts["sol"].to_numpy()
    out = {}
    for lo, hi in ((0, 1000), (1000, 2000), (2000, 3000), (3000, 6000)):
        sel = (sols >= lo) & (sols < hi)
        if not sel.any():
            continue
        d = dist[sel]
        out[f"sols {lo}-{hi - 1}"] = {"points": int(len(d)), "median_m": round(float(np.median(d)), 1),
                                      "within_30m": round(float((d <= 30).mean()), 3)}
    # The line ends where the rover was when it was drawn: the last sol whose position is on it, and
    # the first sol after which no position is on it any more.
    on = dist <= 30
    last_on = int(sols[on].max()) if on.any() else None
    later_off = sols[(sols > last_on) & ~on] if last_on is not None else sols
    return {"method": "distance from MMGIS MSL waypoints (planetocentric) to the traverse line, on the Mars sphere",
            "by_sol": out, "latest_sol_on_line": last_on,
            "first_sol_off_line_after_that": int(later_off.min()) if len(later_off) else None,
            "latest_waypoint_sol": int(sols.max())}


def cmd_build(region: dict[str, Any]) -> int:
    import geopandas as gpd
    from shapely.geometry import box

    from .build_site import main as build_site
    from .dem import read_dem
    from .imagery import clip_to_bbox, image_offset_check, metres_per_pixel, prepare_cog_values, registration_check
    from .raster import sha256, write_cog

    pkg = RegionPackage(region)
    site = region["id"]
    products = pkg.doc.get("products", {})
    out_gis = REPO / "frontend" / "public" / "gis" / site
    bbox = bbox_tuple(region)
    code = mars_crs_definition()["code"]

    # 1. DEM -> elevation, hillshade, slope, roughness COGs + the routing package (build_site).
    dem_entry = next((products.get(p["id"]) for p in region["products"] if p["role"] == "elevation"), None)
    if not dem_entry or dem_entry.get("status") != "complete":
        print("the elevation product has not been fetched (run fetch first)", file=sys.stderr)
        return 2
    if len(dem_entry["requests"]) != 1:
        print("multi-chunk elevation exports are not supported by build yet", file=sys.stderr)
        return 2
    dem_file = pkg.root / dem_entry["requests"][0]["file"]
    terrain_json = REPO / "frontend" / "public" / "terrain" / site / "terrain.json"
    ev = region.get("evidence") or {}
    args = ["--site", site, "--dem", str(dem_file), "--bbox", str(bbox[1]), str(bbox[0]), str(bbox[3]), str(bbox[2])]
    if terrain_json.exists():
        args += ["--provenance", str(terrain_json)]
    if ev.get("points") and (REPO / ev["points"]).exists():
        args += ["--evidence-points", str(REPO / ev["points"]), "--evidence-elevation", ev["elevation_column"],
                 "--evidence-crs-reason", ev["reason"]]
    print("DEM:")
    rc = build_site(args)
    if rc != 0:
        return rc
    layers_path = out_gis / "layers.json"
    layers = json.loads(layers_path.read_text(encoding="utf-8"))
    dem = read_dem(dem_file, bbox=(bbox[1], bbox[0], bbox[3], bbox[2]), crs_override=code, crs_evidence=layers["crs"]["note"])
    imagery_crs_note = (
        f"Mars Trek serves this product in spatial reference 104905 (GCS_Mars_2000), like the DEM; its coordinates are "
        f"used unchanged as {code}, as for the DEM (see crs.note), and its registration to the DEM is checked below."
    )

    # 2. Imagery -> 8-bit display COGs clipped to the region, registration-checked against the DEM.
    layers["imagery"] = {}
    clipped: dict[str, tuple[np.ndarray, np.ndarray, Any]] = {}
    for p in region["products"]:
        if p["role"] != "imagery":
            continue
        e = products.get(p["id"])
        if not e or e.get("status") != "complete":
            print(f"imagery {p['id']}: not fetched, skipped")
            continue
        if e["service"] == "imageserver":
            g = e["grid"]
            grid = imageserver.ExportGrid(g["west"], g["north"], g["pixel_deg"], g["width"], g["height"])
            chunk_files = [(imageserver.Chunk(r["row_off"], r["col_off"], imageserver.ExportGrid(
                grid.west + r["col_off"] * grid.pixel_deg, grid.north - r["row_off"] * grid.pixel_deg, grid.pixel_deg, r["width"], r["height"])),
                pkg.root / r["file"]) for r in e["requests"]]
            arr = imageserver.mosaic(grid, chunk_files, "uint8")
            valid = arr != int(p.get("nodata", 0))
            arr, valid, transform, _ = clip_to_bbox(arr, valid, grid.transform, bbox)
            source = {"service": "ImageServer exportImage", "layer": e["layer"], "requests": [r["url"] for r in e["requests"]]}
        else:
            index = json.loads((pkg.root / e["tiles"]["index_file"]).read_text(encoding="utf-8"))
            for t in index["tiles"].values():
                t["file"] = str(pkg.root / t["file"])
            tm = wmts.TileMatrix(e["tile_matrix"]["identifier"], *e["tile_matrix"]["top_left"], *e["tile_matrix"]["tile_size"],
                                 *e["tile_matrix"]["matrix_size"])
            rng = (*e["tile_range"]["rows"], *e["tile_range"]["cols"])
            grey, valid, t0 = wmts.mosaic_tiles(tm, rng, index)
            arr, valid, transform, _ = clip_to_bbox(grey, valid, t0, bbox)
            source = {"service": "WMTS", "layer": e["layer"], "tile_matrix": tm.identifier,
                      "tile_url_template": wmts.TILES + f"/{e['layer']}/1.0.0/default/{e['capabilities']['tile_matrix_set']}/{{z}}/{{row}}/{{col}}.png",
                      "tiles": e["tiles"]}
        coverage = float(valid.mean())
        clipped[p["id"]] = (arr, valid, transform)
        reg = registration_check(arr, valid, transform, dem)
        values, raised = prepare_cog_values(arr, valid)
        path = write_cog(out_gis / f"imagery_{p['id']}.tif", values, transform=transform, dtype="uint8", nodata=0,
                         description=f"{p.get('title', p['id'])} brightness (8-bit)", predictor=2,
                         tags={"MARGA_SOURCE_LAYER": e["layer"]})
        cat = e.get("catalogue") or {}
        layers["imagery"][p["id"]] = {
            "file": path.name, "title": p.get("title") or cat.get("title"), "product_label": e["layer"],
            "catalogue_title": cat.get("title"), "mission": cat.get("mission"), "instrument": cat.get("instrument"),
            "catalogue_created": cat.get("data_created_date"), "resolution_m": round(metres_per_pixel(transform.a), 2),
            "width": int(values.shape[1]), "height": int(values.shape[0]),
            "transform": [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f],
            "dtype": "uint8", "nodata": 0, "values": "8-bit brightness as delivered; 0 = no data"
            + (f"; {raised} valid pixels of value 0 stored as 1" if raised else ""),
            "coverage_fraction": round(coverage, 4), "registration": reg, "crs_note": imagery_crs_note,
            "source": source, "fetched_at": e.get("fetched_at"), "sha256": sha256(path),
        }
        products[p["id"]]["processing"] = {"output": f"frontend/public/gis/{site}/{path.name}", "registration": reg,
                                           "coverage_fraction": round(coverage, 4), "processed_at": utc_now()}
        print(f"imagery {p['id']}: {values.shape[1]} x {values.shape[0]} px at {metres_per_pixel(transform.a):.2f} m, "
              f"coverage {coverage:.1%}, registration to the DEM {reg['verdict']} (offset {reg.get('image_offset_m')}), "
              f"{path.stat().st_size / 1e6:.1f} MB")

    # 2b. Image-to-image cross-check: each coarser product against the finest one, independent of the DEM.
    if len(clipped) > 1:
        ref_id = min(clipped, key=lambda k: clipped[k][2].a)
        for pid, (arr, valid, t) in clipped.items():
            if pid == ref_id:
                continue
            ra, rv, rt = clipped[ref_id]
            xc = image_offset_check(ra, rv, rt, arr, valid, t, bbox, t.a, reference=f"imagery:{ref_id}")
            layers["imagery"][pid]["cross_check"] = xc
            products[pid]["processing"]["cross_check"] = xc
            print(f"imagery {pid} vs {ref_id}: {xc['verdict']} (offset {xc.get('image_offset_m')}, "
                  f"NCC {xc.get('ncc_best')}, {xc.get('peak_significance_sigma')} sigma)")
    # One conclusion per product: its own DEM check when that is decisive; otherwise the image cross-check,
    # if the reference image is itself aligned with the DEM.
    for pid, entry in layers["imagery"].items():
        reg, xc = entry["registration"], entry.get("cross_check")
        if reg["verdict"] != "inconclusive":
            summary = {"verdict": reg["verdict"], "offset_m": reg["image_offset_m"],
                       "basis": "DEM slope check (image edges against DEM slope)"}
        elif xc and xc["verdict"] != "inconclusive" and layers["imagery"][xc["reference"].split(":", 1)[1]]["registration"]["verdict"] == "aligned":
            ref = xc["reference"].split(":", 1)[1]
            ref_title = layers["imagery"][ref]["title"]
            summary = {"verdict": xc["verdict"], "offset_m": xc["image_offset_m"],
                       "basis": f"Image cross-check against the {ref_title}, which is aligned with the DEM "
                                f"(the DEM slope check alone was inconclusive)"}
        else:
            summary = {"verdict": "inconclusive", "offset_m": None, "basis": "No decisive check"}
        entry["registration_summary"] = summary
        products[pid]["processing"]["registration_summary"] = summary
        print(f"imagery {pid}: relative to the DEM {summary['verdict']}"
              + (f", {summary['offset_m']['total']:.0f} m" if summary["offset_m"] else "") + f" ({summary['basis']})")

    # 3. Vectors -> GeoJSON in MARGA's CRS, clipped to the region with Shapely.
    layers["vectors"] = {}
    region_box = box(*bbox)
    for v in region.get("vectors", []):
        e = products.get(v["id"])
        if not e or e.get("status") != "complete":
            print(f"vector {v['id']}: not fetched, skipped")
            continue
        feats = []
        for r in e["requests"]:
            feats.extend(json.loads((pkg.root / r["file"]).read_text(encoding="utf-8")).get("features", []))
        gdf = mapserver.to_geodataframe(feats, mars_crs())
        total = len(gdf)
        gdf = gpd.clip(gdf, region_box) if total else gdf
        gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]
        note = (f"Esri JSON from {e['layer']} in spatial reference 104905; coordinates used unchanged as {code} "
                "(the same Mars Trek convention verified for the DEM).")
        check = _traverse_check(gdf, REPO / ev["points"]) if v["id"] == "curiosity_traverse" and ev.get("points") else None
        out = out_gis / "vectors" / f"{v['id']}.geojson"
        _write_geojson(gdf, out, note)
        layers["vectors"][v["id"]] = {
            "file": f"vectors/{out.name}", "title": v.get("title"), "geometry_type": e["service_info"].get("geometryType"),
            "features_in_region": int(len(gdf)), "features_fetched": total, "clipped_to_region": True,
            "fields": [c for c in gdf.columns if c != "geometry"], "source": e["service_info"]["url"],
            "copyright": e["service_info"].get("copyrightText"), "crs_note": note, "check": check,
            "fetched_at": e.get("fetched_at"), "sha256": sha256(out),
        }
        products[v["id"]]["processing"] = {"output": f"frontend/public/gis/{site}/vectors/{out.name}",
                                           "features_in_region": int(len(gdf)), "check": check, "processed_at": utc_now()}
        print(f"vector {v['id']}: {len(gdf)} of {total} feature(s) in the region" + (f"; traverse covers sols up to {check['latest_sol_on_line']} (waypoints go to {check['latest_waypoint_sol']})" if check else ""))

    layers["acquisition"] = {"package_manifest": f"data/regions/{site}/manifest.json",
                             "source": "NASA Mars Trek (https://trek.nasa.gov/mars/)", "notes": pkg.doc.get("notes", [])}
    layers_path.write_text(json.dumps(layers, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    pkg.save()
    print(f"updated {layers_path}")
    return 0


def cmd_status(region: dict[str, Any]) -> int:
    pkg = RegionPackage(region)
    print(f"region {region['id']}: {pkg.path} ({'exists' if pkg.path.exists() else 'not fetched yet'})")
    for pid, e in pkg.doc.get("products", {}).items():
        files = e.get("requests", [])
        missing = [r["file"] for r in files if not (pkg.root / r["file"]).exists()]
        size = sum(r.get("bytes", 0) for r in files) + (e.get("tiles") or {}).get("bytes", 0)
        extra = f", {e['tiles']['requested']} tiles ({e['tiles']['missing']} outside coverage)" if e.get("tiles") else ""
        print(f"  {pid:22s} {e.get('status', '?'):10s} {size / 1e6:7.1f} MB{extra}, fetched {e.get('fetched_at', '-')}"
              + (f", MISSING FILES {missing}" if missing else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download the region's products from NASA Mars Trek")
    f.add_argument("region")
    f.add_argument("--only", help="comma-separated product ids")
    f.add_argument("--dry-run", action="store_true", help="show the requests without downloading")
    f.add_argument("--workers", type=int, default=6, help="parallel tile downloads (default 6)")
    b = sub.add_parser("build", help="process downloaded products into the app's layers")
    b.add_argument("region")
    s = sub.add_parser("status", help="show the local package")
    s.add_argument("region")
    a = ap.parse_args(argv)
    region = load_region(a.region)
    if a.cmd == "fetch":
        return cmd_fetch(region, set(a.only.split(",")) if a.only else None, a.dry_run, a.workers)
    if a.cmd == "build":
        return cmd_build(region)
    return cmd_status(region)


if __name__ == "__main__":
    raise SystemExit(main())
