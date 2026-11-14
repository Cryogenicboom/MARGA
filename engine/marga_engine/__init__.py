"""MARGA core engine: deterministic terrain-aware routing and EVA budget logic.

Public API
    plan_route(request_dict, terrain)      RouteRequest -> RouteResponse (shared/types/index.ts)
    assess_return(request_dict, terrain)   return-to-habitat check from the current position
    load_package(path)                     load a regional terrain package
    estimate_dose(minutes)                 historical-baseline radiation estimate

The engine has no dependency on React, OpenLayers, a network connection or a running server.
"""
__version__ = "1.0.0"

from .config import DEFAULT_CONFIG, EngineConfig  # noqa: E402
from .eva.radiation import estimate_dose  # noqa: E402
from .service import assess_return, plan_route  # noqa: E402
from .terrain.package import import_geotiff, load_package, save_package  # noqa: E402

__all__ = ["__version__", "DEFAULT_CONFIG", "EngineConfig", "plan_route", "assess_return", "load_package",
           "save_package", "import_geotiff", "estimate_dose"]
