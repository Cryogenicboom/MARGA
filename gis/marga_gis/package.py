"""Regional data package: data/regions/<id>/

    manifest.json   what was fetched, from where (exact URLs), when, sizes, SHA-256 checksums,
                    catalogue and service metadata, validation and processing results
    raw/<product>/  original server responses, saved as received (git-ignored: data/.gitignore 'raw/')

The manifest is small and kept in git so the provenance of the processed map layers survives even
where the raw downloads are not present.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import REPO
from .trek.net import utc_now

FORMAT = "marga-region-package"


def load_region(region_id: str) -> dict[str, Any]:
    path = REPO / "gis" / "regions" / f"{region_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"no region configuration {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def bbox_tuple(region: dict[str, Any]) -> tuple[float, float, float, float]:
    """(west, south, east, north) of the region."""
    b = region["bbox"]
    return (b["min_lon"], b["min_lat"], b["max_lon"], b["max_lat"])


class RegionPackage:
    def __init__(self, region: dict[str, Any]):
        self.region = region
        self.root = REPO / "data" / "regions" / region["id"]
        self.raw = self.root / "raw"
        self.path = self.root / "manifest.json"
        if self.path.exists():
            self.doc = json.loads(self.path.read_text(encoding="utf-8"))
        else:
            self.doc = {
                "format": FORMAT,
                "format_version": 1,
                "region": {k: region[k] for k in ("id", "name", "bbox", "crs")},
                "created_at": utc_now(),
                "products": {},
                "notes": [],
            }

    def product(self, pid: str) -> dict[str, Any]:
        return self.doc["products"].setdefault(pid, {})

    def raw_dir(self, pid: str) -> Path:
        d = self.raw / pid
        d.mkdir(parents=True, exist_ok=True)
        return d

    def note(self, text: str) -> None:
        if text not in self.doc["notes"]:
            self.doc["notes"].append(text)

    def save(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.doc["updated_at"] = utc_now()
        self.path.write_text(json.dumps(self.doc, indent=2) + "\n", encoding="utf-8")
