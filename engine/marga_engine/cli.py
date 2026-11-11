"""Command line interface.

    python -m marga_engine route   request.json [--terrain DIR] [--targets FILE] [-o out.json]
    python -m marga_engine return  request.json [--terrain DIR]
    python -m marga_engine dose    MINUTES [--rate MSV_PER_DAY]
    python -m marga_engine terrain [--terrain DIR]
    python -m marga_engine serve   [--terrain DIR] [--port 8000]

Defaults: --terrain frontend/public/terrain/gale (the package the browser engine also uses) and
--targets science_data/catalogue/gale_crater_targets.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .api import DEFAULT_TARGETS, DEFAULT_TERRAIN
from .contracts import TargetCatalogue
from .errors import EngineError
from .eva.radiation import estimate_dose, reference_with_rate
from .service import assess_return, plan_route
from .terrain.package import load_package


def _dump(obj, out: str | None) -> None:
    text = json.dumps(obj, indent=2)
    if out:
        Path(out).write_text(text)
        print(f"wrote {out}", file=sys.stderr)
    else:
        print(text)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="marga_engine", description="MARGA core engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("route", "return"):
        p = sub.add_parser(name)
        p.add_argument("request")
        p.add_argument("--terrain", default=str(DEFAULT_TERRAIN))
        p.add_argument("--targets")
        p.add_argument("-o", "--out")
    p = sub.add_parser("dose")
    p.add_argument("minutes", type=float)
    p.add_argument("--rate", type=float)
    p = sub.add_parser("terrain")
    p.add_argument("--terrain", default=str(DEFAULT_TERRAIN))
    p = sub.add_parser("serve")
    p.add_argument("--terrain", default=str(DEFAULT_TERRAIN))
    p.add_argument("--targets")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "dose":
            _dump(estimate_dose(a.minutes, reference_with_rate(a.rate)), None)
            return 0
        if a.cmd == "serve":
            os.environ["MARGA_TERRAIN"] = a.terrain
            if a.targets:
                os.environ["MARGA_TARGETS"] = a.targets
            import uvicorn
            from .api import create_app
            uvicorn.run(create_app(), host=a.host, port=a.port)
            return 0
        terrain = load_package(a.terrain)
        if a.cmd == "terrain":
            _dump(terrain.describe(), None)
            return 0
        body = json.loads(Path(a.request).read_text())
        if a.cmd == "route":
            tpath = a.targets or (str(DEFAULT_TARGETS) if DEFAULT_TARGETS.exists() else None)
            cat = TargetCatalogue.load(tpath) if tpath else None
            res = plan_route(body, terrain, catalogue=cat)
            _dump(res, a.out)
            return 0 if res["status"] in ("calculated", "warning") else 2
        _dump(assess_return(body, terrain), a.out)
        return 0
    except EngineError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
