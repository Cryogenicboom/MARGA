"""Mars Trek catalogue and service metadata.

Endpoints (as used by the Mars Trek WMTS API page, https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars):
  - catalogue search:  https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?...
  - layer services:    https://trek.nasa.gov/mars/TrekServices/ws/index/getLayerServices?uuid=<item_UUID>
  - ArcGIS services:   https://trek.nasa.gov/mars/trekarcgis/rest/services/<name>/{ImageServer|MapServer}?f=json

The catalogue's FGDC metadata pages answered with empty bodies when checked (2026-11), so provenance
is taken from the catalogue record itself and the service metadata, and that limitation is recorded.
"""
from __future__ import annotations

import urllib.parse
from typing import Any

from .net import Downloader

TREK = "https://trek.nasa.gov/mars"
ARCGIS = f"{TREK}/trekarcgis/rest/services"
SEARCH = f"{TREK}/TrekServices/ws/index/eq/searchItems"
LAYER_SERVICES = f"{TREK}/TrekServices/ws/index/getLayerServices?uuid="

# Catalogue fields worth keeping as provenance (others are UI or index bookkeeping).
_KEEP = ("title", "productLabel", "item_UUID", "mission", "instrument", "data_created_date", "fileSize",
         "bbox", "productCat1", "productCat2", "projection", "description")


def catalogue_search_url(label: str) -> str:
    q = {"start": 0, "rows": 10, "facetKeys": "productLabel", "facetValues": label}
    return f"{SEARCH}?{urllib.parse.urlencode(q)}"


def find_product(dl: Downloader, label: str) -> dict[str, Any]:
    """The catalogue record whose productLabel is `label` (exact match), or {} if the catalogue has none."""
    url = catalogue_search_url(label)
    docs = dl.fetch_json(url).get("response", {}).get("docs", [])
    for d in docs:
        if d.get("productLabel") == label:
            rec = {k: d.get(k) for k in _KEEP if d.get(k) not in (None, "", [])}
            rec["catalogue_url"] = url
            return rec
    return {}


def layer_services(dl: Downloader, uuid: str) -> list[dict[str, Any]]:
    docs = dl.fetch_json(LAYER_SERVICES + uuid).get("response", {}).get("docs", [])
    return [{"serviceType": d.get("serviceType"), "endPoint": d.get("endPoint")} for d in docs]


def image_service_info(dl: Downloader, name: str) -> dict[str, Any]:
    url = f"{ARCGIS}/{name}/ImageServer?f=json"
    m = dl.fetch_json(url)
    return {
        "url": url,
        "name": m.get("name"),
        "capabilities": m.get("capabilities"),
        "pixelType": m.get("pixelType"),
        "bandCount": m.get("bandCount"),
        "pixelSizeX": m.get("pixelSizeX"),
        "pixelSizeY": m.get("pixelSizeY"),
        "extent": m.get("extent"),
        "spatialReference": m.get("spatialReference") or (m.get("extent") or {}).get("spatialReference"),
        "noDataValue": m.get("noDataValue"),
        "minValues": m.get("minValues"),
        "maxValues": m.get("maxValues"),
        "maxImageWidth": m.get("maxImageWidth"),
        "maxImageHeight": m.get("maxImageHeight"),
    }


def map_service_layer_info(dl: Downloader, name: str, layer: int) -> dict[str, Any]:
    url = f"{ARCGIS}/{name}/MapServer/{layer}?f=json"
    m = dl.fetch_json(url)
    return {
        "url": url,
        "name": m.get("name"),
        "geometryType": m.get("geometryType"),
        "objectIdField": next((f["name"] for f in m.get("fields", []) if f.get("type") == "esriFieldTypeOID"), None),
        "fields": [f.get("name") for f in m.get("fields", [])],
        "maxRecordCount": m.get("maxRecordCount"),
        "supportsPagination": (m.get("advancedQueryCapabilities") or {}).get("supportsPagination"),
        "spatialReference": (m.get("extent") or {}).get("spatialReference"),
        "copyrightText": m.get("copyrightText") or None,
        "description": (m.get("description") or "").strip() or None,
    }
