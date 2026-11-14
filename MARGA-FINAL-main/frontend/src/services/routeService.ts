/**
 * Route service used by App.tsx. Same exports and signatures as before; the mock geometry has been
 * replaced by the MARGA core engine (shared/engine):
 *
 *   1. VITE_ENGINE_API_URL set and the Python engine answers  -> POST {url}/api/route
 *   2. otherwise (the default, works offline)                  -> shared/engine in a Web Worker,
 *      on the terrain package served from public/terrain/gale/
 *   3. if a worker cannot be started                          -> the same engine on the main thread
 *
 * All three return the same RouteResponse superset (EngineRouteResponse), so the panels and the map
 * read the same fields they always did.
 */
import type { RouteRequest, RouteResponse } from '@shared/types';
import type { EngineRouteRequest, EngineRouteResponse } from '@shared/types/engine';
import type { TargetLike } from '@shared/engine/index.ts';
import type { EngineWorkerReply, EngineWorkerRequest } from './engine.worker';
import type { EngineJob, EngineJobResult, TerrainLayers } from './engineHost';
import { MOCK_SCIENCE_TARGETS } from './mockData';

export type { TerrainLayers } from './engineHost';

const MARS_RADIUS_M = 3396190;

/**
 * Calculates Great Circle / Haversine distance on Mars sphere in meters
 */
export function calculateMarsDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return MARS_RADIUS_M * c;
}

// --- configuration -----------------------------------------------------------------------------

/** Offline terrain package (terrain.json + elevation.i16), served by Vite from public/. */
const TERRAIN_URL = (() => {
  const base = `${import.meta.env.BASE_URL}terrain/gale/`;
  // Absolute, because a worker resolves relative URLs against its own script location.
  return typeof location !== 'undefined' ? new URL(base, location.href).href : base;
})();

const REMOTE_URL = (import.meta.env.VITE_ENGINE_API_URL ?? '').trim().replace(/\/+$/, '');
const REMOTE_PROBE_TIMEOUT_MS = 1500;  // GET /api/health: decides quickly whether the service is up
const REMOTE_ROUTE_TIMEOUT_MS = 20000; // POST /api/route: long multi-leg plans can take a few seconds
const REMOTE_RETRY_AFTER_MS = 60000;   // after a failure, route locally for a minute before retrying

/** Catalogue handed to the engine so target_ids resolve and mission_summary can cite target sources. */
const TARGETS: TargetLike[] = MOCK_SCIENCE_TARGETS.map((t) => ({
  id: t.id,
  name: t.name,
  latitude: t.latitude,
  longitude: t.longitude,
  source: t.source,
}));

// --- optional Python engine service ------------------------------------------------------------

let remoteState: { up: boolean; checkedAt: number } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeRouteResponse(x: unknown): x is EngineRouteResponse {
  const r = x as Partial<EngineRouteResponse> | null;
  return !!r && typeof r === 'object' && typeof r.status === 'string' && Array.isArray(r.coordinates)
    && Array.isArray(r.elevation_profile) && Array.isArray(r.segments) && Array.isArray(r.warnings)
    && !!r.terrain_summary;
}

async function planRemote(request: EngineRouteRequest): Promise<EngineRouteResponse | null> {
  if (!REMOTE_URL) return null;
  const now = Date.now();
  if (remoteState && !remoteState.up && now - remoteState.checkedAt < REMOTE_RETRY_AFTER_MS) return null;
  try {
    if (!remoteState?.up) {
      const health = await fetchWithTimeout(`${REMOTE_URL}/api/health`, {}, REMOTE_PROBE_TIMEOUT_MS);
      if (!health.ok) throw new Error(`health check HTTP ${health.status}`);
    }
    const res = await fetchWithTimeout(
      `${REMOTE_URL}/api/route`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) },
      REMOTE_ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!looksLikeRouteResponse(body)) throw new Error('response is not a RouteResponse');
    remoteState = { up: true, checkedAt: now };
    return body;
  } catch (e) {
    remoteState = { up: false, checkedAt: now };
    console.warn(`[MARGA] engine service at ${REMOTE_URL} unavailable, using the offline engine:`, e);
    return null;
  }
}

// --- offline engine (Web Worker, main-thread fallback) -----------------------------------------

type Pending = { resolve: (r: EngineJobResult) => void; reject: (e: Error) => void };
let worker: Worker | null | undefined; // undefined: not started yet; null: unavailable
const pending = new Map<number, Pending>();
let nextId = 0;

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function engineWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('Web Workers are not available');
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<EngineWorkerReply>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    };
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      worker = null; // the script failed to load or crashed: stop using it
      w.terminate();
      failAll(new Error(e.message || 'engine worker failed'));
    };
    worker = w;
  } catch (e) {
    console.warn('[MARGA] engine worker could not be started, routing on the main thread:', e);
    worker = null;
  }
  return worker;
}

/** Run a job in the engine worker, or on the main thread if the worker is unavailable or crashed. */
async function runLocal(job: EngineJob): Promise<EngineJobResult> {
  const w = engineWorker();
  if (w) {
    try {
      return await new Promise<EngineJobResult>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        const msg: EngineWorkerRequest = { id, job };
        w.postMessage(msg);
      });
    } catch (e) {
      // Only a crashed/unloadable worker is worth retrying here; a job error would fail again.
      if (worker !== null) throw e;
      console.warn('[MARGA] engine worker failed, running on the main thread:', e);
    }
  }
  const { runJob } = await import('./engineHost');
  return runJob(job);
}

async function planLocal(request: EngineRouteRequest): Promise<EngineRouteResponse> {
  const result = await runLocal({ kind: 'route', terrainUrl: TERRAIN_URL, request, targets: TARGETS });
  if (result.kind !== 'route') throw new Error('engine returned the wrong result kind');
  return result.response;
}

let terrainLayersPromise: Promise<TerrainLayers> | null = null;

/**
 * Elevation and slope grids of the offline terrain package (the same grid the router uses), for the
 * map's shaded relief, slope-hazard overlay and cursor readout. Fetched once.
 */
export function loadTerrainLayers(): Promise<TerrainLayers> {
  if (!terrainLayersPromise) {
    terrainLayersPromise = runLocal({ kind: 'terrain', terrainUrl: TERRAIN_URL })
      .then((result) => {
        if (result.kind !== 'terrain') throw new Error('engine returned the wrong result kind');
        return result.layers;
      })
      .catch((e: unknown) => {
        terrainLayersPromise = null; // allow a retry
        throw e;
      });
  }
  return terrainLayersPromise;
}

/**
 * Terrain-aware route between the start, waypoints and destination: A* over the DEM grid with the
 * mission constraints (slope limit, walking speed, EVA duration and reserve), plus the EVA budget,
 * return margin, elevation profile and terrain summary shown in the route panel.
 */
export async function calculateRoute(request: RouteRequest): Promise<RouteResponse> {
  const body = request as EngineRouteRequest;
  return (await planRemote(body)) ?? (await planLocal(body));
}

/**
 * Finds target by ID from mock data
 */
export function getTargetById(id: string) {
  return MOCK_SCIENCE_TARGETS.find((t) => t.id === id);
}
