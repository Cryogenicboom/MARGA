"""Vector datasets (points, lines, polygons) with GeoPandas and Shapely, in MARGA's Mars CRS.

GeoJSON (RFC 7946) has no CRS member and is defined as WGS 84, so GeoPandas labels every GeoJSON file
EPSG:4326 (Earth). For Mars data that label is wrong. These readers therefore refuse a WGS 84 label
unless the caller states, with a reason, that the coordinates are MARGA's Mars CRS; the reason is
kept in `gdf.attrs["crs_note"]`. Coordinates are never transformed here.
"""
from __future__ import annotations

from pathlib import Path

import geopandas as gpd

from .crs import CrsError, classify_crs, describe_crs, mars_crs, mars_crs_definition


def read_mars_vector(path: str | Path, *, assume_marga_crs: str | None = None) -> gpd.GeoDataFrame:
    """Read a vector file into MARGA's CRS.

    assume_marga_crs: required when the file states no CRS or the GeoJSON default (WGS 84): a short
    reason why its coordinates are MARGA's planetocentric Mars coordinates (e.g. the data producer's
    documentation). Without it such a file is refused rather than treated as Earth data.
    """
    gdf = gpd.read_file(path)
    code = mars_crs_definition()["code"]
    kind = classify_crs(gdf.crs) if gdf.crs is not None else None
    if kind == "mars_sphere_geographic":
        gdf = gdf.set_crs(mars_crs(), allow_override=True)
        gdf.attrs["crs_note"] = f"Declared CRS {describe_crs(gdf.crs)} is MARGA's Mars CRS ({code})."
        return gdf
    if kind is None or kind == "earth":
        if not (assume_marga_crs and assume_marga_crs.strip()):
            label = "no CRS" if kind is None else f"the Earth CRS {describe_crs(gdf.crs)} (the GeoJSON default)"
            raise CrsError(
                f"{path}: states {label}. MARGA will not treat it as Earth data; pass assume_marga_crs "
                f"with the reason its coordinates are planetocentric Mars coordinates ({code})."
            )
        gdf = gdf.set_crs(mars_crs(), allow_override=True)
        gdf.attrs["crs_note"] = (
            f"File states {'no CRS' if kind is None else 'WGS 84 (GeoJSON default)'}; coordinates used "
            f"unchanged as {code} because: {assume_marga_crs.strip()}"
        )
        return gdf
    raise CrsError(f"{path}: CRS {describe_crs(gdf.crs)} is not MARGA's Mars CRS ({code}); not converted here")
