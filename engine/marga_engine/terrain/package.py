"""Regional terrain packages: the offline unit the astronaut-side application loads.

A package is a directory holding

    terrain.json      geometry, dataset provenance, layer index, SHA-256 checksums
    elevation.i16     int16 little-endian, row-major, row 0 = north; metres = offset + scale * v,
                      v = -32768 means no data (scale chosen so the quantisation error is <= scale/2,
                      ~1 cm for a 1.3 km relief range). Half the size of float32 for the browser.
    elevation.f32     alternative float32 encoding (NaN = no data), used when quantisation is refused
    roughness.*       optional, same layout (metres)

Raw binary + JSON was chosen over NPZ/GeoTIFF so the same package loads in Python and in the
browser (fetch -> ArrayBuffer -> Float32Array) without GDAL or a decoder.

`import_geotiff` turns a DEM GeoTIFF (geographic lat/lon, or equirectangular metres) into a
package. It reads the georeferencing from the GeoTIFF keys and refuses files it cannot place
exactly instead of guessing.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from ..errors import TerrainDataError
from ..geodesy import normalize_lon
from .grid import GridGeometry, TerrainGrid, TerrainMetadata

FORMAT = "marga-terrain-package"
FORMAT_VERSION = 1


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


INT16_NODATA = -32768
INT16_MAX = 32767


def quantize_int16(a: np.ndarray, max_error_m: float = 0.02) -> tuple[np.ndarray, float, float] | None:
    """(values, scale, offset) so that a ~= offset + scale * values, or None if the requested
    precision cannot be met (the caller then keeps float32)."""
    a = np.asarray(a, dtype=np.float64)
    valid = np.isfinite(a)
    if not valid.any():
        return None
    lo, hi = float(a[valid].min()), float(a[valid].max())
    offset = round((lo + hi) / 2.0, 3)
    scale = max((hi - lo) / (2 * 32500), 1e-4)
    if scale / 2 > max_error_m:
        return None
    q = np.full(a.shape, INT16_NODATA, dtype=np.int16)
    q[valid] = np.clip(np.rint((a[valid] - offset) / scale), -INT16_MAX, INT16_MAX).astype(np.int16)
    return q, scale, offset


def dequantize_int16(q: np.ndarray, scale: float, offset: float) -> np.ndarray:
    out = (offset + scale * q.astype(np.float64)).astype(np.float32)
    out[q == INT16_NODATA] = np.nan
    return out


def save_package(terrain: TerrainGrid, directory: str | Path, encoding: str = "int16") -> Path:
    """Write a package. encoding='int16' (default, falls back to float32 if the 2 cm precision
    cannot be met) or 'float32'. Returns the directory; reload it with load_package to get
    exactly the values a client will see."""
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.f32"):
        old.unlink()
    for old in out.glob("*.i16"):
        old.unlink()
    g = terrain.geometry
    layers: dict[str, Any] = {}
    files = {"elevation": terrain.elevation}
    if terrain.external_roughness is not None:
        files["roughness"] = terrain.external_roughness
    checksums = {}
    for name, arr in files.items():
        q = quantize_int16(arr) if encoding == "int16" else None
        if q is not None:
            fn = f"{name}.i16"
            np.ascontiguousarray(q[0], dtype="<i2").tofile(out / fn)
            layers[name] = {"file": fn, "dtype": "int16", "byte_order": "little", "scale": q[1], "offset": q[2],
                            "nodata": INT16_NODATA, "order": "row-major, row 0 = north", "units": "m",
                            "decode": "metres = offset + scale * value; value == nodata means no data"}
        else:
            fn = f"{name}.f32"
            np.ascontiguousarray(arr, dtype="<f4").tofile(out / fn)
            layers[name] = {"file": fn, "dtype": "float32", "byte_order": "little",
                            "order": "row-major, row 0 = north", "nodata": "NaN", "units": "m"}
        checksums[fn] = _sha256(out / fn)
    doc = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "geometry": {"north_lat": g.north_lat, "west_lon": g.west_lon, "dlat_deg": g.dlat_deg,
                     "dlon_deg": g.dlon_deg, "nrows": g.nrows, "ncols": g.ncols, "radius_m": g.radius_m,
                     "registration": "cell centres; north_lat/west_lon are the first row/column centres"},
        "layers": layers,
        "dataset": terrain.metadata.to_dict(),
        "checksums": checksums,
    }
    (out / "terrain.json").write_text(json.dumps(doc, indent=2))
    return out


def load_package(directory: str | Path, verify_checksums: bool = True) -> TerrainGrid:
    d = Path(directory)
    meta_path = d / "terrain.json" if d.is_dir() else d
    d = meta_path.parent
    try:
        doc = json.loads(meta_path.read_text())
    except (OSError, ValueError) as e:
        raise TerrainDataError(f"cannot read terrain package metadata {meta_path}: {e}") from e
    if doc.get("format") != FORMAT:
        raise TerrainDataError(f"{meta_path} is not a {FORMAT}")
    if int(doc.get("format_version", 0)) > FORMAT_VERSION:
        raise TerrainDataError("terrain package was written by a newer engine")
    gd = doc["geometry"]
    geom = GridGeometry(float(gd["north_lat"]), float(gd["west_lon"]), float(gd["dlat_deg"]),
                        float(gd["dlon_deg"]), int(gd["nrows"]), int(gd["ncols"]), float(gd["radius_m"]))

    def read(name: str) -> np.ndarray | None:
        spec = doc["layers"].get(name)
        if spec is None:
            return None
        p = d / spec["file"]
        if not p.exists():
            raise TerrainDataError(f"terrain layer file missing: {p}")
        if verify_checksums and spec["file"] in doc.get("checksums", {}):
            if _sha256(p) != doc["checksums"][spec["file"]]:
                raise TerrainDataError(f"checksum mismatch for {p} - package is corrupt or modified")
        dtype = spec.get("dtype", "float32")
        if dtype == "int16":
            a = np.fromfile(p, dtype="<i2")
        elif dtype == "float32":
            a = np.fromfile(p, dtype="<f4")
        else:
            raise TerrainDataError(f"unsupported layer dtype {dtype!r} in {p}")
        if a.size != geom.nrows * geom.ncols:
            raise TerrainDataError(f"{p} holds {a.size} values, expected {geom.nrows * geom.ncols}")
        a = a.reshape(geom.nrows, geom.ncols)
        if dtype == "int16":
            return dequantize_int16(a, float(spec["scale"]), float(spec["offset"]))
        return a.astype(np.float32)

    return TerrainGrid(read("elevation"), geom, TerrainMetadata.from_dict(doc["dataset"]), read("roughness"))


# --- GeoTIFF import ---------------------------------------------------------------------------

def _block_mean_strict(a: np.ndarray, f: int) -> np.ndarray:
    """f x f block mean; a block with any no-data becomes no-data (never fill gaps)."""
    ny, nx = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    b = a[:ny, :nx].reshape(ny // f, f, nx // f, f).astype(np.float64)
    return b.mean(axis=(1, 3)).astype(np.float32)   # NaN propagates


def import_geotiff(path: str | Path, metadata: TerrainMetadata, *,
                   bbox: tuple[float, float, float, float] | None = None,
                   decimate: int = 1, radius_m: float | None = None,
                   lat_ts_deg: float | None = None, center_lon_deg: float | None = None,
                   z_scale: float = 1.0) -> TerrainGrid:
    """Read a single-band DEM GeoTIFF into a TerrainGrid.

    bbox = (min_lat, min_lon, max_lat, max_lon) clips to whole cells covering the box.
    decimate = integer block-mean factor (coarser only: the engine never upsamples a DEM).
    radius_m / lat_ts_deg / center_lon_deg override values missing from the GeoTIFF keys.
    """
    try:
        import tifffile
    except ImportError as e:  # pragma: no cover - optional dependency
        raise TerrainDataError("GeoTIFF import needs `pip install tifffile`") from e
    import logging
    logging.getLogger("tifffile").setLevel(logging.ERROR)

    with tifffile.TiffFile(str(path)) as tif:
        page = tif.pages[0]
        a = page.asarray()
        if a.ndim != 2:
            raise TerrainDataError(f"expected a single-band DEM, got array shape {a.shape}")
        tags = page.tags
        if "ModelPixelScaleTag" not in tags or "ModelTiepointTag" not in tags:
            raise TerrainDataError("GeoTIFF has no ModelPixelScale/ModelTiepoint tags; cannot georeference")
        sx, sy = tags["ModelPixelScaleTag"].value[:2]
        tp = tags["ModelTiepointTag"].value
        ti, tj, x0, y0 = tp[0], tp[1], tp[3], tp[4]
        geo = tif.geotiff_metadata or {}
        nodata = None
        if "GDAL_NODATA" in tags:
            try:
                nodata = float(str(tags["GDAL_NODATA"].value).strip().strip("\x00"))
            except ValueError:
                nodata = None

    a = a.astype(np.float64) * z_scale
    bad = ~np.isfinite(a) | (a < -1e20) | (a > 1e20)
    if nodata is not None:
        bad |= a == nodata * z_scale
    a[bad] = np.nan

    raster_type = int(geo.get("GTRasterTypeGeoKey", 1))   # 1 = PixelIsArea, 2 = PixelIsPoint
    half = 0.5 if raster_type == 1 else 0.0
    model = int(geo.get("GTModelTypeGeoKey", 0) or 0)
    R = radius_m or geo.get("GeogSemiMajorAxisGeoKey")
    if not R:
        raise TerrainDataError("GeoTIFF does not state the body radius; pass radius_m explicitly")
    R = float(R)
    lineage = [f"source raster {Path(path).name}: {a.shape[0]} x {a.shape[1]} px"]

    if model == 2:  # geographic: pixel sizes are degrees
        dlon, dlat = float(sx), float(sy)
        west = float(x0) + (half - ti) * dlon
        north = float(y0) - (half - tj) * dlat
        crs = f"geographic lat/lon on sphere R={R:.0f} m"
    elif model == 1:  # projected: support equirectangular (simple cylindrical) only
        ct = geo.get("ProjCoordTransGeoKey")
        if ct is not None and int(ct) != 17 and lat_ts_deg is None:
            raise TerrainDataError(f"projected GeoTIFF uses coordinate transform {ct}; only "
                                   "equirectangular (17) is supported - reproject to geographic first")
        lat_ts = lat_ts_deg if lat_ts_deg is not None else float(geo.get("ProjStdParallel1GeoKey", 0.0))
        lon0 = center_lon_deg if center_lon_deg is not None else float(
            geo.get("ProjCenterLongGeoKey", geo.get("ProjNatOriginLongGeoKey", 0.0)))
        fe = float(geo.get("ProjFalseEastingGeoKey", 0.0))
        fn = float(geo.get("ProjFalseNorthingGeoKey", 0.0))
        k = R * math.cos(math.radians(lat_ts))
        dlon = math.degrees(float(sx) / k)
        dlat = math.degrees(float(sy) / R)
        west = lon0 + math.degrees((float(x0) - fe + (half - ti) * float(sx)) / k)
        north = math.degrees((float(y0) - fn - (half - tj) * float(sy)) / R)
        crs = f"equirectangular, lat_ts={lat_ts:g}, lon0={lon0:g}, sphere R={R:.0f} m"
    else:
        raise TerrainDataError("GeoTIFF model type is not stated (GTModelTypeGeoKey); cannot georeference")

    west = normalize_lon(west)
    if bbox is not None:
        min_lat, min_lon, max_lat, max_lon = bbox
        r0 = max(0, int(math.floor((north - max_lat) / dlat)))
        r1 = min(a.shape[0], int(math.ceil((north - min_lat) / dlat)) + 1)
        c0 = max(0, int(math.floor(((min_lon - west + 180) % 360 - 180) / dlon)))
        c1 = min(a.shape[1], int(math.ceil(((max_lon - west + 180) % 360 - 180) / dlon)) + 1)
        if r1 - r0 < 3 or c1 - c0 < 3:
            raise TerrainDataError("bbox does not overlap the GeoTIFF (or is smaller than 3 x 3 cells)")
        a = a[r0:r1, c0:c1]
        north -= r0 * dlat
        west = normalize_lon(west + c0 * dlon)
        lineage.append(f"clipped to rows {r0}:{r1}, cols {c0}:{c1}")
    if decimate > 1:
        a = _block_mean_strict(a, decimate)
        off = (decimate - 1) / 2
        north -= off * dlat
        west = normalize_lon(west + off * dlon)
        dlat, dlon = dlat * decimate, dlon * decimate
        lineage.append(f"{decimate}x{decimate} block mean (blocks with any no-data left as no-data)")

    geom = GridGeometry(north, west, dlat, dlon, a.shape[0], a.shape[1], R)
    md = TerrainMetadata(**{**metadata.to_dict(),
                            "crs": metadata.crs or crs,
                            # resolution of THIS package's grid (lineage keeps the source details)
                            "spatial_resolution_m": round(geom.cell_size_m, 2),
                            "lineage": list(metadata.lineage) + lineage})
    return TerrainGrid(a.astype(np.float32), geom, md)
