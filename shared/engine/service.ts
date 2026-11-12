/**
 * RouteRequest -> RouteResponse in the browser (mirror of marga_engine/service.py and contracts.py).
 * Durations are rounded up and the return margin down in the integer contract fields.
 */
import type { LocationPoint, RouteSegment } from '../types/index.ts';
import type {
  EngineRouteRequest, EngineRouteResponse, EngineStatusReason, ReturnCheckRequest, RouteMetric, RouteSummary,
  TerrainSource, UnknownPolicy,
} from '../types/engine.ts';
import { DEFAULT_CONFIG, SLOPE_CLASS_STEEP_MAX, type EngineConfig } from './config.ts';
import { RAD2DEG, haversineM, normalizeLon, roundHalfEven, roundTo } from './geodesy.ts';
import { MobilityModel, assessEva, estimateDose, referenceWithRate, returnMarginFrom } from './eva.ts';
import {
  LegPlanner, buildProfile, directLineStats, legStats, profile3d, profileDistance, profileGainLoss,
  profileMaxTerrainSlope, profileTime, summaryFractions, type LegResult, type RouteProfile,
} from './planner.ts';
import { RoutingContext } from './routing.ts';
import { EngineError, TerrainGrid, metadataLabel, slopeClass } from './terrain.ts';

export const ENGINE_VERSION = '1.0.0';
const ALGORITHM = 'A* on 8-connected DEM grid (anisotropic octile heuristic, no corner cutting) + string pulling';

interface Pt { lat: number; lon: number; name: string; targetId?: string }
interface Parsed {
  routeId: string | null; start: Pt; destination: Pt; waypoints: Pt[]; habitat: Pt; notes: string[];
  objective: { id: string; title?: string } | null;
  c: { speed: number; maxSlope: number; evaH: number; resH: number; maxDist: number; sciPerStop: number | null; radRate: number | null };
  o: { metric: RouteMetric; policy: UnknownPolicy; alternatives: boolean; ws?: number; wr?: number; wu?: number };
}

export interface TargetLike { id: string; name: string; latitude: number; longitude: number; source?: string }

const ceilI = (x: number) => Math.ceil(x - 1e-9);
const floorI = (x: number) => Math.floor(x + 1e-9);
const r1 = (x: number | null | undefined, n = 1): number | null =>
  x === null || x === undefined || !Number.isFinite(x) ? null : roundTo(x, n);

function num(d: Record<string, unknown>, key: string, opts: { lo?: number; hi?: number; loOpen?: boolean; required?: boolean; label?: string } = {}): number | null {
  const label = opts.label ?? key;
  const v = d?.[key];
  if (v === undefined || v === null) {
    if (opts.required ?? true) throw new EngineError('input', `${label} is required`);
    return null;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineError('input', `${label} must be a finite number (got ${JSON.stringify(v)})`);
  if (opts.lo !== undefined && (opts.loOpen ? v <= opts.lo : v < opts.lo)) throw new EngineError('input', `${label} must be ${opts.loOpen ? '>' : '>='} ${opts.lo} (got ${v})`);
  if (opts.hi !== undefined && v > opts.hi) throw new EngineError('input', `${label} must be <= ${opts.hi} (got ${v})`);
  return v;
}

function point(d: unknown, name: string): Pt {
  if (!d || typeof d !== 'object') throw new EngineError('input', `${name} must be an object with latitude and longitude`);
  const o = d as Record<string, unknown>;
  const lat = num(o, 'latitude', { lo: -90, hi: 90, label: `${name}.latitude` })!;
  const lon = num(o, 'longitude', { label: `${name}.longitude` })!;
  return { lat, lon: normalizeLon(lon), name: (o.name as string) || name };
}

function parse(body: EngineRouteRequest, targets?: Map<string, TargetLike>): Parsed {
  if (!body || typeof body !== 'object') throw new EngineError('input', 'request body must be a JSON object');
  const start = point(body.start, 'Start');
  const destination = point(body.destination, 'Destination');
  const wr = body.waypoints ?? [];
  if (!Array.isArray(wr)) throw new EngineError('input', 'waypoints must be a list');
  const waypoints = wr.map((w, i) => point(w, `Waypoint ${i + 1}`));
  const notes: string[] = [];
  if (body.target_ids?.length && !waypoints.length) {
    if (!targets) notes.push('target_ids were ignored: no science target catalogue is loaded in the engine');
    else for (const id of body.target_ids) {
      const t = targets.get(id);
      if (!t) throw new EngineError('input', `unknown target id '${id}'`);
      const p = { lat: t.latitude, lon: normalizeLon(t.longitude), name: t.name, targetId: t.id };
      if (haversineM(p.lat, p.lon, destination.lat, destination.lon) > 1 && haversineM(p.lat, p.lon, start.lat, start.lon) > 1) waypoints.push(p);
    }
  }
  if (waypoints.length > 25) throw new EngineError('input', 'at most 25 waypoints are supported per request');
  const habitat = body.habitat ? point(body.habitat, 'Habitat') : { ...start };
  const cr = body.constraints as unknown as Record<string, unknown>;
  if (!cr || typeof cr !== 'object') throw new EngineError('input', 'constraints must be an object');
  const evaH = num(cr, 'maxEvaHours', { lo: 0, hi: 24, loOpen: true })!;
  const resH = num(cr, 'reserveEvaHours', { lo: 0, hi: 24 })!;
  const c = {
    speed: num(cr, 'walkingSpeedKmh', { lo: 0, hi: 20, loOpen: true })!,
    maxSlope: num(cr, 'maxSlopeDegrees', { lo: 0, hi: 60, loOpen: true })!,
    evaH, resH,
    maxDist: num(cr, 'maxDistanceMeters', { lo: 0, loOpen: true })!,
    sciPerStop: num(cr, 'scienceTimeMinPerStop', { lo: 0, hi: 1440, required: false }),
    radRate: num(cr, 'radiationRateMsvPerDay', { lo: 0, hi: 1000, required: false }),
  };
  const od = (body.options ?? {}) as Record<string, unknown>;
  const metric = (od.metric ?? 'terrain') as RouteMetric;
  const policy = (od.unknown_policy ?? 'exclude') as UnknownPolicy;
  if (!['terrain', 'distance', 'time'].includes(metric)) throw new EngineError('input', "options.metric must be 'terrain', 'distance' or 'time'");
  if (!['exclude', 'penalize'].includes(policy)) throw new EngineError('input', "options.unknown_policy must be 'exclude' or 'penalize'");
  const o = {
    metric, policy, alternatives: od.compute_alternatives === undefined ? true : Boolean(od.compute_alternatives),
    ws: num(od, 'slope_weight', { lo: 0, hi: 100, required: false }) ?? undefined,
    wr: num(od, 'roughness_weight', { lo: 0, hi: 100, required: false }) ?? undefined,
    wu: num(od, 'uncertainty_weight', { lo: 0, hi: 100, required: false }) ?? undefined,
  };
  if (body.route_id !== undefined && typeof body.route_id !== 'string') throw new EngineError('input', 'route_id must be a string');
  const objective = body.objective ?? null;
  if (objective !== null && typeof objective !== 'object') throw new EngineError('input', 'objective must be an object with id and title');
  return { routeId: body.route_id ?? null, start, destination, waypoints, habitat, notes, objective, c, o };
}

function buildContext(t: TerrainGrid, p: Parsed, cfg0: EngineConfig): [RoutingContext, EngineConfig] {
  const w = { ...cfg0.weights, slope: p.o.ws ?? cfg0.weights.slope, roughness: p.o.wr ?? cfg0.weights.roughness,
    uncertainty: p.o.wu ?? cfg0.weights.uncertainty };
  const cfg: EngineConfig = { ...cfg0, weights: w, metric: p.o.metric, unknownPolicy: p.o.policy,
    computeAlternatives: p.o.alternatives && cfg0.computeAlternatives };
  let [rough, note] = t.roughnessLayer(cfg.roughnessMaxCellM);
  if (rough && w.roughness === 0) { rough = null; note = 'omitted: roughness weight set to 0'; }
  const mob = new MobilityModel(p.c.speed, cfg.mobility);
  return [new RoutingContext(p.o.metric, p.c.maxSlope, w, p.o.policy, mob, cfg, rough, note), cfg];
}

/** Deterministic id (FNV-1a). Differs from the Python id, which hashes with SHA-256. */
export function routeIdFor(body: unknown, t: TerrainGrid): string {
  const s = JSON.stringify({ req: body, terrain: t.metadata.dataset_id, v: ENGINE_VERSION });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 2246822519) >>> 0;
  }
  return 'marga_route_' + (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10);
}

function engineBlock(ctx: RoutingContext, cfg: EngineConfig) {
  const w = ctx.weights;
  return {
    name: 'marga_engine' as const, version: ENGINE_VERSION, algorithm: ALGORITHM, metric: ctx.metric, deterministic: true as const,
    cost_model: {
      formula: ctx.metric === 'terrain' ? 'C = L (1 + w_s P_s + w_r P_r + w_u P_u)' : ctx.metric === 'distance' ? 'C = L' : 'C = L / v(grade)',
      slope_weight: w.slope, slope_exponent: w.slopeExponent, roughness_weight: ctx.roughness ? w.roughness : 0,
      roughness_ref_m: cfg.roughnessRefM, uncertainty_weight: ctx.unknownPolicy === 'penalize' ? w.uncertainty : 0,
      max_slope_deg: ctx.maxSlopeDeg, unknown_policy: ctx.unknownPolicy, roughness: ctx.roughnessNote,
    },
    mobility_model: ctx.mobility.describe(),
  };
}

function terrainSource(t: TerrainGrid, ctx: RoutingContext): TerrainSource {
  const md = t.metadata;
  return {
    dataset_id: md.dataset_id, label: metadataLabel(md), synthetic: md.synthetic, mission: md.mission ?? null,
    instrument: md.instrument ?? null, source: md.source ?? null, crs: md.crs ?? null, vertical_datum: md.vertical_datum ?? null,
    resolution_m: r1(t.geometry.cellSizeM, 2), processing_level: md.processing_level ?? null, status: md.status ?? 'unvalidated',
    limitations: md.limitations ?? [], roughness: ctx.roughnessNote,
  };
}

function coords(legs: Array<Array<[number, number]>>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  legs.forEach((pts, k) => pts.forEach(([lat, lon], j) => { if (!(k > 0 && j === 0)) out.push([roundTo(lon, 7), roundTo(lat, 7)]); }));
  return out;
}

function summary(p: RouteProfile, legs: LegResult[], metric: RouteMetric): RouteSummary {
  const fr = summaryFractions(p);
  const [g, l] = profileGainLoss(p);
  return {
    metric, distance_m: r1(profileDistance(p)), distance_3d_m: r1(profile3d(p)), elevation_gain_m: r1(g),
    elevation_loss_m: r1(l), estimated_time_min: r1(profileTime(p)), max_terrain_slope_deg: r1(profileMaxTerrainSlope(p)),
    route_cost: r1(legs.reduce((s, x) => s + x.cost, 0), 2),
    terrain_fractions: { flat: roundTo(fr.flat, 4), moderate: roundTo(fr.moderate, 4), steep: roundTo(fr.steep, 4),
      hazardous: roundTo(fr.hazardous, 4), unknown: roundTo(fr.unknown, 4) },
    coordinates: coords(legs.map((x) => x.points)),
  };
}

function pctLargestRemainder(fr: Record<string, number>, keys: string[]): Record<string, number> {
  const raw: Record<string, number> = {};
  let tot = 0;
  for (const k of keys) { raw[k] = (fr[k] ?? 0) * 100; tot += raw[k]; }
  if (tot <= 0) return Object.fromEntries(keys.map((k) => [k, 0]));
  const base: Record<string, number> = Object.fromEntries(keys.map((k) => [k, Math.floor(raw[k])]));
  const short = 100 - keys.reduce((s, k) => s + base[k], 0);
  [...keys].sort((a, b) => ((raw[b] - base[b]) - (raw[a] - base[a])) || (keys.indexOf(a) - keys.indexOf(b)))
    .slice(0, Math.max(0, short)).forEach((k) => { base[k] += 1; });
  return base;
}

function profilePoints(p: RouteProfile, maxPoints: number) {
  const n = p.lat.length;
  const keep = new Uint8Array(n);
  const stride = Math.max(1, Math.ceil(n / maxPoints));
  for (let i = 0; i < n; i += stride) keep[i] = 1;
  keep[n - 1] = 1;
  for (let i = 0; i < n - 1; i++) if (p.leg[i + 1] !== p.leg[i]) { keep[i] = 1; keep[i + 1] = 1; }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out.push({
      distance_m: roundHalfEven(p.dist[i]), elevation_m: roundHalfEven(p.elev[i]),
      slope_deg: roundTo(Math.atan(Math.abs(p.grade[i])) * RAD2DEG, 1),
      coordinate: [roundTo(p.lon[i], 7), roundTo(p.lat[i], 7)] as [number, number],
      terrain_slope_deg: r1(p.terrainSlope[i]), time_min: roundTo(p.time[i], 1), leg: p.leg[i],
      data_quality: (p.quality[i] ? 'dem' : 'interpolated') as 'dem' | 'interpolated',
    });
  }
  return out;
}

function empty(routeId: string, status: EngineRouteResponse['status'], warnings: string[], ext: Partial<EngineRouteResponse> = {}): EngineRouteResponse {
  return {
    route_id: routeId, distance_m: 0, distance_3d_m: 0, elevation_gain_m: 0, elevation_loss_m: 0, estimated_time_min: 0,
    eva_budget_used_percent: 0, return_margin_min: 0, coordinates: [], elevation_profile: [], segments: [], status, warnings,
    terrain_summary: { flat_pct: 0, moderate_pct: 0, steep_pct: 0, hazardous_pct: 0 }, ...ext,
  };
}

/** A contract-shaped failed RouteResponse (no route), e.g. when the terrain package cannot be loaded. */
export function failedRouteResponse(routeId: string, warnings: string[], statusReason: EngineStatusReason): EngineRouteResponse {
  return empty(routeId, 'failed', warnings, { status_reason: statusReason });
}

export function planRoute(body: EngineRouteRequest, terrain: TerrainGrid, config: EngineConfig = DEFAULT_CONFIG,
                          targets?: Map<string, TargetLike>): EngineRouteResponse {
  const base = terrain.metadata.synthetic
    ? ['SYNTHETIC TEST TERRAIN: elevations are generated, not NASA data. Use only to exercise the software.'] : [];
  let p: Parsed;
  try { p = parse(body, targets); } catch (e) {
    const rid = body && typeof body.route_id === 'string' ? body.route_id : 'marga_route_invalid';
    return empty(rid, 'failed', [...base, `Invalid request: ${(e as Error).message}`], { status_reason: 'invalid_request' });
  }
  const routeId = p.routeId ?? routeIdFor(body, terrain);
  let ctx: RoutingContext, cfg: EngineConfig;
  try { [ctx, cfg] = buildContext(terrain, p, config); } catch (e) {
    return empty(routeId, 'failed', [...base, `Invalid request: ${(e as Error).message}`], { status_reason: 'invalid_request' });
  }
  const stops = [p.start, ...p.waypoints, p.destination];
  try { for (const s of [...stops, p.habitat]) terrain.requireCoverage(s.lat, s.lon, s.name); } catch (e) {
    return empty(routeId, 'failed', [...base, (e as Error).message], { status_reason: 'outside_terrain_coverage',
      terrain_source: terrainSource(terrain, ctx), engine: engineBlock(ctx, cfg) });
  }
  try { return plan(p, routeId, terrain, ctx, cfg, [...base], targets); } catch (e) {
    return empty(routeId, 'failed', [...base, `Engine error: ${(e as Error).message}`], { status_reason: 'engine_error',
      terrain_source: terrainSource(terrain, ctx), engine: engineBlock(ctx, cfg) });
  }
}

function plan(p: Parsed, routeId: string, terrain: TerrainGrid, ctx: RoutingContext, cfg: EngineConfig, warnings: string[],
              targets?: Map<string, TargetLike>): EngineRouteResponse {
  const stops = [p.start, ...p.waypoints, p.destination];
  const planner = new LegPlanner(terrain, ctx);
  const assumptions = [...p.notes];
  const common = { engine: engineBlock(ctx, cfg), terrain_source: terrainSource(terrain, ctx) };
  const catalogueSources = [...new Set(stops.map((x) => (x.targetId && targets?.get(x.targetId)?.source) || null)
    .filter((x): x is string => !!x))].sort();
  const legs: LegResult[] = [];
  const snapped = new Map<number, number>();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const lr = planner.plan([a.lat, a.lon], [b.lat, b.lon]);
    if (!lr.ok) {
      return empty(routeId, 'unreachable', [...warnings, `Leg ${i + 1} (${a.name} -> ${b.name}): ${lr.message}`],
        { status_reason: lr.reason as EngineStatusReason, failed_leg: i, assumptions, ...common });
    }
    legs.push(lr);
    if (lr.startSnapM > 0) snapped.set(i, lr.startSnapM);
    if (lr.goalSnapM > 0) snapped.set(i + 1, lr.goalSnapM);
  }
  [...snapped.entries()].sort((x, y) => x[0] - y[0]).forEach(([idx, moved]) => warnings.push(
    `${stops[idx].name} lies on ground that is prohibited or has no elevation data; the route uses the nearest ` +
    `traversable cell, ${moved.toFixed(0)} m away.`));
  const prof = buildProfile(terrain, legs.map((l) => l.points), ctx.mobility, ctx.maxSlopeDeg);
  const turn = legs[legs.length - 1].points[legs[legs.length - 1].points.length - 1];
  const ret = planner.plan(turn, [p.habitat.lat, p.habitat.lon]);
  if (!ret.ok) {
    return empty(routeId, 'unreachable', [...warnings, `Return (${p.destination.name} -> ${p.habitat.name}): ${ret.message}`],
      { status_reason: ('return_' + (ret.reason ?? 'failed')) as EngineStatusReason, assumptions, ...common });
  }
  const retProf = buildProfile(terrain, [ret.points], ctx.mobility, ctx.maxSlopeDeg);
  const c = p.c;
  const nStops = p.waypoints.length + 1;
  const scienceMin = (c.sciPerStop ?? 0) * nStops;
  if (c.sciPerStop === null) {
    assumptions.push('No science time per stop was configured (scienceTimeMinPerStop); the margin excludes science ' +
      'work - see eva_assessment.max_science_time_min.');
  }
  const eva = assessEva(profileTime(prof), profileTime(retProf), c.evaH * 60, c.resH * 60, scienceMin);
  const evaD = {
    ...Object.fromEntries(Object.entries(eva).map(([k, v]) => [k, typeof v === 'number' ? roundTo(v, 1) : v])),
    science_stops: nStops, science_min_per_stop: c.sciPerStop, walking_speed_model: ctx.mobility.describe(),
    return_route_recalculated: true,
    notes: ['Times are planning estimates from a Tobler-shaped speed model scaled to the configured flat walking speed; ' +
      'not a validated suited-astronaut mobility prediction.'],
  } as EngineRouteResponse['eva_assessment'];
  const doseRef = referenceWithRate(c.radRate, cfg.doseReference);
  const radiation = {
    planned_activity: estimateDose(profileTime(prof) + scienceMin + profileTime(retProf), doseRef),
    full_eva_duration: estimateDose(c.evaH * 60, doseRef),
  };

  let unknownM = 0, haz = 0;
  for (let i = 0; i < prof.stepLen.length; i++) {
    if (prof.stepClass[i] === 'unknown') unknownM += prof.stepLen[i];
    if (prof.stepClass[i] === 'hazardous') haz += prof.stepLen[i];
  }
  if (unknownM > 0) warnings.push(`${unknownM.toFixed(0)} m of the route crosses ground with no elevation data; elevations there are interpolated and terrain is uncertain.`);
  if (haz > 0) warnings.push(`${haz.toFixed(0)} m of the route is on terrain steeper than ${SLOPE_CLASS_STEEP_MAX} deg (allowed by the ${ctx.maxSlopeDeg} deg limit).`);
  const hab = p.habitat;
  const stride = Math.max(1, Math.floor(prof.lat.length / 400));
  let far = haversineM(hab.lat, hab.lon, p.destination.lat, p.destination.lon, terrain.geometry.radiusM);
  for (let i = 0; i < prof.lat.length; i += stride) far = Math.max(far, haversineM(hab.lat, hab.lon, prof.lat[i], prof.lon[i], terrain.geometry.radiusM));
  if (far > c.maxDist) warnings.push(`Route reaches ${far.toFixed(0)} m from ${hab.name}, beyond the configured maximum traverse radius of ${c.maxDist.toFixed(0)} m.`);
  if (terrain.geometry.cellSizeM > cfg.coarseDemWarningM) warnings.push(`Terrain grid spacing is ${terrain.geometry.cellSizeM.toFixed(0)} m: obstacles smaller than this are not represented. Not an obstacle map for walking.`);
  let statusReason: EngineStatusReason = null;
  if (eva.reserve_min >= eva.eva_duration_min) {
    warnings.push(`The safety reserve (${c.resH} h) is not shorter than the EVA (${c.evaH} h): no time is left for the excursion.`);
    statusReason = 'eva_budget_exceeded';
  } else if (eva.status === 'exceeded') {
    warnings.push(`EVA budget exceeded: outbound ${ceilI(eva.outbound_min)} + science ${ceilI(eva.science_min)} + return ` +
      `${ceilI(eva.return_min)} + reserve ${ceilI(eva.reserve_min)} min needed, but the EVA is ${eva.eva_duration_min.toFixed(0)} min ` +
      `(return margin ${floorI(eva.return_margin_min)} min).`);
    statusReason = 'eva_budget_exceeded';
  } else if (eva.status === 'no_slack') {
    warnings.push('Return margin is zero: no time remains beyond the configured reserve.');
  }
  const feasibility = warnings.filter((w) => !w.startsWith('SYNTHETIC'));
  const status = eva.status === 'exceeded' ? 'unreachable' : feasibility.length ? 'warning' : 'calculated';

  const segments: Array<RouteSegment & Record<string, unknown>> = [];
  for (let k = 0; k < stops.length - 1; k++) {
    const st = legStats(prof, k);
    const cls = slopeClass(st.mean_terrain_slope_deg);
    segments.push({
      from_name: stops[k].name, to_name: stops[k + 1].name, distance_m: Math.round(st.distance_m),
      estimated_time_min: ceilI(st.time_min), average_slope_deg: roundTo(st.mean_along_track_slope_deg, 1),
      terrain_type: Number.isFinite(st.mean_terrain_slope_deg)
        ? `${cls[0].toUpperCase()}${cls.slice(1)} terrain (mean ${st.mean_terrain_slope_deg.toFixed(1)}°, max ${st.max_terrain_slope_deg.toFixed(1)}° terrain slope)`
        : 'Unknown terrain (no elevation data)',
      max_terrain_slope_deg: r1(st.max_terrain_slope_deg), elevation_gain_m: r1(st.gain_m), elevation_loss_m: r1(st.loss_m),
      unknown_length_m: r1(st.unknown_m), start_snapped_m: r1(legs[k].startSnapM), end_snapped_m: r1(legs[k].goalSnapM),
    });
  }
  const pct = pctLargestRemainder(summaryFractions(prof), ['flat', 'moderate', 'steep', 'hazardous', 'unknown']);

  let alternatives: EngineRouteResponse['alternatives'] = null;
  if (cfg.computeAlternatives) {
    const alts: Record<string, unknown> = { selected_metric: ctx.metric, [ctx.metric]: summary(prof, legs, ctx.metric),
      direct_line: stops.slice(0, -1).map((a, i) => ({ ...directLineStats(terrain, ctx, [a.lat, a.lon], [stops[i + 1].lat, stops[i + 1].lon]),
        from_name: a.name, to_name: stops[i + 1].name })) };
    for (const alt of ['distance', 'terrain'] as RouteMetric[]) {
      if (alt === ctx.metric) continue;
      const p2 = new LegPlanner(terrain, ctx.withMetric(alt));
      const altLegs = stops.slice(0, -1).map((a, i) => p2.plan([a.lat, a.lon], [stops[i + 1].lat, stops[i + 1].lon]));
      alts[alt] = altLegs.every((l) => l.ok)
        ? summary(buildProfile(terrain, altLegs.map((l) => l.points), ctx.mobility, ctx.maxSlopeDeg), altLegs, alt) : null;
    }
    alts.notes = ["'distance' is the shortest route that still avoids prohibited ground; 'terrain' minimises the terrain cost. Neither is certified safe."];
    alternatives = alts as unknown as EngineRouteResponse['alternatives'];
  }
  const returnRoute = { ...summary(retProf, [ret], ctx.metric), from_name: p.destination.name, to_name: hab.name,
    recalculated: true as const, end_snapped_m: r1(ret.goalSnapM) };
  assumptions.push(
    `Slope limit ${ctx.maxSlopeDeg} deg and walking speed ${c.speed} km/h are simulation parameters, not certified astronaut mobility limits.`,
    'Routes are preliminary terrain-risk assessments; they are not certified safe.',
    `Terrain slope from the DEM at ${terrain.geometry.cellSizeM.toFixed(0)} m spacing; features smaller than one cell are not represented.`);
  const [gain, loss] = profileGainLoss(prof);
  return {
    route_id: routeId,
    distance_m: Math.round(profileDistance(prof)),
    distance_3d_m: Math.round(profile3d(prof)),
    elevation_gain_m: Math.round(gain),
    elevation_loss_m: Math.round(loss),
    estimated_time_min: ceilI(profileTime(prof)),
    eva_budget_used_percent: Math.round(eva.budget_used_percent),
    return_margin_min: floorI(eva.return_margin_min),
    coordinates: coords(legs.map((l) => l.points)),
    elevation_profile: profilePoints(prof, cfg.maxProfilePoints),
    segments,
    status,
    warnings,
    terrain_summary: { flat_pct: pct.flat, moderate_pct: pct.moderate, steep_pct: pct.steep, hazardous_pct: pct.hazardous, unknown_pct: pct.unknown },
    status_reason: statusReason,
    eva_assessment: evaD,
    radiation,
    return_route: returnRoute,
    alternatives,
    search: legs.map((l, k) => ({ leg: k, search_cell_m: l.searchCellM, guide_factor: l.guideFactor, window_cells: l.windowCells,
      expanded_nodes: l.expanded, notes: l.notes })),
    assumptions,
    mission_summary: {
      site: { site_id: terrain.metadata.site_id ?? null, terrain_dataset: metadataLabel(terrain.metadata) },
      objective: p.objective,
      targets: [...p.waypoints, p.destination].map((x) => x.name),
      start: p.start.name,
      habitat: hab.name,
      route_status: status,
      total_distance_m: Math.round(profileDistance(prof)),
      estimated_travel_time_min: ceilI(profileTime(prof)),
      estimated_working_time_min: ceilI(scienceMin),
      estimated_return_time_min: ceilI(profileTime(retProf)),
      return_margin_min: floorI(eva.return_margin_min),
      terrain_advisories: warnings.filter((w) => !w.startsWith('SYNTHETIC')),
      radiation: {
        dose_equivalent_msv: radiation.planned_activity.dose_equivalent_msv,
        duration_min: radiation.planned_activity.duration_min,
        basis: `${doseRef.rate_msv_per_day} ${doseRef.unit} (${doseRef.mission}, ${doseRef.instrument}, ` +
          `${doseRef.measurement_period}; historical, not a forecast)`,
      },
      dataset_references: [`Terrain: ${metadataLabel(terrain.metadata)}` + (terrain.metadata.source ? ` - ${terrain.metadata.source}` : ''),
        ...catalogueSources.map((x) => `Targets: ${x}`)],
      data_limitations: [...(terrain.metadata.limitations ?? []), ...assumptions],
    },
    ...common,
  };
}

/** Field mode: fresh return route from the current position and M = (T_EVA - T_elapsed) - T_return - T_reserve. */
export function assessReturn(body: ReturnCheckRequest, terrain: TerrainGrid, config: EngineConfig = DEFAULT_CONFIG) {
  const pos = point(body?.position, 'Current position');
  const hab = point(body?.habitat, 'Habitat');
  const el = body?.elapsed_min;
  if (typeof el !== 'number' || !Number.isFinite(el) || el < 0) throw new EngineError('input', 'elapsed_min must be a non-negative number');
  const p = parse({ start: body.position, destination: body.habitat, constraints: body.constraints, options: body.options } as EngineRouteRequest);
  const [ctx, cfg] = buildContext(terrain, p, config);
  for (const q of [pos, hab]) terrain.requireCoverage(q.lat, q.lon, q.name);
  const leg = new LegPlanner(terrain, ctx).plan([pos.lat, pos.lon], [hab.lat, hab.lon]);
  const out: Record<string, unknown> = { position: pos, habitat: hab, terrain_source: terrainSource(terrain, ctx), engine: engineBlock(ctx, cfg) };
  if (!leg.ok) return { ...out, status: 'unreachable', status_reason: leg.reason, message: leg.message };
  const prof = buildProfile(terrain, [leg.points], ctx.mobility, ctx.maxSlopeDeg);
  const m = returnMarginFrom(el, profileTime(prof), p.c.evaH * 60, p.c.resH * 60);
  return {
    ...out,
    status: m.status === 'within_budget' ? 'calculated' : m.status === 'no_slack' ? 'warning' : 'unreachable',
    return_route: summary(prof, [leg], ctx.metric),
    margin: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? roundTo(v, 1) : v])),
    radiation_remaining_eva: estimateDose(Math.max(0, p.c.evaH * 60 - el), referenceWithRate(p.c.radRate, cfg.doseReference)),
    ...(terrain.metadata.synthetic ? { warnings: ['SYNTHETIC TEST TERRAIN: elevations are generated, not NASA data.'] } : {}),
  };
}

export type { LocationPoint };
