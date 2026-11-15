# MARGA [ Mars Adaptive Route Guidance Architecture ]

![MARGA System Prototype](https://img.shields.io/badge/MARGA-v1.0--PROTOTYPE-orange?style=for-the-badge)

MARGA is an offline lightweight Mars route-planning application. It is designed for first human mission to Mars, providing them with a digital navigation system. Astronauts can use it to plan their route with accordance to their mission data. **Currently the application only focuses on GALE Crater.** Therefore it uses scientific observations from NASA Mars missions (Curiosity, CRISM, MOLA, HiRISE) with terrain-aware traversal routing to assist astronaut mission planning in **Gale Crater / Mount Sharp**.

Checkout the live project here: https://marga-wugg.vercel.app/

Below reading will help you with downlaoding and running the project. Further below we have also provided a guide to use the application, although a detailed manual is still in development, we are sorry for the delay :) . 
---

MARGA is a **research** and **planning** prototype. Its route calculations are not certified astronaut safety recommendations. 

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
## Getting Started

### Requirements

Install **Node.js 22 LTS or later**.

- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node`

The application is designed to work offline after its dependencies and regional data have been installed. **Don't worry**, the BAT file automatically downlaods the given dependencies and prepare the application for you. [This script is coded with super intelligence]

## Download and Run the project

run the below commands in shell:
<br>

```bash
git clone https://github.com/coding-otter/MARGA-FINAL.git
cd MARGA-FINAL
```
<br>

or You can also download the repository using GitHub's **Code → Download ZIP** option.

##### Start the application

- **Windows:** Run `Start MARGA.bat`.
- **macOS/Linux:** Run `./start.sh` from the project directory.

The launcher installs the frontend dependencies on the first run and starts the application in your browser. By default, the application opens at: `http://localhost:3000`
<br>

Keep the terminal window open while using MARGA. Close it or press `Ctrl+C` to stop the application. If port 3000 is already in use, the launcher selects another available port and displays it.

##### Manual installation

You can also start the frontend manually:

```bash
cd frontend
npm install
npm run dev
```

## Using MARGA

The main screen is arranged like a mission-planning workstation. Exploration settings and objectives are on the left, the map and elevation profile are in the centre, and route and mission information are on the right.

### 1. Select a destination

Choose a target from the catalogue or click a target marker on the map. You can also select a location inside the available terrain boundary.

To set the starting point, hold `Shift` and click the map.

### 2. Explore the map layers

The map provides several layers for examining the region:

- HiRISE and CTX imagery
- Hillshade
- Elevation
- Slope
- Roughness
- Scientific targets
- Planned route

Slope can be displayed as a continuous layer or as terrain classes. The slope-limit overlay highlights areas that the routing engine will not enter under the current settings.

Additional Mars Trek context layers are available under **More layers**.

### 3. Choose a scientific objective

The objectives panel contains the available pre-mission objectives. Selecting an objective displays its associated targets.

The objective definitions are read-only. If a route is already planned, the application asks before switching objectives.

### 4. Configure the route

The route-planning panel allows you to select:

- Starting hub
- Destination
- Intermediate science stops
- Route preference
- Walking speed
- Maximum slope
- EVA duration
- Safety reserve

Intermediate stops can be added, removed or reordered.

The available route preferences are:

- Lowest terrain cost
- Shortest route
- Fastest estimated route

After changing the settings, use **Recalculate** to generate an updated route.

### 5. Review the elevation profile

The elevation profile shows how the terrain changes along the planned route.

Hovering over the profile identifies the corresponding location on the map. Hovering over the route on the map highlights the matching point in the profile. Clicking the profile centres the map on that location.

### 6. Review mission information

The right-hand panel contains four sections:

**ROUTE** — Shows the selected locations, total distance, route difficulty, estimated duration and feasibility. Per-leg information and JSON export are available under Technical Details.

**EVA** — Displays the mission timeline, remaining time and any time deficit against the configured budget.

**CONTEXT** — Provides radiation references, environmental information, terrain conditions and dataset validity. Additional source details are available under Data Sources and Diagnostics.

**CATALOGUE** — Contains objectives, target records, NASA references and crew notes.

### 7. Curiosity mineral data

The Catalogue includes a Minerals section containing Curiosity CheMin mineral-abundance records obtained from NASA's PDS Geosciences Node.

The records include:

- Mineral abundance in weight percent
- Reported 2σ errors
- Clay and amorphous fractions from the relevant PDS labels
- Links to the original PDS files

Target records also list the available analysed samples associated with nearby locations.

### 8. Curiosity rover views

Selected locations provide access to 360-degree panoramas assembled from Curiosity Navcam frames.

These can be opened from the map markers, a target's **Rover view nearby** option or the Route tab.

Drag to look around, scroll to zoom, and use **Earlier** and **Later** to move through the rover traverse. A small map inset shows the observation location. Press `Esc` to close the viewer.

### 9. Crew notes

Crew notes and observations are kept separate from the NASA science catalogue and marked as **Crew**.

They are stored in the browser. Use **Export** under Catalogue → Crew Notes to save a copy of the mission record.

### 10. High-contrast display

The header includes a high-contrast option that switches the interface to a black-and-white colour scheme for improved visibility.

---

## Terrain Data and Route Planning

### Gale Crater elevation model

The current prototype uses a Gale Crater elevation model identified in the project as:

`Gale_DEM_SMG_1m`

The source is NASA Mars Trek. The model is described in the project as HiRISE-derived and exported at approximately 20 m for the Curiosity traverse area. It is packaged under:

`frontend/public/terrain/gale`

**Data status:** The terrain model is currently marked as unvalidated. It has not yet been fully checked by the data team and must not be treated as operational navigation data.

### Rebuilding the terrain data

To download the source data:

```bash
python engine/tools/fetch_gale_dem.py
```

The download is approximately 16 MB and is saved under `data/raw/`.

To run the terrain checks:

```bash
python engine/tools/check_terrain.py
```

These checks cover data coverage, fill values and target elevations.

### Switching to the synthetic demonstration terrain

To restore the synthetic terrain dataset, copy the contents of:

`data/terrain_backup/gale_synthetic_demo/`

into:

`frontend/public/terrain/gale/`

Remove `elevation.f32` from that destination, or run:

```bash
python engine/tools/make_synthetic_demo.py
```

## GIS Layers and Coordinate System

The map and routing engine use the same underlying elevation model so that the terrain displayed to the user corresponds to the terrain used for route calculations.

Map layers are generated as Cloud Optimized GeoTIFFs in:

`frontend/public/gis/gale/`

They are prepared using Rasterio from the elevation data used by the routing grid.

The project uses the Mars coordinate reference identified in its GIS configuration as:

`IAU_2015:49900`

The configuration describes a planetocentric Mars coordinate system using a Mars sphere.

The CRS label and its relationship to the source DEM are documented in:

`gis/README.md`

This documentation should be consulted before adding or transforming additional spatial datasets.

### Imagery and context layers

The Gale region data package includes:

- HiRISE imagery at approximately 5 m
- CTX imagery at approximately 10 m
- Slope and roughness rasters
- Mars Trek exploration-zone layers
- Regions of interest
- Curiosity traverse information
- Geological units
- Place names
- Dune fields

These layers are retrieved and processed using:

```bash
python -m marga_gis.region fetch
python -m marga_gis.region build gale
```

The project records request URLs, checksums and timestamps in:

`data/regions/gale/manifest.json`

The current data preparation notes report that the CTX imagery is approximately 120 m southwest of the DEM, while the HiRISE imagery aligns with it. These offsets are retained in the delivered data rather than silently corrected.


## Curiosity Mineralogy and Rover Data

Curiosity mineralogy and rover imagery are prepared through the GIS data tools.

From the `gis/` directory, run:

```bash
python -m marga_gis.msl fetch
python -m marga_gis.msl build
```

The workflow retrieves CheMin mineral-abundance tables from the NASA PDS Geosciences Node and Navcam frames from NASA's MSL raw-image API.

The generated files include:

```text
frontend/public/science/chemin_samples.json
frontend/public/rover/
```

Download requests are recorded in:

`data/msl/manifest.json`

For details about the data sources, processing method and known limitations, see:

`docs/data_sources.md`


## Science Target Locations

The catalogue includes Curiosity-visited locations using recorded rover positions associated with named drill sites and stops.

According to the project data notes, these locations agree with the DEM within 15 m.

Each target should retain its source information so that users can trace it back to the relevant rover waypoint or observation.

**Northern Rim Approach** is a planning placeholder. The actual crater rim lies outside the current terrain model and should not be interpreted as a verified, reachable destination.


## Verification and Build

The repository includes separate checks for the frontend, routing engine and GIS data workflows.

### Frontend production build

```bash
cd frontend
npm run build
```

This runs the type-check and production build, with output written to `frontend/dist`.

### TypeScript engine tests

```bash
cd ../engine/ts
npm install
npm test
```

The project currently reports 25 TypeScript engine tests.

### Python reference engine tests

On Windows:

```bash
cd ../
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m pytest -q
```

On macOS/Linux, use the corresponding `.venv/bin/` executables.

The project currently reports 115 Python reference-engine tests.

### GIS and data-processing tests

From the repository root, after setting up the Python environment:

```bash
cd gis
..\engine\.venv\Scripts\python -m pytest -q tests
```

The project currently reports 52 GIS, Mars Trek and Curiosity data tests, designed to run without network access.

Test counts describe the repository's reported test suite; they do not by themselves establish scientific or operational validation of the terrain data. We did most of the test using Super Intelligence [The testing data is generated and testing is doen using SI]


## License, Citations and Disclaimer

### Open-Source Licensing
MARGA original work is released under the OSI-compliant **[Apache License, Version 2.0](./LICENSE)**.

### Third-Party Materials & Data Citations
Detailed licensing, credits, and citations for third-party open-source libraries and NASA Planetary Data System (PDS) datasets used in this project are documented in **[THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)**.

### Disclaimer
MARGA is a research and decision-support prototype built using historical NASA mission data and project-prepared terrain products.

The application provides route estimates based on the available terrain model and configured assumptions. These routes do not guarantee safe traversal and do not represent certified astronaut mobility parameters.

The Gale Crater elevation model is currently marked as unvalidated. Users should treat its route outputs as experimental until the data and calculations have been independently checked.

MARGA is intended to demonstrate how scientific observations, planetary mapping and terrain-aware route planning can be brought together in one application.
