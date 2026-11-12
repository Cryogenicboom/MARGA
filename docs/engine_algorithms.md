# MARGA Core Engine — Algorithms and Formulations

**Owner:** Person 2 — Core Engine & Technical Lead
**Code:** `engine/marga_engine` (Python reference, data preparation, optional API) and `shared/engine` (TypeScript port the frontend runs offline in a Web Worker; tests in `engine/ts`)
**Contract:** `shared/types/index.ts` (unchanged) + additive extensions in `shared/types/engine.ts`
**Status:** v1.0 prototype. Every number below is a planning estimate, not a certified safety or mobility limit.

The engine is deterministic: the same request on the same terrain package and engine version always returns the same route, numbers and `route_id`. It contains no trained model, needs no network and no server, and never fabricates terrain data.

---

## 1. Coordinates and geodesy

| Item | Convention |
|---|---|
| Latitude | Planetocentric degrees, −90…+90 |
| Longitude | East-positive degrees; input may be 0…360 or −180…180, normalised to [−180, 180) |
| GeoJSON order | `[longitude, latitude]` |
| Reference body | Mars 2000 sphere, R = 3 396 190 m (Mars Trek datum; also used by the frontend). A terrain package may declare its own radius, which then wins. |

Great-circle distance (haversine):

$$a = \sin^2\frac{\Delta\varphi}{2} + \cos\varphi_1\cos\varphi_2\sin^2\frac{\Delta\lambda}{2},\qquad d = 2R\,\arcsin\sqrt{a}$$

Longitude differences always go through a wrapped difference, so a region crossing 180° still works.

**Grid geometry.** Terrain is a regular latitude/longitude grid, row 0 = north, with cell-centre registration. True ground spacing:

$$d_y = R\,\Delta\varphi,\qquad d_x(\text{row}) = R\cos\varphi_\text{row}\,\Delta\lambda$$

`dx` is evaluated per row, so slopes and distances stay in true metres across the grid.

## 2. Terrain packages and data rules

A regional package is `terrain.json` (geometry, provenance, SHA-256 checksums) + one elevation layer, optionally a roughness layer. The same files load in Python and in the browser; the frontend serves the package from `frontend/public/terrain/gale/`.

| Layer encoding | File | Decoding | Use |
|---|---|---|---|
| `int16` (default) | `elevation.i16` | $z = \text{offset} + \text{scale}\cdot q$, $q = -32768 \Rightarrow$ no data | half the bytes of float32; the quantisation step is chosen so the error is ≤ 2 cm (`scale` ≤ 0.04 m) |
| `float32` | `elevation.f32` | IEEE float, NaN = no data | fallback when the elevation range does not fit int16 at 2 cm |

int16 is used by `save_package()` whenever the step $(z_\max - z_\min)/65000$ keeps the rounding error (half a step) within 2 cm, i.e. for any elevation range up to 2.6 km; otherwise it writes float32. The Gale box (−5093 … −3296 m) quantises in 2.8 cm steps with a measured maximum error of 1.4 cm — far below the vertical accuracy of any orbital DEM — and the 949 × 946 package shrinks from 3.6 MB to 1.8 MB, which matters for the offline browser download. Horn slopes computed from the decoded grid differ from the float32 grid by at most 0.044° (99.9th percentile 0.024°).

**Bundled demo package.** `engine/tools/make_synthetic_demo.py` builds a labelled SYNTHETIC package on the region's own 25 m grid (`GALE_CRATER_METADATA.resolution_m_per_pixel`). Its surface is a thin-plate spline through the `elevation_m` of every science target in `science_data/catalogue/*.json` and `frontend/src/services/mockData.ts` (8 unique locations) plus hand-built relief (an E–W ridge with one breach, three buttes, a north-east scarp with one graded ramp, two no-data holes). The spline interpolates the anchors exactly, so the elevation profile between two targets starts and ends at the catalogue elevations the UI lists.

**Checking a real package.** `engine/tools/check_terrain.py` reports coverage, elevation range, slopes and DEM-vs-catalogue elevation at every target, and flags undeclared fill values: one exact value on ≥ 0.5 % of cells, exact zeros where the median is far from 0, or ≥ 2 % perfectly flat cells. A fill value marked with `--nodata` becomes no-data, which the router never treats as flat.

Rules the engine enforces:

- **No-data is never flat.** A NaN elevation makes that cell, and every cell whose 3×3 window touches it, *unknown*.
- **No upsampling.** `import_geotiff(decimate=k)` only makes grids coarser (k×k block mean); a block containing any no-data stays no-data.
- **Provenance travels with every route.** `terrain_source` in each response carries dataset id, mission, instrument, source, CRS, resolution, status and limitations.
- **Synthetic data is always labelled.** Packages built by `terrain/synthetic.py` set `synthetic: true`; every response then starts its warnings with `SYNTHETIC TEST TERRAIN`.
- **Coarse DEMs are flagged.** Grid spacing above 100 m produces a warning that the DEM is not an obstacle map.

`engine/tools/fetch_gale_dem.py` downloads the Gale DEM export that the baseline app already used (Mars Trek `Gale_DEM_SMG_1m`, ~20 m) and packages it clipped to the MARGA Gale box (lat −4.85…−4.45, lon 137.20…137.60). Its status is `unvalidated` until the data team completes the spec 9.3 checks.

## 3. Terrain derivatives

### 3.1 Slope (Horn 1981, as in `gdaldem slope`)

For the 3×3 window

```
a b c
d e f      (row above = north)
g h i
```

$$\frac{\partial z}{\partial x} = \frac{(c+2f+i)-(a+2d+g)}{8\,d_x},\qquad
\frac{\partial z}{\partial y} = \frac{(a+2b+c)-(g+2h+i)}{8\,d_y},\qquad
S = \arctan\sqrt{\left(\tfrac{\partial z}{\partial x}\right)^2+\left(\tfrac{\partial z}{\partial y}\right)^2}$$

At the outer edge the DEM is extended by odd reflection, $z_{-1} = 2z_0 - z_1$, which is exact for planar ground (plain edge replication would halve edge slopes). Verified: planes of 0–30° at any azimuth give the exact slope at every cell, edges included (error < 0.002°, float32 storage).

### 3.2 Roughness (only when the DEM can support it)

Detrended residual RMS: fit the least-squares plane through the 3×3 window and take the RMS of the nine residuals. A perfect slope has zero roughness, so this does not double-count steepness.

$$g_x = \frac{(c+f+i)-(a+d+g)}{6d_x},\quad g_y = \frac{(a+b+c)-(g+h+i)}{6d_y},\quad r = \sqrt{\tfrac19\sum_k\big(z_k - (\bar z + g_x x_k + g_y y_k)\big)^2}$$

Used only if the grid spacing is ≤ 30 m (`roughness_max_cell_m`) or the package supplies an external roughness layer. Otherwise the term is **omitted**, and the response says so (`engine.cost_model.roughness`).

## 4. Traversability

| Cell state | Definition | `exclude` policy (default) | `penalize` policy |
|---|---|---|---|
| known | elevation and slope defined | traversable if S ≤ S_max | same |
| prohibited | known and S > S_max (`maxSlopeDegrees`) | blocked | blocked |
| unknown | no elevation or slope | blocked | traversable, worst-case penalties |

S_max is a simulation parameter, not an astronaut-certified mobility threshold.

## 5. Graph and edge costs

Nodes are cells; each connects to its 8 neighbours. Edge costs are evaluated **lazily** when A* relaxes an edge (`EdgeModel` in the TypeScript port): per-cell penalty factors $F = 1 + w_s P_s + w_r P_r + w_u P_u$ and per-row edge lengths are precomputed once per search surface, and an edge costs two array reads and a multiply. A search therefore touches only the edges around the nodes it actually expands, instead of materialising 8 cost arrays for the whole window (≈ 8 × 300 000 doubles = 19 MB per search at the window limit). The test suite checks that the lazy model and the full tensor agree to $10^{-12}$ on every edge for all three metrics.

Edge length:

$$L = d_x(\text{row})\ \text{(E–W)},\quad L = d_y\ \text{(N–S)},\quad L = \sqrt{d_y^2 + \bar d_x^2}\ \text{(diagonal, mean } d_x \text{ of both rows)}$$

**No corner cutting:** a diagonal edge exists only if both cells it squeezes between are traversable.

Three cost metrics:

| Metric | Edge cost | Use |
|---|---|---|
| `terrain` (default) | $C = L\,(1 + w_s\bar P_s + w_r\bar P_r + w_u\bar P_u)$ | terrain-aware route |
| `distance` | $C = L$ | shortest route that still avoids prohibited ground |
| `time` | $C = L / v(g)$ minutes, $g = (z_v - z_u)/L$ | fastest walk under the mobility model |

Penalties are per cell and averaged over the edge's two cells (half the edge lies in each):

$$P_s = \left(\frac{S}{S_\max}\right)^{p},\qquad P_r = \min\!\left(1,\frac{r}{r_\text{ref}}\right),\qquad P_u = \begin{cases}1 & \text{unknown}\\0 & \text{known}\end{cases}$$

Unknown cells (penalize policy) also take $P_s = 1$ and, when roughness is in use, $P_r = 1$ — missing data costs at least as much as the steepest allowed ground. In the time metric an edge touching unknown ground uses $g = +\tan S_\max$, the slowest allowed climb.

Defaults: $w_s = 4$, $p = 2$, $w_r = 1$, $r_\text{ref} = 2$ m, $w_u = 2$. So ground at the slope limit costs 5× flat ground per metre; ground at half the limit costs 2×.

*Worked example:* a 20 m east–west step between two cells of 7.5° with S_max = 15°: $P_s = 0.25$, $C = 20\,(1 + 4\cdot0.25) = 40$.

## 6. A* search

$$f(n) = g(n) + h(n)$$

$g$ is the accumulated edge cost. $h$ is an anisotropic **octile** distance to the goal times the smallest possible cost per metre $\kappa$:

$$a = |\Delta\text{col}|,\ b = |\Delta\text{row}|,\quad
\text{oct} = \begin{cases} b\sqrt{d_y^2+d_{x,\min}^2} + (a-b)\,d_{x,\min} & a \ge b\\ a\sqrt{d_y^2+d_{x,\min}^2} + (b-a)\,d_y & a < b\end{cases},\quad h = \kappa\cdot\text{oct}$$

$\kappa = 1$ for `distance` and `terrain` (all penalties ≥ 0); $\kappa = 1/v_\max$ for `time`.

**Why it is admissible and consistent.** Octile distance is the exact shortest path on an unobstructed 8-connected lattice with step lengths $(d_{x,\min}, d_y, \sqrt{d_y^2+d_{x,\min}^2})$, so it obeys the triangle inequality. Every real edge is at least as long as the corresponding octile step ($d_x \ge d_{x,\min}$) and costs at least $\kappa$ per metre, so $h(u) \le C(u,v) + h(v)$ on every edge. The first time the goal is popped, its cost is optimal, and each node is expanded at most once. The test suite checks $h(u) \le C(u,v) + h(v)$ on every edge of random grids and that A* cost equals an exhaustive Dijkstra cost for all three metrics.

**Determinism.** Heap entries are `(f, h, insertion counter, node)`: ties prefer nodes nearer the goal, then earlier insertion. In the TypeScript port the heap is four parallel typed arrays (`Float64Array` f, h, counter; `Int32Array` node) with no per-entry objects, so a search allocates O(1) objects and the garbage collector stays idle.

**Dijkstra field.** `dijkstra_field(reverse=True)` gives the cost from every cell *to* a source (using the opposite edge, which matters for the direction-dependent time metric) — the return-to-habitat field for future isochrone views.

## 7. Connectivity and endpoint snapping

With the no-corner-cutting rule, any diagonal move can be replaced by two orthogonal moves through traversable cells, so 8-connectivity equals **4-connectivity**. The planner labels 4-connected components once (run-length union-find, O(number of row runs)).

- Two points in different components are reported `no_traversable_path` immediately, with no search.
- The traversable mask and its component labels depend only on the terrain, the slope limit and the unknown-data policy, so they are **cached on the terrain grid** (keyed by `maxSlope|policy`, up to 8 entries; `WeakMap`/`WeakKeyDictionary`, freed with the grid). Every leg, the return leg and both alternatives of a request — and every later request with the same constraints — reuse them.
- If a start or target sits on prohibited or unknown ground, it moves to the nearest traversable cell within 150 m (`endpoint_snap_m`) **that shares a component with the other end**, so it can never snap into an isolated pocket (for example a mesa top). The move is reported as a warning and in `segments[].end_snapped_m`. Nothing within 150 m → `start_not_traversable` / `destination_not_traversable`.

## 8. Search windows and coarse-to-fine refinement

1. Search the bounding box of the two endpoints padded by max(0.35 L, 600 m). If no path exists inside, widen ×2.5 until the whole package is covered — a window can never hide a valid route.
2. Windows ≤ 300 000 cells (`max_search_cells`) are searched directly on native cells.
3. Larger windows first run A* on a k×k block **relaxation**: a block is traversable if *any* of its cells is, with penalty fields averaged over those cells. If a native path exists, the blocks it crosses form a valid coarse path (also under the corner rule, since the orthogonal cells it needs live in the side blocks), so **no coarse path proves no native path**.
4. The coarse path is dilated into a corridor (3 blocks each side, doubling up to 3 times) and A* is re-run on native cells inside it. If every corridor fails, the whole window is searched natively.

The returned route is always computed at the DEM's own resolution and never touches a prohibited native cell. Corridor refinement is optimal within the corridor; on the test terrain it matched the full native search exactly.

Measured on a 1186 × 1183-cell, 20 m grid (the size of the real Gale package): an 11 km leg with return route and alternatives takes ~0.5 s in Python and ~0.35 s in the TypeScript port.

Measured with the TypeScript port in Node 22 on the bundled 949 × 946-cell, 25 m package (outbound + recalculated return + both alternatives; first call includes the one-off slope and component labelling):

| Request (from Bradbury Landing) | Route | Time |
|---|---|---|
| Yellowknife Bay (app default) | 383 m, `calculated` | 1–3 ms (≈ 200 ms on the very first call) |
| RAD Station Alpha | 1.5 km, `calculated` | 3–11 ms |
| Murray Buttes | 5.3 km, `unreachable` (EVA budget) | 35–60 ms |
| Sulfate-bearing strata | 11.2 km, `unreachable` (EVA budget) | 70–180 ms |
| Northern Rim Fault | none at 15° (separate traversable area); 6.0 km at 20° via the scarp ramp | 80–190 ms |

Package download and decode: 1.8 MB, ~25 ms to decode. The frontend runs all of this in a Web Worker, so the map and panels never block.

## 9. Straightening (string pulling)

8-connected paths turn only in 45° steps and can be up to ~8% longer than the real walk. After A*, each vertex is joined to the farthest later vertex that a straight line reaches when:

1. every cell the line touches is traversable — exact supercover traversal (Amanatides & Woo 1987); a line through a cell corner must clear both side cells, and
2. the straight line costs no more than the grid path it replaces (same metric, same cell penalties, each piece of line charged to the cell it lies in).

Straightening therefore never increases route cost and never enters prohibited ground. On open ground the route becomes the exact great-circle line.

## 10. Route profile and statistics

The final polyline is resampled every DEM cell (finer sampling would invent detail). For step $i$ with horizontal length $\ell_i$ (haversine) and elevation $z_i$ (bilinear, never across a gap):

| Quantity | Formula |
|---|---|
| 2D distance | $\sum \ell_i$ |
| 3D distance | $\sum\sqrt{\ell_i^2 + \Delta z_i^2}$ |
| Elevation gain / loss | $\sum\max(\Delta z_i,0)$ / $\sum\max(-\Delta z_i,0)$ |
| Grade | $g_i = \Delta z_i/\ell_i$ (signed, direction of travel) |
| `ElevationPoint.slope_deg` | along-track slope $\arctan|g_i|$ |
| `terrain_slope_deg` (extension) | Horn slope at the sample, includes cross-slope |
| Travel time | $\sum \ell_i / v(g_i)$ |

`TerrainSummary` classes use the Horn terrain slope (a sidehill traverse on a 20° slope is hazardous even when the along-track slope is zero); each step takes the class of its steeper end. Bins match `shared/types`: flat < 5°, moderate 5–12°, steep 12–20°, hazardous ≥ 20°, plus `unknown_pct`. The five percentages are rounded with the largest-remainder method so they add to exactly 100.

Where the DEM has no data (penalize policy only) the elevation is linearly interpolated along the route, the point is flagged `data_quality: "interpolated"`, the step time assumes the slowest allowed climb, and a warning states the uncertain length.

## 11. Walking-speed model

Tobler's hiking function (Tobler 1993) shape, scaled so level walking gives exactly the configured `walkingSpeedKmh`:

$$v(g) = v_\text{flat}\,\exp\!\big(-k\,(|g + g_0| - g_0)\big),\qquad k = 3.5,\ g_0 = 0.05$$

| Slope along travel | −15° | −10° | −5° | −2.9° | 0° | +5° | +10° | +15° | +20° |
|---|---|---|---|---|---|---|---|---|---|
| v / v_flat | 0.556 | 0.766 | 1.045 | 1.191 (max) | 1.000 | 0.736 | 0.539 | 0.391 | 0.280 |
| min per km at v_flat = 1.2 km/h | 90.0 | 65.3 | 47.9 | 42.0 | 50.0 | 67.9 | 92.7 | 127.7 | 178.7 |

Time uses horizontal distance, as in standard GIS use of Tobler's function. Because uphill and downhill differ, outbound and return times differ on sloping ground. This is a simulation assumption, not a validated model of suited astronaut mobility.

## 12. EVA time budget and return margin

The return leg is **always a new A* search from the turnaround point to the habitat** (default habitat = start; `habitat` may name another shelter). It is never the outbound path reversed.

$$T_\text{mission} = T_\text{out} + T_\text{science} + T_\text{return} + T_\text{reserve}\ \le\ T_\text{EVA}$$

$$M = T_\text{remaining} - T_\text{return} - T_\text{reserve},\qquad T_\text{remaining} = T_\text{EVA} - (T_\text{out} + T_\text{science})\ \Rightarrow\ M = T_\text{EVA} - T_\text{mission}$$

| M | Status | Route status |
|---|---|---|
| > 0 | `within_budget` | `calculated` (or `warning` if other advisories) |
| \|M\| < 0.5 min | `no_slack` | `warning` |
| < 0 | `exceeded` | `unreachable`, `status_reason: eva_budget_exceeded` (route still returned) |

Derived numbers in `eva_assessment`:

- maximum science time $= T_\text{EVA} - T_\text{out} - T_\text{return} - T_\text{reserve}$
- latest turnaround (elapsed) $= T_\text{EVA} - T_\text{reserve} - T_\text{return}$
- budget used $= (T_\text{out} + T_\text{science} + T_\text{return}) / \max(T_\text{EVA} - T_\text{reserve}, 0) \times 100$, capped at 999 %

**Reserve not shorter than the EVA.** The constraints panel allows a reserve of up to 4 h with an EVA as short as 2 h. That is a planning outcome, not an invalid request: the route is still searched and drawn, the usable time is 0, the budget reads 999 % (0 % if nothing is walked), M is negative, the status is `unreachable` with `status_reason: eva_budget_exceeded`, and the warning says "The safety reserve (X h) is not shorter than the EVA (Y h): no time is left for the excursion." Only negative or > 24 h values are rejected.

$T_\text{science}$ = `scienceTimeMinPerStop` × (waypoints + destination). If it is not configured it is 0 and the response says so in `assumptions`.

**Field check** (`POST /api/eva/return`, `assessReturn()`): from the current position and elapsed time, a fresh return search gives $M = (T_\text{EVA} - T_\text{elapsed}) - T_\text{return} - T_\text{reserve}$, i.e. how many minutes remain before the return must start.

Integer contract fields round conservatively: durations up (ceil), the return margin down (floor). Exact values (0.1 min) are in `eva_assessment`.

**Mission summary** (spec FR-11). Every planned route carries `mission_summary`: site and terrain dataset, scientific objective (echoed from the optional request field `objective: {id, title}`), targets in visiting order, start and habitat, route status, total distance, travel / working / return time, return margin, terrain advisories (all warnings except the synthetic-data notice), the radiation estimate with its basis, dataset references (terrain plus the `source` of every catalogue target resolved through `target_ids`), and data limitations (dataset limitations + assumptions). It repeats numbers that are elsewhere in the response, rounded the same way, so a summary view never has to recompute them.

## 13. Radiation estimate

$$D = R\,t,\qquad t = \text{minutes}/1440$$

Default $R$ = 0.67 mSv/day dose equivalent: Curiosity RAD at Gale Crater, August 2012 – June 2013, as reported by NASA. Four-hour EVA: $D = 0.67 \times 4/24 = 0.1117$ mSv. The response gives the dose both for the planned activity ($T_\text{out} + T_\text{science} + T_\text{return}$) and for the full configured EVA. The rate can be overridden for simulation (`radiationRateMsvPerDay`); the override is flagged `user_modified`. Absorbed dose (µGy) is reported only if an absorbed-dose rate is supplied and is never converted to or from dose equivalent. This is a historical, linear estimate — not a forecast and not a certified exposure assessment.

## 14. Route alternatives

Each response includes (unless `compute_alternatives: false`):

- the selected route and the other of `distance` / `terrain` — distance, 3D distance, gain/loss, time, maximum terrain slope, cost, terrain fractions, coordinates;
- the **direct line** per leg — straight distance, maximum terrain slope crossed, and the exact length of prohibited and unknown ground it would cross (supercover), labelled "reference only, not a route".

Neither route is labelled safe.

## 15. Status and warnings

| status | When |
|---|---|
| `failed` | invalid request (`invalid_request`), point outside the package (`outside_terrain_coverage`), terrain package not loadable in the browser (`terrain_unavailable`), internal error |
| `unreachable` | no traversable path (`no_traversable_path`, `start_not_traversable`, `destination_not_traversable`, `return_*`) or EVA budget exceeded |
| `warning` | snapped endpoints, unknown ground crossed, ground ≥ 20° crossed, beyond `maxDistanceMeters`, coarse DEM, zero margin |
| `calculated` | none of the above (the synthetic-terrain notice is listed but does not change status) |

## 16. Default parameters

| Parameter | Default | Meaning |
|---|---|---|
| `weights.slope` w_s | 4 | cost multiplier added at the slope limit |
| `weights.slope_exponent` p | 2 | shape of the slope penalty |
| `weights.roughness` w_r | 1 | only with a roughness layer |
| `roughness_ref_m` | 2 m | residual RMS at which P_r = 1 |
| `roughness_max_cell_m` | 30 m | coarser DEMs: roughness omitted |
| `weights.uncertainty` w_u | 2 | penalize policy only |
| `unknown_policy` | exclude | no-data ground is blocked |
| `endpoint_snap_m` | 150 m | max endpoint move to traversable ground |
| `window_pad_fraction` / `window_pad_min_m` | 0.35 / 600 m | initial search window |
| `max_search_cells` | 300 000 | above this, coarse-to-fine |
| `refine_corridor_cells` | 3 | corridor half-width (coarse blocks) |
| `smoothing_tolerance` | 0 | straightened line may not cost more |
| Tobler k, g0 | 3.5, 0.05 | speed curve shape |
| dose rate | 0.67 mSv/day | Curiosity RAD, Aug 2012 – Jun 2013 |

All are in `engine/marga_engine/config.py` (Python) and `shared/engine/config.ts` (TypeScript); per-request overrides are in `RouteRequest.options` (see `shared/types/engine.ts`).

## 17. Verification

`engine/tests` (pytest, 115 tests) and `engine/ts/test` (node:test, 25 tests):

| Spec item | Covered by |
|---|---|
| 23.3 flat terrain, obstacle, steep region, missing data, no valid route, diagonals, return path | `test_routing.py`, `test_service.py` |
| 23.4 fits, insufficient return, zero / negative duration, changed reserve, reserve ≥ EVA | `test_eva.py`, `test_service.py` |
| 23.5 units, time conversion, baseline, period label, dose vs absorbed | `test_eva.py` |
| A* optimality and heuristic consistency | A* = Dijkstra on random grids for all metrics; per-edge consistency check |
| Contract conformance | every `RouteResponse` field parsed from `shared/types/index.ts` and checked; every extension field must be declared in `shared/types/engine.ts` |
| AC-07 – AC-12 | slope tests, routing tests, alternatives, prohibited-cell checks on every returned polyline, EVA and radiation tests |
| AC-14 offline | TypeScript port reproduces 13 Python golden cases (paths, numbers, integer profile, mission summary) on the int16 test fixture `test_data/terrain/gale_synthetic_50m` (checksum-pinned); a 280-request randomized sweep on the 25 m package also matched exactly |
| Optimisations | lazy edge model = full tensor on every edge; traversability cache identity; int16 round trip ≤ 2 cm; package half the float32 size |
| UI contract | profile `distance_m` / `elevation_m` are integers, as the original mock returned |

## 18. Known limitations

- Terrain is only as good as the DEM: features smaller than one cell (boulders, small scarps) are invisible to the router.
- The walking-speed model, slope limit and cost weights are unvalidated simulation parameters.
- Corridor refinement is optimal within its corridor, not provably optimal globally (identical on all test cases).
- Return time comes from the same terrain and mobility model; no fatigue, consumables or lighting model yet (spec 14.5).
- Radiation is a linear historical average; no solar particle events, shielding or location dependence.
- The bundled `frontend/public/terrain/gale` package is synthetic (anchored to the catalogue elevations, all other relief invented). Real routing needs a validated DEM package (`engine/tools/fetch_gale_dem.py`, then data-team validation).
- `route_id` is deterministic within each runtime but the Python service (SHA-256) and the browser engine (FNV-style hash) produce different ids for the same request.
