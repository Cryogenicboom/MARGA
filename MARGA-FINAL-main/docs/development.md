# MARGA — Development & Integration Guide

## Prerequisites
- **Node.js**: v22.18 or higher (v24.x tested; the engine tests run `.ts` files directly)
- **NPM**: v9.0.0 or higher
- **Python**: v3.10+ (for backend core engine development)

---

## Repository Structure Overview

```
MARGA/
├── frontend/             # React + TypeScript + OpenLayers UI (Person 1)
├── engine/               # Python / Core Route & Mission Engine (Person 2)
├── science_data/         # Verified NASA Data & GeoJSON Catalogue (Person 3)
├── test_data/            # Synthetic Rasters & Verification Datasets (Person 4)
├── shared/               # Shared TypeScript Types & JSON Schemas
├── docs/                 # System Architecture & Documentation
└── README.md
```

---

## Getting Started (Frontend Development)

On Windows you can simply double-click `Start MARGA.bat` in the repository root: it finds Node.js,
installs the frontend packages on first run and starts the dev server. The manual steps are:

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start local development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

4. Build for production and verify type checks:
   ```bash
   npm run build
   ```

---

## Core Engine (routing, terrain cost, EVA budget)

`npm run dev` already routes with the real engine: `frontend/src/services/routeService.ts` runs
`shared/engine` (TypeScript A*) in a Web Worker on the offline terrain package in
`frontend/public/terrain/gale/`. Nothing else needs to be running.

All commands from the repository root:

```bash
# Python reference engine + tests
pip install -r engine/requirements.txt
(cd engine && python -m pytest -q)                    # 115 tests
(cd engine && python -m marga_engine route examples/request.json -o out.json)

# TypeScript engine tests (unit + parity with the Python engine)
(cd engine/ts && npm install && npm test)             # 25 tests

# Rebuild the demo terrain package (SYNTHETIC, anchored to the target elevations)
python engine/tools/make_synthetic_demo.py
# ...or replace it with the real Mars Trek Gale DEM (~16 MB download, networked machine)
python engine/tools/fetch_gale_dem.py
python engine/tools/check_terrain.py                  # coverage, fill values, catalogue elevations

# Optional: serve the Python engine and point the frontend at it
(cd engine && python -m marga_engine serve --port 8000)
# frontend/.env:  VITE_ENGINE_API_URL=http://localhost:8000
```

If `VITE_ENGINE_API_URL` is set but the service does not answer, the frontend falls back to the
offline engine and retries the service after a minute. See `engine/README.md` and
`docs/engine_algorithms.md`.

---

## Coding Conventions
- **Strict TypeScript**: Avoid `any`. Use shared interfaces from `@shared/types`.
- **Modular Components**: Keep React components single-purpose under `src/components/`.
- **Coordinate Order**: GeoJSON array order is `[longitude, latitude]`. Standard display is `Latitude°N, Longitude°E`.
- **Styling**: Tailwind utility classes with Orbitron (headlines) and Space Mono / Rajdhani fonts.
