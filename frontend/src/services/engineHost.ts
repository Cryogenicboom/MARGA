/**
 * Runs the MARGA core engine (shared/engine) against the offline terrain package.
 *
 * Used inside the engine Web Worker (engine.worker.ts) and, if a worker cannot be started, lazily on
 * the main thread by routeService.ts. The terrain package is fetched once and kept in memory; the
 * engine caches its derived layers (slope, roughness, traversability, components) on the grid, so
 * every request after the first only pays for the A* searches.
 *
 * Two kinds of job:
 *   - 'route':   plan a route (RouteRequest -> EngineRouteResponse)
 *   - 'terrain': hand the map a copy of the elevation and slope grids, so it can draw the same
 *                terrain the router uses (shaded relief, slope-hazard overlay, cursor readout)
 */
import {
  DEFAULT_CONFIG,
  failedRouteResponse,
  fetchTerrainPackage,
  planRoute,
  type TargetLike,
  type TerrainGrid,
} from '@shared/engine/index.ts';
import type { EngineRouteRequest, EngineRouteResponse } from '@shared/types/engine';

/** Elevation and slope grids plus the geometry needed to place them on the map. */
export interface TerrainLayers {
  nrows: number;
  ncols: number;
  /** Centre of the first (north-west) cell. */
  northLat: number;
  westLon: number;
  dlatDeg: number;
  dlonDeg: number;
  /** Outer cell edges, i.e. the extent the raster covers. */
  bounds: { min_lat: number; max_lat: number; min_lon: number; max_lon: number };
  /** Metres, row-major, row 0 = north, NaN = no data. */
  elevation: Float32Array;
  /** Horn slope in degrees (what the router compares with maxSlopeDegrees), NaN = unknown. */
  slope: Float32Array;
  minElevation: number;
  maxElevation: number;
  cellSizeM: number;
  name: string;
  synthetic: boolean;
  /** Dataset status from the package, e.g. 'unvalidated', 'synthetic-fixture'. */
  status: string | null;
}

export type EngineJob =
  | { kind: 'route'; terrainUrl: string; request: EngineRouteRequest; targets: TargetLike[] }
  | { kind: 'terrain'; terrainUrl: string };

export type EngineJobResult =
  | { kind: 'route'; response: EngineRouteResponse }
  | { kind: 'terrain'; layers: TerrainLayers };

let terrainUrl: string | null = null;
let terrainPromise: Promise<TerrainGrid> | null = null;
let targetIndex: { key: string; map: Map<string, TargetLike> } | null = null;

/** Fetch (once) and decode the terrain package at `url` (terrain.json + elevation.i16/.f32). */
export function loadTerrain(url: string): Promise<TerrainGrid> {
  if (!terrainPromise || terrainUrl !== url) {
    terrainUrl = url;
    terrainPromise = fetchTerrainPackage(url).catch((e: unknown) => {
      terrainPromise = null; // let the next request retry (e.g. the dev server was restarting)
      throw e;
    });
  }
  return terrainPromise;
}

function targetsById(targets: TargetLike[]): Map<string, TargetLike> {
  const key = targets.map((t) => t.id).join('|');
  if (!targetIndex || targetIndex.key !== key) targetIndex = { key, map: new Map(targets.map((t) => [t.id, t])) };
  return targetIndex.map;
}

export async function planOnHost(
  url: string,
  request: EngineRouteRequest,
  targets: TargetLike[],
): Promise<EngineRouteResponse> {
  let terrain: TerrainGrid;
  try {
    terrain = await loadTerrain(url);
  } catch (e) {
    return failedRouteResponse(
      request.route_id ?? 'marga_route_unavailable',
      [
        `Terrain package could not be loaded from ${url} (${e instanceof Error ? e.message : String(e)}). ` +
          'Build it with `python engine/tools/make_synthetic_demo.py` (synthetic) or `python engine/tools/fetch_gale_dem.py` (real DEM).',
      ],
      'terrain_unavailable',
    );
  }
  return planRoute(request, terrain, DEFAULT_CONFIG, targetsById(targets));
}

/** Copies of the terrain grids for the map. Throws if the package cannot be loaded. */
export async function terrainLayersOnHost(url: string): Promise<TerrainLayers> {
  const terrain = await loadTerrain(url);
  const g = terrain.geometry;
  // Copies: the worker transfers these buffers away, and the engine keeps using its own arrays.
  const elevation = new Float32Array(terrain.elevation);
  const slope = new Float32Array(terrain.slopeDeg);
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (let i = 0; i < elevation.length; i++) {
    const z = elevation[i];
    if (Number.isFinite(z)) {
      if (z < minElevation) minElevation = z;
      if (z > maxElevation) maxElevation = z;
    }
  }
  return {
    nrows: g.nrows,
    ncols: g.ncols,
    northLat: g.northLat,
    westLon: g.westLon,
    dlatDeg: g.dlatDeg,
    dlonDeg: g.dlonDeg,
    bounds: g.bounds,
    elevation,
    slope,
    minElevation,
    maxElevation,
    cellSizeM: g.cellSizeM,
    name: terrain.metadata.name ?? 'Terrain package',
    synthetic: !!terrain.metadata.synthetic,
    status: terrain.metadata.status ?? null,
  };
}

export async function runJob(job: EngineJob): Promise<EngineJobResult> {
  if (job.kind === 'route') {
    return { kind: 'route', response: await planOnHost(job.terrainUrl, job.request, job.targets) };
  }
  return { kind: 'terrain', layers: await terrainLayersOnHost(job.terrainUrl) };
}
