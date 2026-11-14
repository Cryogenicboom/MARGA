/**
 * MARGA core engine - in-browser / offline port.
 *
 * Same algorithms, formulas and response shape as the Python engine (engine/marga_engine), so the
 * static frontend can plan routes with no server and no network once a terrain package is cached.
 *
 *   import { fetchTerrainPackage, calculateRoute } from '@shared/engine/index.ts';
 *   const terrain = await fetchTerrainPackage('/terrain/gale/');      // terrain.json + elevation.i16
 *   const route = await calculateRoute(request, terrain);             // RouteRequest -> RouteResponse
 *
 * The frontend runs it in a Web Worker (frontend/src/services/engine.worker.ts) behind the unchanged
 * routeService.calculateRoute() signature.
 */
import type { RouteRequest } from '../types/index.ts';
import type { EngineRouteRequest, EngineRouteResponse } from '../types/engine.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { planRoute, type TargetLike } from './service.ts';
import type { TerrainGrid } from './terrain.ts';

export { DEFAULT_CONFIG, withOverrides } from './config.ts';
export type { EngineConfig } from './config.ts';
export { haversineM, normalizeLon, MARS_RADIUS_M } from './geodesy.ts';
export { MobilityModel, assessEva, estimateDose, referenceWithRate, returnMarginFrom } from './eva.ts';
export { TerrainGrid, GridGeometry, EngineError, decodeLayer, fetchTerrainPackage, terrainFromPackage, hornSlope, slopeClass } from './terrain.ts';
export type { TerrainPackageJson } from './terrain.ts';
export type { TargetLike } from './service.ts';
export { EdgeModel, RoutingContext, astar, dijkstraField, edgeCosts, supercover } from './routing.ts';
export { LegPlanner, buildProfile, connectedComponents, directLineStats, traversability } from './planner.ts';
export { planRoute, assessReturn, failedRouteResponse, routeIdFor, ENGINE_VERSION } from './service.ts';

/** Drop-in replacement for frontend/src/services/routeService.ts `calculateRoute`. */
export async function calculateRoute(request: RouteRequest | EngineRouteRequest, terrain: TerrainGrid,
                                     config: EngineConfig = DEFAULT_CONFIG, targets?: Map<string, TargetLike>): Promise<EngineRouteResponse> {
  return planRoute(request as EngineRouteRequest, terrain, config, targets);
}
