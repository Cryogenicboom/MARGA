"""ArcGIS MapServer vector queries for a region, converted to Shapely / GeoPandas.

What the Mars Trek map services support (checked 2026-11): Query with JSON/GeoJSON output, at most
1000 records per request, and NO pagination (a resultRecordCount parameter is rejected). So features
are fetched by first asking for the object ids in the region, then requesting them in batches.

Output is requested as Esri JSON with outSR=104905: the services' GeoJSON output carries identical
coordinates but labels them EPSG:4326 (Earth), which would be wrong. Geometry is converted here.
"""
from __future__ import annotations

import json
import urllib.parse
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import LinearRing, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon
from shapely.geometry.base import BaseGeometry

from .catalog import ARCGIS
from .net import Downloader, FetchResult

SERVICE_SR = 104905


def _query_url(service: str, layer: int, params: dict[str, Any]) -> str:
    return f"{ARCGIS}/{service}/MapServer/{layer}/query?{urllib.parse.urlencode(params)}"


def ids_url(service: str, layer: int, bbox: tuple[float, float, float, float]) -> str:
    w, s, e, n = bbox
    return _query_url(service, layer, {
        "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": SERVICE_SR,
        "spatialRel": "esriSpatialRelIntersects", "returnIdsOnly": "true", "f": "json",
    })


def features_url(service: str, layer: int, ids: list[int]) -> str:
    return _query_url(service, layer, {
        "objectIds": ",".join(str(i) for i in ids), "outFields": "*", "returnGeometry": "true",
        "outSR": SERVICE_SR, "f": "json",
    })


def fetch_layer(dl: Downloader, service: str, layer: int, bbox: tuple[float, float, float, float], out_dir: Path,
                max_records: int = 1000) -> tuple[list[dict[str, Any]], list[FetchResult], dict[str, Any]]:
    """Raw Esri JSON features intersecting `bbox`, the saved response files, and the id query result."""
    out_dir.mkdir(parents=True, exist_ok=True)
    id_doc = dl.fetch_json(ids_url(service, layer, bbox))
    ids = sorted(id_doc.get("objectIds") or [])
    files: list[FetchResult] = []
    features: list[dict[str, Any]] = []
    for i in range(0, len(ids), max_records):
        batch = ids[i:i + max_records]
        path = out_dir / f"layer{layer}_batch{i // max_records}.json"
        res = dl.fetch_to_file(features_url(service, layer, batch), path, expect=("application/json", "text/plain"),
                               label=f"{service}/{layer} features")
        doc = json.loads(path.read_text(encoding="utf-8"))
        if "error" in doc:
            raise ValueError(f"{service}/{layer}: {doc['error']}")
        sr = (doc.get("spatialReference") or {}).get("wkid")
        if sr not in (SERVICE_SR, None):
            raise ValueError(f"{service}/{layer}: features returned in spatial reference {sr}, expected {SERVICE_SR}")
        features.extend(doc.get("features", []))
        files.append(res)
    return features, files, {"objectIdFieldName": id_doc.get("objectIdFieldName"), "objectIds": ids,
                             "query_url": ids_url(service, layer, bbox)}


def _ring_area(coords: list[list[float]]) -> float:
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0, *_), (x1, y1, *_) in zip(coords, coords[1:] + coords[:1]))


def esri_geometry(g: dict[str, Any] | None) -> BaseGeometry | None:
    """Esri JSON geometry -> Shapely. Polygon rings: clockwise = outer, counter-clockwise = hole (Esri rule)."""
    if not g:
        return None
    if "x" in g and "y" in g:
        return Point(g["x"], g["y"])
    if "points" in g:
        return MultiPoint([tuple(p[:2]) for p in g["points"]])
    if "paths" in g:
        lines = [LineString([tuple(p[:2]) for p in path]) for path in g["paths"] if len(path) >= 2]
        return lines[0] if len(lines) == 1 else MultiLineString(lines)
    if "rings" in g:
        outers: list[list] = []
        holes: list[list] = []
        for ring in g["rings"]:
            pts = [tuple(p[:2]) for p in ring]
            if len(pts) < 4:
                continue
            (outers if _ring_area(pts) < 0 else holes).append(pts)
        polys = [[o, []] for o in outers]
        for h in holes:
            hp = Polygon(h)
            owner = next((p for p in polys if Polygon(p[0]).contains(hp.representative_point())), None)
            if owner is None:          # an orphan counter-clockwise ring: treat as its own polygon
                polys.append([h, []])
            else:
                owner[1].append(h)
        shapes = [Polygon(LinearRing(o), [LinearRing(h) for h in hs]) for o, hs in polys]
        return shapes[0] if len(shapes) == 1 else MultiPolygon(shapes)
    raise ValueError(f"unsupported Esri geometry keys: {sorted(g)}")


def to_geodataframe(features: list[dict[str, Any]], crs) -> gpd.GeoDataFrame:
    rows = [dict(f.get("attributes") or {}) for f in features]
    geoms = [esri_geometry(f.get("geometry")) for f in features]
    return gpd.GeoDataFrame(rows, geometry=geoms, crs=crs)
