"""Optional HTTP wrapper (FastAPI) - the VITE_ENGINE_API_URL service in frontend/.env.example.

The core engine does not need this: the frontend can route fully offline with engine/ts. The
service is useful during development, for testing, and for mission-preparation workstations.

    uvicorn marga_engine.api:app --port 8000          (from engine/)
    python -m marga_engine serve --port 8000

Configuration (environment):
    MARGA_TERRAIN   terrain package directory (default: frontend/public/terrain/gale - the same
                    package the browser engine uses; currently SYNTHETIC and labelled as such)
    MARGA_TARGETS   ScienceTarget catalogue JSON for RouteRequest.target_ids
                    (default: science_data/catalogue/gale_crater_targets.json)
    MARGA_CORS      comma-separated allowed origins (default http://localhost:3000)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from . import __version__
from .contracts import TargetCatalogue
from .errors import EngineError
from .eva.radiation import estimate_dose, reference_with_rate
from .service import assess_return, plan_route
from .terrain.grid import TerrainGrid
from .terrain.package import load_package

REPO = Path(__file__).resolve().parents[2]
DEFAULT_TERRAIN = REPO / "frontend" / "public" / "terrain" / "gale"
DEFAULT_TARGETS = REPO / "science_data" / "catalogue" / "gale_crater_targets.json"


def create_app(terrain: TerrainGrid | None = None, catalogue: TargetCatalogue | None = None):
    try:
        from fastapi import Body, FastAPI, HTTPException
        from fastapi.middleware.cors import CORSMiddleware
    except ImportError as e:  # pragma: no cover
        raise SystemExit("The HTTP service needs `pip install fastapi uvicorn`") from e

    if terrain is None:
        terrain = load_package(os.environ.get("MARGA_TERRAIN", str(DEFAULT_TERRAIN)))
    if catalogue is None:
        tpath = os.environ.get("MARGA_TARGETS") or (str(DEFAULT_TARGETS) if DEFAULT_TARGETS.exists() else None)
        if tpath:
            catalogue = TargetCatalogue.load(tpath)

    app = FastAPI(title="MARGA Core Engine", version=__version__,
                  description="Deterministic terrain-aware A* routing and EVA budget assessment.")
    # The Vite dev server (port 3000) and `vite preview` (4173) on any local port, plus MARGA_CORS origins.
    origins = [o.strip() for o in os.environ.get("MARGA_CORS", "").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
                       allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "engine_version": __version__,
                "terrain": {"dataset_id": terrain.metadata.dataset_id, "label": terrain.metadata.label(),
                            "synthetic": terrain.metadata.synthetic},
                "targets_loaded": 0 if catalogue is None else len(catalogue.by_id)}

    @app.get("/api/terrain")
    def terrain_info() -> dict[str, Any]:
        return terrain.describe()

    @app.post("/api/route")
    def route(body: dict = Body(...)) -> dict[str, Any]:
        return plan_route(body, terrain, catalogue=catalogue)

    @app.post("/api/eva/return")
    def eva_return(body: dict = Body(...)) -> dict[str, Any]:
        try:
            return assess_return(body, terrain)
        except EngineError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/radiation")
    def radiation(body: dict = Body(...)) -> dict[str, Any]:
        try:
            ref = reference_with_rate(body.get("rate_msv_per_day"))
            return estimate_dose(float(body.get("duration_min", -1)), ref)
        except (EngineError, TypeError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    return app


def __getattr__(name: str):
    """`uvicorn marga_engine.api:app` builds the app lazily on first access."""
    if name == "app":
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(name)
