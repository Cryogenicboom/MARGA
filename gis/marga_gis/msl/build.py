"""Build the app's data files from the downloaded MSL products (see marga_gis/msl/__init__.py)."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from . import RAW, SCIENCE_OUT, WAYPOINTS_FILE, Manifest, rel
from . import chemin
from .waypoints import Waypoints
from ..package import bbox_tuple, load_region
from ..trek.net import sha256_file, utc_now


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def build_chemin(man: Manifest) -> dict[str, Any]:
    raw = RAW / "chemin"
    entry = man.product("chemin")
    if not entry.get("requests"):
        raise SystemExit("CheMin products are not downloaded: run `python -m marga_gis.msl fetch --only chemin` first")
    wp = Waypoints.load(WAYPOINTS_FILE)
    region = load_region("gale")
    west, south, east, north = bbox_tuple(region)

    names = sorted({p.stem for p in raw.glob("cm*.lbl")})
    kept, superseded = chemin.latest_versions(names)
    analyses: list[dict[str, Any]] = []
    unnamed: list[str] = []
    for name in kept:
        pn = chemin.parse_product_name(name)
        lab = chemin.parse_label((raw / f"{name}.lbl").read_text(encoding="latin1"))
        rows = chemin.parse_table((raw / f"{name}.csv").read_text(encoding="latin1"))
        if not lab["sample"]:
            unnamed.append(name)
        w, how = wp.at(pn.site, pn.drive)
        analyses.append({
            "product_id": lab["product_id"] or name.upper(),
            "sample": lab["sample"] or f"Unnamed sample (sol {pn.sol})",
            "sample_kind": lab["sample_kind"],
            "sample_phrase": lab["sample_phrase"],
            "sol": pn.sol,
            "rmc": f"{pn.site}_{pn.drive}",
            "start_time": lab["start_time"],
            "release_id": lab["release_id"],
            "reanalysis": lab["reanalysis"],
            "minerals": [{**r, "label": chemin.display_mineral(r["mineral"]), "family": chemin.mineral_family(r["mineral"])}
                         for r in sorted(rows, key=lambda r: -r["wt_pct"])],
            "table_sum_wt_pct": round(sum(r["wt_pct"] for r in rows), 1),
            "fractions": lab["fractions"],
            "description": lab["description"],
            "supersedes": [s.upper() for s in superseded.get(name, [])],
            "csv_url": f"{chemin.DATA_URL}/{name}.csv",
            "label_url": f"{chemin.DATA_URL}/{name}.lbl",
            "csv_sha256": sha256_file(raw / f"{name}.csv"),
            "position": None if w is None else {"lat": w.lat, "lon": w.lon, "elev_geoid_m": w.elev_geoid, "rmc_used": w.rmc,
                                                "method": how, "rover_arrived_sol": w.sol},
        })

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in analyses:
        groups[a["sample"].lower()].append(a)
    samples = []
    for items in groups.values():
        items.sort(key=lambda a: (a["sol"], a["product_id"]))
        # Where the sample was analysed first, at the rover position of that analysis; later reanalyses of
        # a stored sample were made after the rover had driven on, so they do not locate the sample.
        first = next((a for a in items if not a["reanalysis"] and a["position"]), None) or next((a for a in items if a["position"]), None)
        pos = first["position"] if first else None
        name = items[0]["sample"]
        kind = next((a["sample_kind"] for a in items if a["sample_kind"]), None)
        samples.append({
            "id": _slug(name),
            "name": name,
            "kind": kind,
            "first_sol": items[0]["sol"],
            "lat": pos["lat"] if pos else None,
            "lon": pos["lon"] if pos else None,
            "elev_geoid_m": pos["elev_geoid_m"] if pos else None,
            "location": None if not pos else {
                "rmc": pos["rmc_used"], "method": pos["method"], "analysis_sol": first["sol"], "rover_arrived_sol": pos["rover_arrived_sol"],
                "basis": (f"Rover position (NASA MSL localisation, RMC {pos['rmc_used']}) during the CheMin analysis on sol {first['sol']}; "
                          "the RMC is the site and drive in the product file name. Samples are normally analysed at the place they were "
                          "collected, so this marks the sampling site to within the rover's footprint."),
            },
            "in_region": bool(pos and south <= pos["lat"] <= north and west <= pos["lon"] <= east),
            "analyses": items,
        })
    samples.sort(key=lambda s: s["first_sol"])

    out = {
        "title": "Curiosity CheMin mineralogy (X-ray diffraction)",
        "source": {
            "agency": "NASA Planetary Data System, Geosciences Node",
            "dataset_id": chemin.DATASET_ID,
            "citation": chemin.CITATION,
            "archive_page": chemin.ARCHIVE_PAGE,
            "inventory_url": chemin.INVENTORY_URL,
            "file_naming": chemin.NAMING_DOC,
            "retrieved_at": entry.get("fetched_at"),
            "locations": "NASA MSL rover localisation (MMGIS MSL_waypoints.json), by the site and drive in each product name",
        },
        "notes": [
            "Mineral tables are the CheMin team's published values (weight %, estimated 2-sigma error) for the crystalline phases; "
            "each table sums to 100 %.",
            "Clay and X-ray amorphous fractions of the whole sample are quoted from each product's PDS label, where the label states them.",
            "Where a table was revised (P2, P3), only the latest version is shown; the superseded product IDs are listed.",
        ],
        "built_at": utc_now(),
        "samples": samples,
    }
    SCIENCE_OUT.mkdir(parents=True, exist_ok=True)
    path = SCIENCE_OUT / "chemin_samples.json"
    path.write_text(json.dumps(out, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")
    report = {
        "file": rel(path), "products": len(names), "latest_versions": len(kept), "samples": len(samples),
        "in_region": sum(s["in_region"] for s in samples), "unnamed_products": unnamed,
        "located": sum(1 for s in samples if s["lat"] is not None),
        "located_exact_rmc": sum(1 for s in samples if s["location"] and s["location"]["method"] == "exact RMC"),
    }
    man.doc.setdefault("build", {})["chemin"] = {**report, "built_at": out["built_at"]}
    print(f"chemin: {report['samples']} samples from {report['latest_versions']} tables ({report['products']} products incl. "
          f"superseded versions); {report['located']} located ({report['located_exact_rmc']} exact RMC), "
          f"{report['in_region']} inside the terrain model -> {report['file']}")
    if unnamed:
        print(f"  labels that do not name the sample: {unnamed}")
    return report


def build_navcam(man: Manifest) -> dict[str, Any]:
    from . import navcam

    return navcam.build(man)
