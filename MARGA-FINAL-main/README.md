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

The screen is a mission workstation: planning on the left, the map and elevation profile in the middle,
mission operations on the right.

- **Destination:** click a target pin or anywhere inside the dashed terrain boundary, or use a target's
  *Set dest.* in the objective or the Catalogue. **Start:** Shift+click the map.
- **Map layers** (left): base imagery (HiRISE, CTX, hillshade or none), then independent switches for
  elevation, slope (continuous or the engine's classes, plus the slope-limit hazard), roughness, science
  targets and the planned route. NASA Mars Trek context layers are under *More layers*.
- **Science objectives** (left): the pre-mission objectives, read-only. Activating one shows its targets;
  switching objective while a route is planned asks first.
- **Route planning** (left): starting hub, science stops (add, reorder, remove), destination, the route
  alternative to plan by (lowest terrain cost, shortest, fastest), Recalculate, and the constraints.
  **Route summary** gives distance and feasibility at a glance.
- **Elevation profile** (middle): hover to see the point on the map, hover the route on the map to see it
  on the profile, click the profile to centre the map there.
- **Right panel tabs:** ROUTE (places, distance, difficulty, duration, feasibility; per-leg data and JSON
  export under *Technical details*), EVA (mission timeline with remaining time or deficit), CONTEXT
  (radiation reference, environment, terrain conditions, data validity; full provenance under *Data sources
  and diagnostics*), CATALOGUE (objectives, target records, NASA references, and crew notes).
- **Mineral data** (Catalogue → *Minerals*, or the diamond markers on the map): every sample Curiosity's
  CheMin instrument analysed by X-ray diffraction, from NASA PDS, with weight % and 2σ errors per mineral,
  the clay and amorphous fractions stated in each PDS label, and links to the PDS files. A target's record
  lists the samples analysed near it.
- **Rover views** (ringed dots on the map, *Rover view nearby* in a target's record, or the Route tab): click
  to look around a 360° panorama made from Curiosity's Navcam frames at that stop. Drag to look, scroll to
  zoom, *Earlier* / *Later* (or the arrows in the view) to step along the traverse; the map inset shows where
  you are looking. Esc closes.
- **Crew notes and observations** are marked *Crew* and kept apart from the catalogue. They are stored in
  the browser; use *Export* in Catalogue → Crew notes to keep the mission record.
- **High contrast** (header) switches the whole interface to a black-and-white, high-contrast palette.

### Terrain data

The app routes on the **real Gale Crater elevation model** from NASA Mars Trek (`Gale_DEM_SMG_1m`, a
HiRISE-derived DEM of the Curiosity traverse, exported at ~20 m), packaged in `frontend/public/terrain/gale`.
It is marked **unvalidated** (shown in the map legend): it has not been checked by the data team and is
not for operational use.

- Rebuild it: `python engine/tools/fetch_gale_dem.py` (downloads ~16 MB into `data/raw/`; a copy is already in the repository),
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

**Curiosity mineralogy and rover views:** `python -m marga_gis.msl fetch` then `build` (from `gis/`) downloads
the CheMin mineral abundance tables from the NASA PDS Geosciences Node and Navcam frames from NASA's MSL
raw-image API, and writes `frontend/public/science/chemin_samples.json` and `frontend/public/rover/`.
Every request is recorded in `data/msl/manifest.json`. Method, checks and limits:
[`docs/data_sources.md`](docs/data_sources.md#curiosity-mineralogy-chemin).

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

# GIS, Mars Trek and Curiosity data: 52 tests, no network
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
