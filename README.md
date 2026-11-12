# MARGA — Mars Adaptive Route Guidance Architecture

![MARGA System Prototype](https://img.shields.io/badge/MARGA-v1.0--PROTOTYPE-orange?style=for-the-badge)
![React](https://img.shields.io/badge/React-18.3-cyan?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=for-the-badge&logo=typescript)
![OpenLayers](https://img.shields.io/badge/OpenLayers-9.2-emerald?style=for-the-badge)

MARGA is an offline-first, lightweight Mars surface excursion planning application. It integrates scientific target observations from NASA Mars missions (Curiosity, CRISM, MOLA, HiRISE) with terrain-aware traversal routing to assist astronaut mission planning in **Gale Crater / Mount Sharp**.

---

## Features (Person 1 - Frontend & Framework Lead)
- 🛰️ **Interactive Mars Surface Map**: OpenLayers, equirectangular lon/lat (EPSG:4326), drawn from the same terrain model the router uses: shaded relief with contours, a slope-hazard overlay that follows the slope-limit slider (red = the router will not enter), and elevation/slope under the cursor. Works offline; no map API keys.
- 🧭 **Live Route Planning**: routes re-plan automatically when the start, destination or constraints change, in a background Web Worker so the map never freezes.
- 🎯 **Science Target Catalogue**: Filterable NASA target observations (Hydration, Mineralogy, Sedimentary, Geological, Radiation) with confidence scores and metadata provenance.
- 🔬 **Mission Objective Selection**: Connects high-level scientific goals to relevant target clusters.
- ⚙️ **Configurable Traversal Constraints**: Adjustable astronaut walking speed, maximum slope limits, total EVA duration budget, and safety reserve margins.
- 🧮 **Terrain-Aware Route Diagnostics**: Real-time distance ($m$/$km$), estimated travel time, EVA time budget bars, return safety margins, slope breakdown charts, and GeoJSON export.
- 🔌 **Shared Integration Architecture**: Clean interfaces (`shared/types/index.ts`) connecting Frontend, Core Engine, NASA Data, and Test Modules.

---

## Project Structure

```
MARGA/
├── frontend/             # React + TypeScript + OpenLayers Web Application
│   ├── src/
│   │   ├── components/   # UI Panels (Goals, Targets, Constraints, Diagnostics)
│   │   ├── map/          # OpenLayers Mars map, styles, coordinate projections
│   │   ├── services/     # Mock data and client-side route calculation engine
│   │   ├── styles/       # Dark sci-fi mission control theme
│   │   ├── App.tsx       # Main dashboard layout shell
│   │   └── main.tsx
│   └── package.json
├── engine/               # Python A* Route Engine & Terrain Cost Module (Person 2)
├── science_data/         # NASA GeoJSON Catalogues & Metadata (Person 3)
├── test_data/            # Synthetic Terrain Rasters & Test Scenarios (Person 4)
├── shared/               # Shared Data Schemas & TypeScript Types (and shared/gis: the Mars CRS)
├── gis/                  # GIS data preparation: Rasterio, GeoPandas, Shapely (Python)
├── docs/                 # System Architecture & Development Documentation
└── README.md
```

---

## Quick Start

You need [Node.js](https://nodejs.org) 22 LTS or newer (Windows: `winget install OpenJS.NodeJS.LTS`,
macOS: `brew install node`). Everything else is installed automatically, and the app runs fully offline
after the first install: the route engine and the Gale Crater terrain ship with the repository.

```bash
git clone https://github.com/coding-otter/MARGA-FINAL.git
cd MARGA-FINAL
```

(Or use GitHub's **Code → Download ZIP** and unzip it.) Then:

- **Windows:** double-click **`Start MARGA.bat`**.
- **macOS / Linux:** run `./start.sh` in a terminal.

On first run the launcher installs the frontend packages (about a minute), then opens MARGA in your
browser at [http://localhost:3000](http://localhost:3000). Keep the window open while you use the app;
close it (or press Ctrl+C) to stop. If port 3000 is busy, the next free port is used and printed.

**Manually, on any OS:**

```bash
cd frontend
npm install
npm run dev
```

### Using it

- **Destination:** click a target pin, a target in the TARGETS list, or anywhere inside the dashed terrain boundary.
- **Start:** Shift+click the map.
- **Constraints:** PARAMS tab. The route and the red slope-hazard overlay update as you move the sliders.
- **Details:** ROUTE tab for the elevation profile, EVA budget, warnings, segments and JSON export.
- **Map layers:** the Map layers section (left panel) holds the basemap choices (terrain renderings, HiRISE or CTX imagery), the terrain overlays (slope hazard, continuous slope, roughness, with opacity), the science targets and the Mars Trek context layers, and route overlays. The Context tab lists every layer's source and checks.

### Terrain data

The app routes on the **real Gale Crater elevation model** from NASA Mars Trek (`Gale_DEM_SMG_1m`, a
HiRISE-derived DEM of the Curiosity traverse, exported at ~20 m), packaged in `frontend/public/terrain/gale`.
It is marked **unvalidated** (shown in the map legend): it has not been checked by the data team and is
not for operational use.

- Rebuild it: `python engine/tools/fetch_gale_dem.py` (downloads ~16 MB into `data/raw/`, which git ignores),
  then `python engine/tools/check_terrain.py` to check coverage, fill values and target elevations.
- Go back to the synthetic demo terrain: copy `data/terrain_backup/gale_synthetic_demo/*` into
  `frontend/public/terrain/gale/` and delete `elevation.f32` there (or run `python engine/tools/make_synthetic_demo.py`).

**GIS layers and coordinate system:** the map's terrain is rendered from Cloud-Optimized GeoTIFFs in
`frontend/public/gis/gale/`, built with Rasterio from the same DEM read as the routing grid, in MARGA's Mars
CRS (IAU_2015:49900, planetocentric, Mars sphere). How to rebuild them, and why the DEM's own CRS label was
corrected with evidence: [`gis/README.md`](gis/README.md).

**Imagery and context layers:** HiRISE (5 m) and CTX (~10 m) imagery, slope and roughness rasters, and
Mars Trek vector layers (Exploration Zone, regions of interest, Curiosity traverse, geologic units, place
names, dune fields) are fetched for the Gale region only and processed by `python -m marga_gis.region
fetch|build gale`. Every request URL, checksum and timestamp is recorded in `data/regions/gale/manifest.json`.
CTX lies about 120 m SW of the DEM (measured, shown as delivered); HiRISE lines up with it.

**Target locations:** the Curiosity-visited targets sit at the rover's recorded positions at named drill
sites and stops (NASA MSL waypoint data), and agree with the DEM within 15 m. Sources per target:
[`docs/data_sources.md`](docs/data_sources.md#science-target-locations). "Northern Rim Approach" is a
labelled planning placeholder: the real crater rim is outside the terrain model.

---

## Verification & Build

```bash
cd frontend
npm run build                       # type-check + production build into frontend/dist
cd ../engine/ts && npm install && npm test        # TypeScript engine: 25 tests

# Python reference engine: 115 tests (Windows paths shown; use .venv/bin on macOS/Linux)
cd ../ && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m pytest -q

# GIS and Mars Trek acquisition: 42 tests, no network
cd ../gis && ..\engine\.venv\Scripts\python -m pytest -q tests
```

---

## Team Roles & Responsibilities

| Role | Developer | Responsibilities |
| :--- | :--- | :--- |
| **Person 1** | Application Architect & Frontend Lead | Main React framework, OpenLayers map, shared types, UI panels, mock data |
| **Person 2** | Core Engine & Technical Lead | Deterministic A* routing, terrain-cost calculation, EVA time budget logic |
| **Person 3** | NASA Data & Science Catalogue Lead | NASA dataset inventory, Gale Crater GeoJSON target catalogue, data provenance |
| **Person 4** | Testing, Validation & Data Prep | Synthetic test rasters, distance/coordinate validation, offline loading tests |

---

## License & Disclaimers
MARGA is a decision-support prototype using historical NASA data. Traversal paths do not constitute guaranteed safety or certified mobility parameters.
