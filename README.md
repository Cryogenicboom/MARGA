# MARGA [ Mars Adaptive Route Guidance Architecture ]

![MARGA System Prototype](https://img.shields.io/badge/MARGA-v1.0--PROTOTYPE-orange?style=for-the-badge)
![NASA Space Apps Challenge](https://img.shields.io/badge/NASA%20Space%20Apps-2026-blue?style=for-the-badge)

MARGA is an offline-first, lightweight Mars route-planning application designed for future human surface missions to Mars. It provides astronauts and mission planners with a digital surface navigation and decision-support workstation, integrating scientific observations from NASA Mars missions (Curiosity, CRISM, MOLA, CTX, HiRISE) with terrain-aware traversal routing in **Gale Crater / Mount Sharp**.

**Live Prototype:** https://marga-wugg.vercel.app/

---

## NASA Space Apps Challenge Alignment

MARGA was created for the **NASA Space Apps Challenge 2026** addressing the **"Create a Martian Map"** challenge.

MARGA addresses the challenge by combining orbital terrain products and landed mission science into an interactive, offline-capable digital map and navigation workstation. Key alignment features include:

- **Interactive Multi-Layered Martian Map**: High-resolution visualization of CTX and HiRISE imagery, hillshade, elevation DEMs, continuous slope, terrain roughness, and NASA Mars Trek context layers.
- **Terrain-Aware Traversal Navigation**: A deterministic, terrain-cost-weighted routing engine in Python and TypeScript calculating optimal EVA routes, slope safety limits, walking speeds, and return-time margins.
- **Landed Science Data Provenance**: Deep integration of NASA MSL Curiosity observations, including quantitative CheMin X-ray diffraction mineralogy tables from the NASA PDS and 360° Navcam panoramic surface context.
- **Offline Mission Reliability**: Built with an offline-first architecture to ensure operational reliability on Mars without reliance on high-bandwidth Earth connectivity.

---

## Project Structure

The project is divided into separate modules so that the frontend, routing engine, NASA data and testing work can be developed independently.

```text
MARGA/
├── frontend/             # React, TypeScript and OpenLayers application
│   ├── src/
│   │   ├── components/   # Goals, targets, constraints and diagnostics
│   │   ├── map/          # Mars map, layers and coordinate handling
│   │   ├── services/     # Data access and route-engine integration
│   │   ├── styles/       # Application styling
│   │   ├── App.tsx       # Main dashboard
│   │   └── main.tsx
│   └── package.json
│
├── engine/               # Python and TypeScript routing components
├── science_data/         # NASA observations, catalogues and metadata
├── test_data/            # Terrain rasters and test scenarios
├── shared/               # Shared schemas and TypeScript types
│   └── gis/              # Mars coordinate reference information
├── gis/                  # Rasterio, GeoPandas and Shapely workflows
├── docs/                 # Architecture and data documentation
└── README.md
```

---

## Getting Started

### Requirements

Install **Node.js 22 LTS or later**.

- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node`

The application is designed to work offline after its dependencies and regional data have been installed. The included setup launcher automatically manages dependency installation.

### Download and Run the Project

Run the following commands in your shell:

```bash
git clone https://github.com/Cryogenicboom/MARGA.git
cd MARGA
```

You can also download the repository using GitHub's **Code → Download ZIP** option.

#### Start the Application

- **Windows:** Run `Start MARGA.bat`.
- **macOS/Linux:** Run `./start.sh` from the project directory.

The launcher installs the frontend dependencies on the first run and starts the application in your browser. By default, the application opens at: `http://localhost:3000`

Keep the terminal window open while using MARGA. Press `Ctrl+C` to stop the application.

#### Manual Installation

You can also start the frontend manually:

```bash
cd frontend
npm install
npm run dev
```

---

## Using MARGA

The main screen is arranged like a mission-planning workstation. Exploration settings and objectives are on the left, the map and elevation profile are in the centre, and route and mission information are on the right.

### 1. Select a Destination
Choose a target from the catalogue or click a target marker on the map. You can also select a location inside the available terrain boundary. To set the starting point, hold `Shift` and click the map.

### 2. Explore the Map Layers
The map provides several layers for examining the region:
- HiRISE and CTX imagery
- Hillshade
- Elevation
- Slope and Roughness
- Scientific targets and Planned route overlays

Slope can be displayed as a continuous layer or as terrain classes. The slope-limit overlay highlights areas that the routing engine will not enter under the current settings. Additional Mars Trek context layers are available under **More layers**.

### 3. Choose a Scientific Objective
The objectives panel contains pre-mission objectives. Selecting an objective displays its associated science targets.

### 4. Configure the Route
The route-planning panel allows configuring starting hub, destination, intermediate stops, walking speed, maximum slope limit, EVA duration budget, and safety time reserves. Available route optimization modes include *Lowest terrain cost*, *Shortest route*, and *Fastest estimated route*.

### 5. Review the Elevation Profile
The elevation profile shows terrain changes along the planned route, with interactive hovering synchronized between the map and profile.

### 6. Mission Information Panels
- **ROUTE**: Selected locations, total distance, difficulty rating, estimated duration, and JSON export.
- **EVA**: Mission timeline, remaining time budget, and safety margins.
- **CONTEXT**: Radiation baselines, dataset validity, and terrain diagnostics.
- **CATALOGUE**: Objectives, target records, and NASA PDS references.

### 7. Curiosity Mineral Data
Includes quantitative Curiosity CheMin mineral-abundance records obtained from NASA's PDS Geosciences Node (weight %, 2σ errors, clay/amorphous fractions, and PDS links).

### 8. Curiosity Rover Panoramas
Provides 360-degree panoramas assembled from Curiosity Navcam frames with spatial context and traverse progression.

---

## Terrain Data & Route Planning

### NASA Orbital DEM vs. Synthetic Demonstration Terrain

The project maintains two distinct terrain packages to support both realistic mission analysis and offline development/testing:

1. **Real NASA DEM (`Gale_DEM_SMG_1m`)**:
   - The primary terrain package (`frontend/public/terrain/gale`) is derived from NASA Mars Trek high-resolution orbital data (HiRISE/CTX-derived), exported at ~20 m spatial resolution covering the Curiosity traverse area in Gale Crater.
   - **Data Status**: Marked as unvalidated for operational flight navigation; intended strictly for research and decision-support prototyping.

2. **Synthetic Demonstration Terrain (`data/terrain_backup/gale_synthetic_demo/`)**:
   - An artificial elevation raster generated for offline algorithm benchmarking, fallback scenarios, and unit/integration test suites (`make_synthetic_demo.py`).
   - Allows developers to test route optimization and frontend rendering without requiring full GIS raster downloads.

### Rebuilding or Switching Terrain Data

To download the NASA source DEM data:

```bash
python engine/tools/fetch_gale_dem.py
```

To run terrain validation checks (coverage, fill values, target elevations):

```bash
python engine/tools/check_terrain.py
```

To switch to the synthetic demonstration terrain package:

```bash
python engine/tools/make_synthetic_demo.py
```

---

## Environmental Observations & Limitations

MARGA focuses on spatial, topographic, and mineralogical data. Users should note the following environmental data limitations:

- **Atmospheric & Weather Data**: Real-time or simulated atmospheric temperature, surface pressure, wind vectors, and seasonal dust storm dynamics are **not loaded or modeled** in the current prototype.
- **Radiation Baselines**: Radiation context values and dose rates provided in the application are **historical reference baselines** derived from Curiosity's Radiation Assessment Detector (RAD) instrument; they do not provide real-time space weather forecasting or active solar particle event alerts.

---

## Science Target Locations & Catalogue Provenance

The scientific catalogue links Curiosity-visited locations to recorded rover waypoints (matching NASA's MSL localization within ~15 m of the DEM):

- **CheMin Product IDs**: CheMin mineral sample product records carry PDS label attributes. Individual product revision IDs have not been independently cross-verified against every PDS archive release.
- **Representative & Placeholder Locations**:
  - `target_crater_rim_fault` (**"Northern Rim Approach"**) is a planning placeholder; the physical crater rim of Gale lies north outside the current DEM boundaries and is not a verified reachable target.
  - `target_rad_station_alpha` is a representative planning location used to display RAD radiation baseline metrics, rather than a specific physical sampling station.

---

## GIS Layers and Coordinate System

Map layers and routing grids use Cloud Optimized GeoTIFFs in `frontend/public/gis/gale/` prepared using Rasterio.

The project uses the Mars coordinate reference system identified as **`IAU_2015:49900`** (planetocentric Mars sphere). For detailed spatial transformations and layer offset notes (such as CTX 120 m alignment offsets), consult `gis/README.md`.

---

## AI / Synthetic Intelligence (SI) Disclosure

In accordance with NASA Space Apps Challenge guidelines, the AI tools and synthetic intelligence assistance used during the development of MARGA are fully disclosed:

- **AI Tools Used**: Claude Code, Gemini CLI, Kimi CLI.
- **Role in Development and Testing**: AI models were used to assist in drafting project documentation, creating TypeScript and Python unit/integration test suites, refactoring GIS data transformation workflows, formatting Markdown artifacts, and generating synthetic test terrain generation scripts (`make_synthetic_demo.py`).
- **Human Oversight**: Core routing algorithms, coordinate system implementations, data provenance checks, and application integration were authored, reviewed, and verified by the development team.

---

## Verification and Build

The repository includes test suites across the frontend, routing engine, and GIS workflows.

```bash
# Frontend build
cd frontend && npm run build

# TypeScript engine tests (25 tests)
cd engine/ts && npm install && npm test

# Python reference engine tests (115 tests)
cd engine && python -m pytest -q

# GIS and data-processing tests (52 tests)
cd gis && python -m pytest -q tests
```

---

## License, Citations and Safety Disclaimer

### Open-Source Licensing
MARGA original work is released under the OSI-compliant **[Apache License, Version 2.0](./LICENSE)**.

### Third-Party Materials & Data Citations
Detailed licensing, credits, and citations for third-party open-source libraries and NASA Planetary Data System (PDS) datasets used in this project are documented in **[THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)**.

### Expanded Safety Disclaimer
MARGA is a research and decision-support prototype built using historical NASA mission data and project-prepared terrain products.

- **Non-Certified Estimates**: All calculated route recommendations, traversal difficulty scores, slope cost limits, estimated travel times, and EVA budget margins are heuristic approximations calculated from an unvalidated terrain model and simplified mobility assumptions.
- **Astronaut Safety**: These route outputs do **NOT** constitute certified astronaut safety recommendations, life-critical navigation advice, or flight-approved mission parameters.
- **Experimental Status**: The Gale Crater elevation model and cost rasters are experimental. Route feasibility must be independently verified by certified mission operations and planetary safety teams before any physical surface traversal.
