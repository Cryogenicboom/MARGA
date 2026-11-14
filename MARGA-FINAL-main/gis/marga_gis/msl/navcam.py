"""Navcam rover views: 360-degree panoramas at Curiosity stops, from NASA's raw Navcam frames.

Source: the MSL raw-image API (https://mars.nasa.gov/api/v1/raw_image_items/), which gives for each
full-frame Navcam image its site and drive (RMC), CAHVOR camera model, rover attitude and the JPEG URL
(credit NASA/JPL-Caltech). Stops are placed with NASA's MSL localisation by exact RMC.

Stop selection: for each Curiosity-visited catalogue target, the localised stop nearest it whose left
Navcam full frames cover at least MIN_OCTANTS of the 8 azimuth octants, plus the nearest such stops
before and after it along the traverse, so the viewer can step along the route.
"""
from __future__ import annotations

import json
import math
import re
import urllib.parse
import warnings
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from . import RAW, REPO, ROVER_OUT, WAYPOINTS_FILE, Manifest, rel
from .camera import Cahvor, Frame, PanoGrid, dem_horizon, detect_skyline, frame_gains, parse_vector, quat_matrix, render, skyline_offset, yaw_deg
from .waypoints import Waypoint, Waypoints, distance_m
from ..trek.net import Downloader, NotFound, sha256_file, utc_now

API = "https://mars.nasa.gov/api/v1/raw_image_items/"
INSTRUMENTS = "NAV_LEFT_A,NAV_LEFT_B"
MIN_OCTANTS = 6
TARGET_RADIUS_M = 150.0
NEIGHBOUR_WINDOW = 12  # waypoints before/after a target stop searched for neighbour stops
GRID = PanoGrid(width=4096, height=1024, el_top=20.0, el_bottom=-60.0)
# Frames pointed higher than this are sky observations (clouds, atmosphere), not part of a terrain panorama.
MAX_FRAME_EL_DEG = 15.0
JPEG_QUALITY = 80

# Catalogue entries that are not Curiosity stops (docs/data_sources.md "Placeholders").
PLACEHOLDER_TARGETS = {"target_crater_rim_fault", "target_rad_station_alpha"}
_TARGET_RE = re.compile(r"id:\s*'(target_[a-z_0-9]+)',\s*name:\s*'([^']+)'.*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+)", re.S)


def catalogue_targets() -> list[dict[str, Any]]:
    """Curiosity-visited targets from the app's catalogue (frontend/src/services/mockData.ts)."""
    src = (REPO / "frontend" / "src" / "services" / "mockData.ts").read_text(encoding="utf-8")
    out = []
    for m in _TARGET_RE.finditer(src):
        if m.group(1) in PLACEHOLDER_TARGETS:
            continue
        out.append({"id": m.group(1), "name": m.group(2), "lat": float(m.group(3)), "lon": float(m.group(4))})
    return out


def query_url(sol_lo: int, sol_hi: int, page: int, per_page: int = 500) -> str:
    q = {"order": "sol asc", "per_page": per_page, "page": page, "condition_1": "msl:mission",
         "condition_2": f"{sol_lo}:sol:gte", "condition_3": f"{sol_hi}:sol:lte", "condition_4": f"{INSTRUMENTS}:instrument:in"}
    return API + "?" + urllib.parse.urlencode(q, safe=":,")


def usable(item: dict[str, Any]) -> bool:
    """A left Navcam full frame with the metadata needed to place it."""
    return (item.get("instrument") in ("NAV_LEFT_A", "NAV_LEFT_B") and (item.get("extended") or {}).get("sample_type") == "full"
            and Cahvor.supported(item.get("camera_model_component_list")) and bool(item.get("attitude"))
            and item.get("site") is not None and item.get("drive") is not None and (item.get("scale_factor") in (None, 1, 1.0)))


def octants(items: list[dict[str, Any]], rover_to_site: dict[str, np.ndarray] | None = None) -> int:
    """Azimuth octants (site frame) covered by the frames' pointing directions."""
    got = set()
    for it in items:
        m = Cahvor.parse(it["camera_model_component_list"])
        R = quat_matrix(parse_vector(it["attitude"]))
        a = R @ m.A
        az = math.degrees(math.atan2(a[1], a[0])) % 360.0
        got.add(int(az // 45) % 8)
    return len(got)


class ApiCache:
    """Raw-image API pages saved under data/raw/msl/navcam/api and recorded in the manifest."""

    def __init__(self, dl: Downloader, records: list[dict[str, Any]]):
        self.dl = dl
        self.dir = RAW / "navcam" / "api"
        self.records = records

    def items(self, lo: int, hi: int) -> list[dict[str, Any]]:
        out, page = [], 0
        while True:
            path = self.dir / f"sols_{lo:04d}_{hi:04d}_p{page}.json"
            url = query_url(lo, hi, page)
            if path.exists():
                doc = json.loads(path.read_text(encoding="utf-8"))
                self.records.append({"url": url, "file": rel(path), "bytes": path.stat().st_size, "sha256": sha256_file(path), "cached": True})
            else:
                res = self.dl.fetch_to_file(url, path, expect=("application/json",))
                self.records.append({"url": url, "file": rel(path), "bytes": res.bytes, "sha256": res.sha256,
                                     "http_status": res.http_status, "downloaded_at": res.downloaded_at})
                doc = json.loads(path.read_text(encoding="utf-8"))
            out += doc.get("items") or []
            if not doc.get("more"):
                return out
            page += 1


def _merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for lo, hi in sorted(ranges):
        if out and lo <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], hi)
        else:
            out.append([lo, hi])
    return [(a, b) for a, b in out]


def select_stops(wp: Waypoints, api: ApiCache) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Choose the stops to build and gather their frames. Returns (stops, per-target report)."""
    targets = catalogue_targets()
    cands: dict[str, Waypoint] = {}
    near_by_target: dict[str, list[tuple[float, Waypoint]]] = {}
    for t in targets:
        near = wp.near(t["lat"], t["lon"], TARGET_RADIUS_M)
        near_by_target[t["id"]] = near
        for _, w in near:
            cands[w.rmc] = w
            for k in range(max(0, w.index - NEIGHBOUR_WINDOW), min(len(wp.items), w.index + NEIGHBOUR_WINDOW + 1)):
                cands[wp.items[k].rmc] = wp.items[k]
    ranges = _merge([(w.sol, wp.departure_sol(w)) for w in cands.values()])
    frames_by_rmc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lo, hi in ranges:
        for it in api.items(lo, hi):
            if usable(it):
                rmc = f"{int(it['site'])}_{int(it['drive'])}"
                if rmc in cands:
                    frames_by_rmc[rmc].append(it)
    for v in frames_by_rmc.values():
        # one record per image id
        seen = {}
        for it in v:
            seen.setdefault(it["imageid"], it)
        v[:] = sorted(seen.values(), key=lambda it: (it["sol"], it["imageid"]))
    good = {rmc for rmc, v in frames_by_rmc.items() if octants(v) >= MIN_OCTANTS}

    chosen: dict[str, dict[str, Any]] = {}
    report = []
    for t in targets:
        near = [(d, w) for d, w in near_by_target[t["id"]] if w.rmc in good]
        if not near:
            report.append({"target_id": t["id"], "target": t["name"], "stop": None,
                           "reason": f"no localised stop within {TARGET_RADIUS_M:.0f} m has left Navcam full frames with camera models "
                                     f"covering {MIN_OCTANTS}/8 azimuth octants in the raw-image API"})
            continue
        d, w = near[0]
        chosen.setdefault(w.rmc, {"waypoint": w, "targets": []})["targets"].append({"id": t["id"], "name": t["name"], "distance_m": round(d, 1)})
        neighbours = []
        for direction in (-1, 1):
            k = w.index + direction
            while 0 <= k < len(wp.items) and abs(k - w.index) <= NEIGHBOUR_WINDOW:
                if wp.items[k].rmc in good:
                    neighbours.append(wp.items[k])
                    break
                k += direction
        for n in neighbours:
            chosen.setdefault(n.rmc, {"waypoint": n, "targets": []})
        report.append({"target_id": t["id"], "target": t["name"], "stop": w.rmc, "distance_m": round(d, 1),
                       "neighbours": [n.rmc for n in neighbours]})
    stops = []
    for rmc, c in chosen.items():
        stops.append({"rmc": rmc, "waypoint": c["waypoint"], "targets": c["targets"], "items": frames_by_rmc[rmc]})
    stops.sort(key=lambda s: s["waypoint"].index)
    return stops, report


def _sequence(imageid: str) -> str:
    m = re.search(r"NCAM\d{5}", imageid)
    return m.group(0) if m else imageid


def choose_frames(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Frames for one panorama: the (sol, sequence) group covering most azimuth, then other frames only
    where they add azimuth coverage (fewer lighting changes than mixing every frame taken at the stop)."""
    def cover(its: list[dict[str, Any]]) -> set[int]:
        out = set()
        for it in its:
            m = Cahvor.parse(it["camera_model_component_list"])
            a = quat_matrix(parse_vector(it["attitude"])) @ m.A
            az = math.degrees(math.atan2(a[1], a[0])) % 360.0
            el = math.degrees(math.asin(max(-1.0, min(1.0, -a[2] / np.linalg.norm(a)))))
            for k in range(-4, 5):  # +/- ~20 deg of azimuth around the frame centre
                out.add((int((az + 5 * k) // 10) % 36, int((el + 90) // 15)))
        return out
    def elevation(it: dict[str, Any]) -> float:
        a = quat_matrix(parse_vector(it["attitude"])) @ Cahvor.parse(it["camera_model_component_list"]).A
        return math.degrees(math.asin(max(-1.0, min(1.0, -a[2] / np.linalg.norm(a)))))

    items = [it for it in items if elevation(it) <= MAX_FRAME_EL_DEG]
    groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for it in items:
        groups[(it["sol"], _sequence(it["imageid"]))].append(it)
    ordered = sorted(groups.values(), key=lambda g: -len(cover(g)))
    chosen = list(ordered[0])
    have = cover(chosen)
    for g in ordered[1:]:
        for it in g:
            add = cover([it]) - have
            if len(add) >= 3:
                chosen.append(it)
                have |= add
    return sorted(chosen, key=lambda it: (it["sol"], it["imageid"]))


def fetch(man: Manifest, dl: Downloader) -> None:
    wp = Waypoints.load(WAYPOINTS_FILE)
    entry = man.product("navcam")
    api_records: list[dict[str, Any]] = []
    api = ApiCache(dl, api_records)
    stops, report = select_stops(wp, api)
    print(f"  navcam: {len(stops)} stops selected")
    files = []
    for s in stops:
        frames = choose_frames(s["items"])
        s["frames"] = frames
        d = RAW / "navcam" / "frames" / s["rmc"]
        for it in frames:
            url = it.get("https_url") or it["url"]
            dest = d / f"{it['imageid']}.jpg"
            if dest.exists():
                files.append({"url": url, "file": rel(dest), "bytes": dest.stat().st_size, "sha256": sha256_file(dest), "cached": True})
                continue
            try:
                res = dl.fetch_to_file(url, dest, expect=("image/jpeg", "image/jpg"))
            except NotFound:
                print(f"    missing {url}")
                continue
            files.append({"url": url, "file": rel(dest), "bytes": res.bytes, "sha256": res.sha256, "http_status": res.http_status,
                          "downloaded_at": res.downloaded_at})
        print(f"    {s['rmc']} (sol {s['waypoint'].sol}): {len(frames)} of {len(s['items'])} frames")
        # keep the metadata of the frames used
        (RAW / "navcam" / "stops").mkdir(parents=True, exist_ok=True)
        (RAW / "navcam" / "stops" / f"{s['rmc']}.json").write_text(json.dumps({"rmc": s["rmc"], "targets": s["targets"], "frames": frames}, indent=1), encoding="utf-8")
    entry.update({
        "title": "MSL Navcam raw frames (left camera, full frames) at selected stops",
        "api": API, "query": "condition_4=NAV_LEFT_A,NAV_LEFT_B:instrument:in per sol range; frames used must carry site, drive, "
                             "CAHVOR camera model and rover attitude",
        "credit": "NASA/JPL-Caltech", "selection": {"min_octants": MIN_OCTANTS, "target_radius_m": TARGET_RADIUS_M, "report": report},
        "stops": [s["rmc"] for s in stops], "api_requests": api_records, "requests": files, "status": "complete", "fetched_at": utc_now(),
    })


# --- build ----------------------------------------------------------------------------------------

def _read_jpeg(path: Path) -> np.ndarray:
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(path) as ds:
            img = ds.read(1).astype(np.float32)
    return img


def _write_jpeg(path: Path, img8: np.ndarray) -> None:
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    path.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(path, "w", driver="JPEG", width=img8.shape[1], height=img8.shape[0], count=1, dtype="uint8",
                           QUALITY=JPEG_QUALITY) as ds:
            ds.write(img8, 1)
    for extra in (path.with_name(path.name + ".aux.xml"),):
        extra.unlink(missing_ok=True)


def _frame(it: dict[str, Any], path: Path) -> Frame:
    img = _read_jpeg(path)
    sub = parse_vector(it.get("subframe_rect"))
    offset = (int(sub[0]) - 1, int(sub[1]) - 1) if sub is not None else (0, 0)
    return Frame(img, Cahvor.parse(it["camera_model_component_list"]), quat_matrix(parse_vector(it["attitude"])), offset, 1.0)


class DemHorizon:
    def __init__(self):
        import rasterio
        from ..crs import mars_radius_m, mars_crs_definition

        # The full Mars Trek DEM export when it is on disk (wider: more horizon inside it), else the app's layer.
        raw_dem = REPO / "data" / "regions" / "gale" / "raw" / "dem" / "export_r0_c0.tif"
        path = raw_dem if raw_dem.exists() else REPO / "frontend" / "public" / "gis" / "gale" / "elevation.tif"
        with rasterio.open(path) as ds:
            self.elev = ds.read(1, masked=True).astype(np.float64).filled(np.nan)
            self.elev[(self.elev < -1e4) | (self.elev > 1e4)] = np.nan  # fill values outside the DEM footprint
            t = ds.transform
            # pixel centres: (col + 0.5, row + 0.5)
            self.transform = (t.a, t.b, t.c + 0.5 * t.a + 0.5 * t.b, t.d, t.e, t.f + 0.5 * t.d + 0.5 * t.e)
            self.source = rel(Path(ds.name))
        self.mpd = float(mars_crs_definition()["metres_per_degree"])
        self.radius = mars_radius_m()

    def ground(self, lat: float, lon: float) -> float:
        a, b, c, d, e, f = self.transform
        det = a * e - b * d
        col = (e * (lon - c) - b * (lat - f)) / det
        row = (-d * (lon - c) + a * (lat - f)) / det
        from .camera import _bilinear
        return float(_bilinear(self.elev, np.array([col]), np.array([row]))[0])

    def horizon(self, lat: float, lon: float, cam_height_m: float, az: np.ndarray):
        h0 = self.ground(lat, lon) + cam_height_m
        return dem_horizon(self.elev, self.transform, lat, lon, h0, self.mpd, self.radius, az)


def build(man: Manifest) -> dict[str, Any]:
    entry = man.product("navcam")
    if not entry.get("stops"):
        raise SystemExit("Navcam frames are not downloaded: run `python -m marga_gis.msl fetch --only navcam` first")
    wp = Waypoints.load(WAYPOINTS_FILE)
    dem = DemHorizon()
    report = {s["target_id"]: s for s in entry["selection"]["report"]}
    views = []
    ROVER_OUT.mkdir(parents=True, exist_ok=True)
    for rmc in entry["stops"]:
        meta = json.loads((RAW / "navcam" / "stops" / f"{rmc}.json").read_text(encoding="utf-8"))
        w = wp.by_rmc[rmc]
        frames, used = [], []
        skipped_sky = 0
        for it in meta["frames"]:
            p = RAW / "navcam" / "frames" / rmc / f"{it['imageid']}.jpg"
            if p.exists():
                f = _frame(it, p)
                if f.pointing()[1] > MAX_FRAME_EL_DEG:
                    skipped_sky += 1
                    continue
                frames.append(f)
                used.append(it)
        if not frames:
            print(f"  {rmc}: no frames on disk, skipped")
            continue
        yaws = [yaw_deg(f.rover_to_site) for f in frames]
        yaw_check = ((np.median(yaws) - w.yaw + 180) % 360) - 180
        gains = frame_gains(frames, GRID)
        pano, owner, seams = render(frames, GRID, gains)
        valid = ~np.isnan(pano)
        img8 = np.where(valid, np.clip(pano, 0, 255), 0).round().astype(np.uint8)
        name = f"pano_{rmc}.jpg"
        _write_jpeg(ROVER_OUT / name, img8)
        # coverage per azimuth column in the horizon band (-20..+10 deg)
        band = valid[int(GRID.row_of(10.0)):int(GRID.row_of(-20.0))]
        az_cover = float(band.any(axis=0).mean())
        # horizon check
        az = np.arange(0.0, 360.0, 0.5)
        cam_h = float(-np.median([f.model.C[2] for f in frames]))  # camera height above the rover-frame origin
        dem_h, resolved = dem.horizon(w.lat, w.lon, cam_h, az)
        sky = detect_skyline(pano, GRID)
        check = skyline_offset(sky, GRID.az(np.arange(GRID.width)), dem_h, az, resolved)
        sols = sorted({it["sol"] for it in used})
        views.append({
            "id": rmc, "rmc": rmc, "site": w.site, "drive": w.drive,
            "lat": w.lat, "lon": w.lon, "elev_geoid_m": w.elev_geoid, "traverse_index": w.index,
            "rover_arrived_sol": w.sol, "sols": sols, "rover_yaw_deg": w.yaw,
            "image": name, "image_bytes": (ROVER_OUT / name).stat().st_size,
            "grid": {"width": GRID.width, "height": GRID.height, "el_top_deg": GRID.el_top, "el_bottom_deg": GRID.el_bottom,
                     "azimuth": "0 deg = north at the left edge, increasing clockwise (east at 90 deg)"},
            "coverage": {"horizon_band_azimuth_fraction": round(az_cover, 3), "frames": len(used), "sky_frames_left_out": skipped_sky},
            "targets": meta["targets"],
            "frames": [{"imageid": it["imageid"], "sol": it["sol"], "date_taken": it.get("date_taken"),
                        "url": it.get("https_url") or it["url"], "page": "https://mars.nasa.gov/raw_images/" + str(it["id"]),
                        "instrument": it["instrument"], "mast_az": it["extended"].get("mast_az"), "mast_el": it["extended"].get("mast_el"),
                        "gain": round(float(g), 3)} for it, g in zip(used, gains)],
            "checks": {
                "attitude_vs_waypoint_yaw_deg": round(float(yaw_check), 2),
                "seams": seams,
                "horizon": {**check, "dem": dem.source, "skyline_columns": int((~np.isnan(sky)).sum()),
                            "dem_azimuths_resolved": int(resolved.sum())},
            },
            "credit": "NASA/JPL-Caltech",
        })
        hz = check.get("verdict")
        print(f"  {rmc} sol {sols[0]}{'-' + str(sols[-1]) if len(sols) > 1 else ''}: {len(used)} frames, "
              f"azimuth coverage {az_cover:.0%}, yaw check {yaw_check:+.2f} deg, seams {seams['median_abs_diff_dn']} DN, "
              f"horizon {hz} ({check.get('azimuth_offset_deg', '-')} deg, residual {check.get('residual_deg', '-')})"
              f", {(ROVER_OUT / name).stat().st_size / 1e6:.2f} MB")
    views.sort(key=lambda v: v["traverse_index"])
    out = {
        "title": "Curiosity rover views (Navcam)",
        "source": {
            "agency": "NASA/JPL-Caltech",
            "api": API,
            "locations": "NASA MSL rover localisation (MMGIS MSL_waypoints.json), exact RMC",
            "retrieved_at": entry.get("fetched_at"),
        },
        "method": ("Left Navcam full frames taken at the stop, each reprojected into an equirectangular panorama (site frame: "
                   "azimuth from north, elevation from horizontal) with the CAHVOR camera model and rover attitude NASA "
                   "publishes with the image. Each panorama pixel comes from the frame that sees it nearest that frame's centre; "
                   "per-frame brightness gains even out exposure. Black: not imaged at this stop."),
        "limitations": [
            "Raw frames: seams, exposure steps and the rover's own hardware are visible as delivered.",
            "Distant terrain only: nearby ground is not corrected for the small parallax between frames.",
        ],
        "targets": list(report.values()),
        "built_at": utc_now(),
        "views": views,
    }
    (ROVER_OUT / "views.json").write_text(json.dumps(out, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    total = sum(v["image_bytes"] for v in views)
    rep = {"file": rel(ROVER_OUT / "views.json"), "views": len(views), "bytes": total,
           "horizon": {v["rmc"]: v["checks"]["horizon"].get("verdict") for v in views}}
    man.doc.setdefault("build", {})["navcam"] = {**rep, "built_at": out["built_at"]}
    print(f"navcam: {len(views)} views, {total / 1e6:.1f} MB -> {rep['file']}")
    return rep
