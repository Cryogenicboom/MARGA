# MARGA GIS foundation

Data preparation for MARGA's map: georeferenced rasters with **Rasterio**, vector data with
**GeoPandas** and **Shapely**, coordinate systems with **pyproj**. The app and the route engine do not
need these libraries at runtime; the browser reads the files this package writes.

## Coordinate reference system

MARGA uses one CRS everywhere: **IAU_2015:49900, "Mars (2015) - Sphere / Ocentric"**, defined once in
[`shared/gis/mars_crs.json`](../shared/gis/mars_crs.json) (generated from the PROJ database) and read
by both Python ([`marga_gis/crs.py`](marga_gis/crs.py)) and TypeScript ([`shared/gis/marsCrs.ts`](../shared/gis/marsCrs.ts)).

- Coordinates are `[longitude, latitude]` degrees: planetocentric latitude, east-positive longitude,
  on the Mars reference sphere (radius 3,396,190 m). The engine's radius constant is checked against it.
- Earth CRSs (WGS 84 / EPSG:4326, Web Mercator) are refused for Mars data.
- GeoJSON is WGS 84 by definition (RFC 7946), so GeoPandas labels any GeoJSON as Earth data. Mars
  GeoJSON is only accepted when the caller states why its coordinates are planetocentric Mars
  coordinates (`vector.read_mars_vector(..., assume_marga_crs="reason")`).
- No coordinate transformation is invented. A dataset in another CRS is refused, or re-labelled only
  with recorded evidence; coordinate values are never changed silently.
- In the browser, OpenLayers uses a custom projection with this code, Mars metres per degree and a
  Mars ground-resolution function, so the scale bar measures on Mars, not on Earth.

### The Gale DEM's CRS label

The Mars Trek Gale DEM declares `GCS_Mars_2000` (an ellipsoid, which would make its latitudes
planetographic). Sampled at 1,387 Curiosity positions (planetocentric, NASA MMGIS), the DEM agrees with
the rover's measured elevations to a median 7.9 m (max 19 m) if its latitudes are planetocentric, and
is off by a median 385 m (max 577 m) if planetographic; the two differ by 3.3 km at Gale. The values are
therefore used unchanged as IAU_2015:49900, and the evidence is stored in `layers.json` and in the
terrain package's lineage. [`marga_gis/evidence.py`](marga_gis/evidence.py) repeats this test for any DEM.

## Building a site's layers

From this folder, with the engine's Python environment plus [`requirements.txt`](requirements.txt):

```bash
..\engine\.venv\Scripts\python -m pip install -r requirements.txt
..\engine\.venv\Scripts\python -m marga_gis.build_site --site gale --dem ../data/raw/gale/gale_hirise_dtm_20m.tif --bbox -4.85 137.20 -4.45 137.60 --provenance ../frontend/public/terrain/gale/terrain.json --evidence-points ../data/raw/msl/MSL_waypoints.json --evidence-elevation elev_geoid --evidence-crs-reason "MSL rover localization published by NASA MMGIS: planetocentric Mars coordinates"
```

(macOS/Linux: `../engine/.venv/bin/python`.) One DEM read produces:

| Output | Content |
| --- | --- |
| `frontend/public/gis/<site>/elevation.tif` | Cloud-Optimized GeoTIFF, float32 metres, NaN = no data |
| `frontend/public/gis/<site>/hillshade.tif` | COG, uint8 shade 1-255 (display only, not elevation), 0 = no data |
| `frontend/public/gis/<site>/layers.json` | CRS, transform, bounds, resolution, value range, provenance, CRS evidence |
| `frontend/public/terrain/<site>/` | the route engine's terrain package, from the same pixels |

The DEM reader refuses anything that is not an elevation raster: more than one band, 8-bit or palette
images, rasters without a CRS or geotransform, rotated grids, or values outside Mars surface elevations.
Clipping uses the same rule as the engine's importer, so the map layers and the routing grid share
rows, columns and transform exactly (checked by the tests).

## Regional data from NASA Mars Trek

`marga_gis.region` fetches a region's data from NASA Mars Trek (https://trek.nasa.gov/mars/) and builds
everything above plus imagery and context layers. The region is described in
[`regions/gale.json`](regions/gale.json): its bounding box, the products (service, layer, pixel grid) and
the vector layers. Only that box is requested from the services; nothing is downloaded globally.

```bash
..\engine\.venv\Scripts\python -m marga_gis.region fetch gale --dry-run   # show the requests, download nothing
..\engine\.venv\Scripts\python -m marga_gis.region fetch gale             # download (~45 MB, cached; Ctrl+C cancels)
..\engine\.venv\Scripts\python -m marga_gis.region build gale             # process into frontend/public/gis/gale
..\engine\.venv\Scripts\python -m marga_gis.region status gale            # what is in the package
```

`--only dem,ctx` limits a fetch to some products; `--workers` sets parallel tile downloads. A fetch
reuses files already on disk, so an interrupted fetch resumes where it stopped.

**What is fetched for Gale**

| Product | Service | Grid |
| --- | --- | --- |
| DEM `Gale_DEM_SMG_1m` (HiRISE stereo) | ImageServer exportImage | 1800 x 2005 at ~20 m; the request is byte-identical to the original DEM download |
| HiRISE `curiosity_hirise_mosaic` | ImageServer exportImage | 5 m, in two requests (the service limit is 15000 x 4100 px) |
| CTX `Gale_CTX_BlockAdj_dd` | WMTS tiles, level 12 | ~10.2 m, 100 tiles; CTX of Gale is published only as tiles |
| Vectors: Exploration Zone, its regions of interest, Curiosity traverse, geologic units (SIM 3292), place names, dune fields | MapServer query | Esri JSON in spatial reference 104905 |

**How the services are used, and why**

- Image exports are requested on an explicit pixel grid. Large grids are split into chunks on the same
  grid, and each returned GeoTIFF's size, corner and pixel size are checked against the request.
- WMTS tiles are georeferenced from the tile matrix (top-left -180, 90; 256 px tiles spanning 360
  degrees), not from `ScaleDenominator`, which on Mars Trek only fits Earth's metres per degree. A
  404 tile is "no data there", never an error.
- Vector queries can't paginate, so the object ids in the box are fetched first, then the features in
  batches of 1000. Esri JSON is used because the services' GeoJSON output labels Mars coordinates
  EPSG:4326.
- Every service declares GCS_Mars_2000 (104905). As for the DEM, its coordinates are used unchanged
  as IAU_2015:49900, on the evidence recorded in `layers.json`; no transformation is applied.
- Downloads stream to `.part` files with a SHA-256 and are renamed only when complete. ArcGIS error
  documents (sent with HTTP 200) are detected by content type and never saved as data.

**What the build checks**

- Imagery is clipped to the region on its native grid (no resampling), stored as 8-bit COGs with 0 =
  no data. Its registration to the DEM is measured by correlating image edges with DEM slope, and
  coarser imagery is also correlated against the finest image. The measured offsets are recorded,
  not applied. For Gale: HiRISE lies within one 20 m DEM cell of the DEM; CTX lies about 120 m SW of
  it (12 sigma against HiRISE). The map shows CTX as delivered, with that warning.
- Slope and roughness COGs are computed by the engine's own functions (`slope_degrees`,
  `detrended_roughness`), the values the router uses.
- The Mars Trek Curiosity traverse is compared with the MMGIS waypoints. It matches them exactly (median
  0 m) up to sol 2257, and nothing after that is on the line. The map labels it "to sol 2257".

**Where things go**

| Path | Content | In git |
| --- | --- | --- |
| `data/regions/<site>/raw/` | original responses: exports, tiles, capabilities, vector JSON | no |
| `data/regions/<site>/manifest.json` | every request URL, catalogue record, file size, SHA-256, timestamp, validation and processing record | yes |
| `frontend/public/gis/<site>/` | elevation, hillshade, slope, roughness and imagery COGs, `vectors/*.geojson`, `layers.json` | yes (~42 MB) |

The app reads only `frontend/public/gis/<site>/`, so it works offline. Mars Trek's FGDC metadata pages
returned empty responses when checked; provenance comes from the catalogue records, the service
metadata and the request URLs, as the manifest notes.

## Tests

```bash
..\engine\.venv\Scripts\python -m pytest -q tests
```

The Mars Trek tests (`tests/test_trek.py`) cover the tile and export grid maths, request planning, Esri
geometry conversion, the downloader against a local HTTP server (progress, retries, 404s, error
documents, truncation, cancellation) and the image offset measurement. None of them uses the network.
