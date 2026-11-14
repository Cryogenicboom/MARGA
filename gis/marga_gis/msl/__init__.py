"""Curiosity (MSL) surface data for MARGA: CheMin mineralogy and Navcam rover views.

Run from gis/ with the engine's Python environment (see gis/README.md):

    python -m marga_gis.msl fetch            # download from NASA (PDS Geosciences Node, MSL raw-image API)
    python -m marga_gis.msl fetch --only chemin
    python -m marga_gis.msl build            # write the app's data files
    python -m marga_gis.msl status

Originals go to data/raw/msl/ (kept in the repository); every request URL, checksum and time is recorded in
data/msl/manifest.json. Outputs: frontend/public/science/chemin_samples.json and
frontend/public/rover/ (views.json plus one panorama per rover stop).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .. import REPO

RAW = REPO / "data" / "raw" / "msl"
MANIFEST = REPO / "data" / "msl" / "manifest.json"
SCIENCE_OUT = REPO / "frontend" / "public" / "science"
ROVER_OUT = REPO / "frontend" / "public" / "rover"
WAYPOINTS_FILE = RAW / "MSL_waypoints.json"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"


class Manifest:
    """data/msl/manifest.json: what was requested from where, when, with checksums."""

    def __init__(self, path: Path = MANIFEST):
        self.path = path
        self.doc: dict[str, Any] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
            "description": "Provenance of MARGA's Curiosity (MSL) surface data: CheMin mineral abundances and Navcam rover views.",
            "root": "paths are relative to the repository root",
            "products": {},
        }

    def product(self, pid: str) -> dict[str, Any]:
        return self.doc["products"].setdefault(pid, {})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.doc, indent=1, allow_nan=False) + "\n", encoding="utf-8")


def rel(path: Path) -> str:
    return Path(path).resolve().relative_to(REPO.resolve()).as_posix()
