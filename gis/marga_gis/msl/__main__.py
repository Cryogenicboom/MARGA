"""CLI: python -m marga_gis.msl fetch|build|status (see marga_gis/msl/__init__.py)."""
from __future__ import annotations

import argparse
import json
import threading

from . import MANIFEST, RAW, WAYPOINTS_FILE, WAYPOINTS_URL, Manifest, rel
from ..trek.net import Cancelled, Downloader, NotFound, sha256_file, utc_now


def _record(dl_result) -> dict:
    rec = {k: getattr(dl_result, k) for k in ("url", "bytes", "sha256", "content_type", "http_status", "downloaded_at")}
    rec["file"] = rel(dl_result.path)
    return rec


def fetch_waypoints(man: Manifest, dl: Downloader) -> None:
    entry = man.product("waypoints")
    if WAYPOINTS_FILE.exists():
        # Keep the local copy: the target positions and the DEM CRS evidence were derived from it.
        entry.update({"url": WAYPOINTS_URL, "file": rel(WAYPOINTS_FILE), "bytes": WAYPOINTS_FILE.stat().st_size,
                      "sha256": sha256_file(WAYPOINTS_FILE), "cached": True,
                      "note": "Local copy kept (also used for the DEM CRS evidence and the target positions)."})
        print(f"  waypoints: using {rel(WAYPOINTS_FILE)}")
        return
    res = dl.fetch_to_file(WAYPOINTS_URL, WAYPOINTS_FILE, expect=("application/json", "text/plain", "application/octet-stream"))
    entry.update(_record(res))
    print(f"  waypoints: downloaded {res.bytes / 1e3:.0f} KB")


def fetch_chemin(man: Manifest, dl: Downloader) -> None:
    from . import chemin

    raw = RAW / "chemin"
    inv = dl.fetch_to_file(chemin.INVENTORY_URL, raw / "collection_data_chemin_min_inventory.csv",
                           expect=("text/csv", "text/plain", "application/octet-stream"))
    names = chemin.inventory_products((raw / "collection_data_chemin_min_inventory.csv").read_text(encoding="utf-8"))
    print(f"  chemin: {len(names)} mineral abundance products in the inventory")
    files = []
    for i, name in enumerate(names, 1):
        for ext in ("csv", "lbl"):
            dest = raw / f"{name}.{ext}"
            url = f"{chemin.DATA_URL}/{name}.{ext}"
            if dest.exists():
                files.append({"url": url, "file": rel(dest), "bytes": dest.stat().st_size, "sha256": sha256_file(dest), "cached": True})
                continue
            res = dl.fetch_to_file(url, dest, expect=("text/", "application/octet-stream", "application/csv"))
            files.append(_record(res))
        if i % 10 == 0 or i == len(names):
            print(f"    {i}/{len(names)}")
    man.product("chemin").update({
        "title": "MSL CheMin mineral abundances (RDR product type MIN)",
        "dataset_id": chemin.DATASET_ID, "citation": chemin.CITATION, "archive_page": chemin.ARCHIVE_PAGE,
        "file_naming": chemin.NAMING_DOC, "inventory": _record(inv), "products": len(names), "requests": files,
        "status": "complete", "fetched_at": utc_now(),
    })


def fetch_navcam(man: Manifest, dl: Downloader) -> None:
    from . import navcam

    navcam.fetch(man, dl)


def cmd_fetch(only: set[str] | None) -> int:
    man = Manifest()
    cancel = threading.Event()
    dl = Downloader(cancel=cancel)
    steps = [("waypoints", fetch_waypoints), ("chemin", fetch_chemin), ("navcam", fetch_navcam)]
    try:
        for sid, fn in steps:
            if only and sid not in only and sid != "waypoints":
                continue
            print(f"fetch {sid}")
            fn(man, dl)
            man.save()
    except (KeyboardInterrupt, Cancelled):
        cancel.set()
        man.save()
        print("cancelled; files downloaded so far are kept and recorded")
        return 130
    except NotFound as e:
        man.save()
        print(f"not found: {e}")
        return 1
    print(f"manifest: {rel(MANIFEST)}")
    return 0


def cmd_build(only: set[str] | None) -> int:
    from . import build

    man = Manifest()
    if not only or "chemin" in only:
        build.build_chemin(man)
    if not only or "navcam" in only:
        build.build_navcam(man)
    man.save()
    return 0


def cmd_status() -> int:
    man = Manifest()
    for pid, e in man.doc.get("products", {}).items():
        reqs = e.get("requests", [])
        print(f"  {pid:10s} {e.get('status', '-'):10s} {len(reqs)} files, fetched {e.get('fetched_at', '-')}")
    print(json.dumps(man.doc.get("build", {}), indent=1)[:2000])
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m marga_gis.msl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--only", help="chemin and/or navcam, comma-separated")
    b = sub.add_parser("build")
    b.add_argument("--only", help="chemin and/or navcam, comma-separated")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "fetch":
        return cmd_fetch(set(a.only.split(",")) if a.only else None)
    if a.cmd == "build":
        return cmd_build(set(a.only.split(",")) if a.only else None)
    return cmd_status()


if __name__ == "__main__":
    raise SystemExit(main())
