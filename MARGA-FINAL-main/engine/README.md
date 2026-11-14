# MARGA Core Engine

Deterministic terrain-aware A* routing, terrain-cost calculation and EVA time-budget logic for MARGA
(Person 2 — Core Engine & Technical Lead). All formulas and their justification:
[`docs/engine_algorithms.md`](../docs/engine_algorithms.md).

- **Input / output:** `RouteRequest` → `RouteResponse` from `shared/types/index.ts`, unchanged. Extra
  information (EVA assessment, radiation, recalculated return route, alternatives, mission summary,
  provenance) is in additive optional fields declared in `shared/types/engine.ts`.
- **Two identical implementations:**
  - Python (`engine/marga_engine/`) — reference, data preparation, optional HTTP service.
  - TypeScript (`shared/engine/`) — what the frontend runs, offline, in a Web Worker. It lives under
    `shared/` so the frontend imports it through the existing `@shared` alias with no build-config change.
  The TS port reproduces the Python golden cases with identical paths on a fixed synthetic test fixture
  (`test_data/terrain/gale_synthetic_50m`), so the app's own terrain package can be swapped freely.
- **No ML, no LLM, no network at runtime.** Only `numpy` for the Python core.

## Layout

```
engine/
├── marga_engine/
│   ├── geodesy.py          Mars sphere, haversine, longitude conventions
│   ├── config.py           every tunable parameter, documented
│   ├── contracts.py        RouteRequest parsing / validation, target catalogue
│   ├── terrain/            grid + provenance, Horn slope, roughness, int16/float32 packages, GeoTIFF import, synthetic terrain
│   ├── routing/            edge costs, A*, Dijkstra field, string pulling, planner (cached traversability), route profile
│   ├── eva/                walking-speed model, EVA budget + return margin, radiation estimate
│   ├── service.py          plan_route() (incl. mission_summary), assess_return()
│   ├── api.py              optional FastAPI service (VITE_ENGINE_API_URL, port 8000)
│   └── cli.py              python -m marga_engine ...
├── examples/               request.json, request_waypoints.json (ready-to-run RouteRequests)
├── tools/
│   ├── make_synthetic_demo.py     builds frontend/public/terrain/gale (SYNTHETIC, anchored to the target catalogue)
│   ├── fetch_gale_dem.py          real Mars Trek Gale DEM -> frontend/public/terrain/gale
│   ├── check_terrain.py           coverage, fill values, slopes, DEM vs catalogue elevations
│   ├── build_terrain_package.py   any DEM GeoTIFF -> package, with explicit provenance
│   └── export_golden_vectors.py   Python results the TS port must reproduce
├── tests/                  pytest suite (115 tests)
└── ts/                     node:test suite for shared/engine (unit + 13 golden parity cases)

shared/engine/              TypeScript engine (imported by the frontend as @shared/engine/index.ts)
frontend/public/terrain/gale/   terrain.json + elevation.i16, served statically, cached by the browser
frontend/src/services/      routeService.ts (unchanged exports), engine.worker.ts, engineHost.ts
```

## How the frontend uses it

`App.tsx` still calls `calculateRoute(request)` from `frontend/src/services/routeService.ts`, with the same
signature and the same `RouteResponse` fields. Behind it:

1. `VITE_ENGINE_API_URL` set and `GET /api/health` answers within 1.5 s → `POST /api/route` on the Python engine.
2. Otherwise (the default) → `shared/engine` in a Web Worker on `public/terrain/gale/`. The package is
   fetched once (1.8 MB) and kept in memory with its derived layers; later requests only run the searches.
3. If a worker cannot start → the same engine on the main thread (loaded lazily as its own chunk).

A service failure is remembered for a minute so the UI never waits on a dead server twice in a row. A
missing terrain package gives a `status: "failed"` response with an explanation, never an exception.

What the panels now show compared with the old placeholder maths:

- `return_margin_min` $= T_\text{EVA} - (T_\text{out} + T_\text{science} + T_\text{return} + T_\text{reserve})$ with a
  separately searched return route (the placeholder used `EVA − 2 × outbound`).
- `eva_budget_used_percent` counts outbound + science + return against EVA minus reserve (capped at 999).
- Elevation profiles start and end at the catalogue `elevation_m` of the selected targets.
- `segments[].terrain_type` describes slope only (e.g. "Moderate terrain (mean 7.2°, max 13.8° terrain slope)").
- A reserve at least as long as the EVA (possible with the sliders) still draws the route and reports
  `unreachable` / `eva_budget_exceeded` with a clear warning instead of failing.
- Every response on synthetic terrain starts its `warnings` with `SYNTHETIC TEST TERRAIN`.

## Quick start (Python)

```bash
cd engine
pip install -r requirements.txt
python -m pytest -q                                  # 115 tests
python -m marga_engine route examples/request.json -o out.json   # one-line summary + full JSON in out.json
python -m marga_engine dose 240                      # 4 h EVA -> 0.1117 mSv (historical RAD baseline)
python -m marga_engine serve --port 8000             # optional API for VITE_ENGINE_API_URL
```

The route uses `frontend/public/terrain/gale` and the `science_data` catalogue (for `target_ids`). Exit code 0 means
calculated/warning, 2 means unreachable or failed. `examples/request.json` is a plain `RouteRequest` (optionally with
`objective`, `habitat`, `options`); the Murray Buttes example is deliberately over the 8 h budget at 1.2 km/h:

```json
{
  "start": {"latitude": -4.5895, "longitude": 137.4417, "name": "Bradbury Landing Site"},
  "destination": {"latitude": -4.6942, "longitude": 137.3531, "name": "Murray Buttes"},
  "constraints": {"walkingSpeedKmh": 1.2, "maxSlopeDegrees": 15, "maxEvaHours": 8,
                  "reserveEvaHours": 1.5, "maxDistanceMeters": 10000, "scienceTimeMinPerStop": 30},
  "objective": {"id": "obj_sedimentary_strata", "title": "Examine Sedimentary Stratigraphy"},
  "options": {"metric": "terrain"}
}
```

```python
from marga_engine import plan_route, load_package
terrain = load_package("../frontend/public/terrain/gale")
route = plan_route(request_dict, terrain)          # dict shaped like EngineRouteResponse
```

### HTTP API (optional)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | engine version, loaded terrain (with `synthetic` flag), targets loaded |
| GET | `/api/terrain` | – | package geometry, bounds, provenance |
| POST | `/api/route` | `RouteRequest` (+ extensions) | `RouteResponse` (+ extensions); failures are still `RouteResponse` with `status: "failed"` |
| POST | `/api/eva/return` | `ReturnCheckRequest` | fresh return route + margin from the current position |
| POST | `/api/radiation` | `{duration_min, rate_msv_per_day?}` | dose estimate with source and disclaimers |

Environment: `MARGA_TERRAIN` (package dir, default `frontend/public/terrain/gale`), `MARGA_TARGETS`
(ScienceTarget JSON to resolve `target_ids`, default `science_data/catalogue/gale_crater_targets.json`),
`MARGA_CORS` (extra allowed origins; any `localhost` / `127.0.0.1` port is always allowed, so both
`npm run dev` and `vite preview` work).

## Quick start (TypeScript)

```bash
cd engine/ts
npm install
npm test            # 25 tests: unit + 13 golden parity cases against the Python engine (on the test fixture)
npm run typecheck
```

```ts
import { fetchTerrainPackage, planRoute } from '@shared/engine/index.ts';
const terrain = await fetchTerrainPackage('/terrain/gale/');   // terrain.json + elevation.i16
const route = planRoute(request, terrain);                     // RouteRequest -> EngineRouteResponse
```

After changing the Python engine, regenerate the golden cases and rerun both suites (the parity test also tells
you when the fixture changed without regenerating):

```bash
python tools/export_golden_vectors.py && python -m pytest -q && (cd ts && npm test)
```

## Terrain data

`frontend/public/terrain/gale/` now holds the **real** Mars Trek Gale DEM package (~20 m, `status: unvalidated`,
float32), built by `tools/fetch_gale_dem.py`. The synthetic demo package it replaced is kept in
`data/terrain_backup/gale_synthetic_demo/` and can be rebuilt with `tools/make_synthetic_demo.py`, which writes a
**synthetic** package (labelled in every response) on the region's 25 m grid. Its surface passes exactly through the `elevation_m` of
every target in `science_data/catalogue/` and `frontend/src/services/mockData.ts`; all other relief is
invented to exercise the router (a ridge with one breach, buttes, a north-east scarp with one ramp, two
no-data holes). For real terrain, on a networked machine:

```bash
python tools/fetch_gale_dem.py
python tools/check_terrain.py        # then check it (spec 9.3)
# -> frontend/public/terrain/gale (Mars Trek Gale_DEM_SMG_1m export at ~20 m, status: unvalidated)
```

`check_terrain.py` prints coverage, the elevation range, slope statistics and the DEM elevation at every science
target beside its catalogue value. It also catches a DEM whose uncovered area was filled with a constant
(e.g. 0) instead of being marked as no-data: such a file looks "100 % valid" but has cliffs at the fill edge.
Rebuild with `--nodata <value>` (both `fetch_gale_dem.py` and `build_terrain_package.py` accept it) to mask it.

Any other DEM GeoTIFF (geographic or equirectangular) goes through `tools/build_terrain_package.py` with
explicit provenance arguments. Packages are written as int16 (≤ 2 cm error, half the size of float32)
whenever the elevation range allows. Raw downloads stay out of git (`data/raw/`).
