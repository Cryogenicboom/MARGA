/**
 * Leg planning and route profiles (mirror of marga_engine/routing/{planner,profile}.py).
 */
import { SLOPE_CLASS_FLAT_MAX, SLOPE_CLASS_MODERATE_MAX, SLOPE_CLASS_STEEP_MAX } from './config.ts';
import { DEG2RAD, RAD2DEG, haversineM, lonDelta, normalizeLon, pmod, roundHalfEven } from './geodesy.ts';
import type { MobilityModel } from './eva.ts';
import {
  EdgeModel, RoutingContext, SegmentEvaluator, astar, guideSurface, nativePassable, nativeSurface, polylineCost,
  stringPull, supercover, type SearchSurface,
} from './routing.ts';
import type { SlopeClass, TerrainGrid } from './terrain.ts';

type LatLon = [number, number];

export interface SnapResult { row: number; col: number; lat: number; lon: number; movedM: number; exact: [number, number] }

export interface LegResult {
  ok: boolean;
  metric: string;
  points: LatLon[];
  cost: number;
  reason: string | null;
  message: string | null;
  startSnapM: number;
  goalSnapM: number;
  searchCellM: number;
  guideFactor: number;
  expanded: number;
  windowCells: number;
  notes: string[];
}

/** 4-connected component labels (== 8-connectivity under the no-corner-cutting rule); 0 = blocked. */
export function connectedComponents(passable: Uint8Array, ny: number, nx: number): Int32Array {
  const parent: number[] = [0];
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const rowsRuns: Array<Array<[number, number, number]>> = [];
  let prev: Array<[number, number, number]> = [];
  for (let r = 0; r < ny; r++) {
    const cur: Array<[number, number, number]> = [];
    let j = 0, c = 0;
    while (c < nx) {
      if (!passable[r * nx + c]) { c++; continue; }
      const st = c;
      while (c < nx && passable[r * nx + c]) c++;
      const en = c;
      const lab = parent.length;
      parent.push(lab);
      while (j < prev.length && prev[j][1] <= st) j++;
      let k = j;
      while (k < prev.length && prev[k][0] < en) {
        const ra = find(lab), rb = find(prev[k][2]);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
        k++;
      }
      cur.push([st, en, lab]);
    }
    rowsRuns.push(cur);
    prev = cur;
  }
  const labels = new Int32Array(ny * nx);
  rowsRuns.forEach((runs, r) => {
    for (const [st, en, lab] of runs) labels.fill(find(lab), r * nx + st, r * nx + en);
  });
  return labels;
}

const TRAVERSABILITY = new WeakMap<TerrainGrid, Map<string, { passable: Uint8Array; components: Int32Array }>>();

/** Traversable cells + connectivity for a slope / no-data setting, computed once per terrain and
 *  shared by every leg, the return search and the alternatives (only the cost metric differs). */
export function traversability(terrain: TerrainGrid, ctx: RoutingContext) {
  let per = TRAVERSABILITY.get(terrain);
  if (!per) { per = new Map(); TRAVERSABILITY.set(terrain, per); }
  const key = `${ctx.maxSlopeDeg}|${ctx.unknownPolicy}`;
  let hit = per.get(key);
  if (!hit) {
    const passable = nativePassable(terrain, ctx);
    hit = { passable, components: connectedComponents(passable, terrain.geometry.nrows, terrain.geometry.ncols) };
    per.set(key, hit);
    while (per.size > 8) per.delete(per.keys().next().value as string);
  }
  return hit;
}

export class LegPlanner {
  readonly terrain: TerrainGrid;
  readonly ctx: RoutingContext;
  readonly passable: Uint8Array;
  readonly components: Int32Array;
  constructor(terrain: TerrainGrid, ctx: RoutingContext) {
    this.terrain = terrain;
    this.ctx = ctx;
    const t = traversability(terrain, ctx);
    this.passable = t.passable;
    this.components = t.components;
  }

  snapCandidates(lat: number, lon: number): [SnapResult[], string | null] {
    const g = this.terrain.geometry;
    const [rf, cf] = g.rc(lat, lon);
    const r = Math.min(Math.max(roundHalfEven(rf), 0), g.nrows - 1);
    const c = Math.min(Math.max(roundHalfEven(cf), 0), g.ncols - 1);
    if (this.passable[r * g.ncols + c]) return [[{ row: r, col: c, lat, lon, movedM: 0, exact: [rf, cf] }], null];
    const lim = this.ctx.config.endpointSnapM;
    const dx = g.dxMRows, dy = g.dyM;
    let dxMin = Infinity;
    for (const v of dx) dxMin = Math.min(dxMin, v);
    const rr = Math.ceil(lim / dy) + 1, cr = Math.ceil(lim / dxMin) + 1;
    const r0 = Math.max(0, r - rr), r1 = Math.min(g.nrows, r + rr + 1);
    const c0 = Math.max(0, c - cr), c1 = Math.min(g.ncols, c + cr + 1);
    const cands: Array<[number, number, number, number]> = [];   // d, idx, row, col
    for (let i = r0; i < r1; i++) {
      for (let j = c0; j < c1; j++) {
        const d = Math.hypot((i - rf) * dy, (j - cf) * dx[i]);
        if (this.passable[i * g.ncols + j] && d <= lim) cands.push([d, (i - r0) * (c1 - c0) + (j - c0), i, j]);
      }
    }
    if (!cands.length) {
      const s = this.terrain.slopeDeg[r * g.ncols + c];
      const why = !Number.isFinite(s) ? 'no elevation data'
        : `terrain slope ${s.toFixed(1)} deg exceeds the ${this.ctx.maxSlopeDeg} deg limit`;
      return [[], `${why}, and no traversable ground within ${lim} m`];
    }
    cands.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return [cands.map(([d, , i, j]) => ({ row: i, col: j, lat: g.rowLat(i), lon: g.colLon(j), movedM: d, exact: [i, j] as [number, number] })), null];
  }

  private pickConnected(ca: SnapResult[], cb: SnapResult[]): [SnapResult, SnapResult] | null {
    const nx = this.terrain.geometry.ncols;
    const compB = new Map<number, SnapResult>();
    for (const s of cb) { const k = this.components[s.row * nx + s.col]; if (!compB.has(k)) compB.set(k, s); }
    for (const s of ca) { const hit = compB.get(this.components[s.row * nx + s.col]); if (hit) return [s, hit]; }
    return null;
  }

  plan(a: LatLon, b: LatLon): LegResult {
    const ctx = this.ctx;
    const g = this.terrain.geometry;
    const res: LegResult = { ok: false, metric: ctx.metric, points: [], cost: Infinity, reason: null, message: null,
      startSnapM: 0, goalSnapM: 0, searchCellM: Math.round(g.cellSizeM * 100) / 100, guideFactor: 1, expanded: 0,
      windowCells: 0, notes: [] };
    const [ca, whyA] = this.snapCandidates(a[0], a[1]);
    const [cb, whyB] = this.snapCandidates(b[0], b[1]);
    if (!ca.length) { res.reason = 'start_not_traversable'; res.message = `Start point: ${whyA}.`; return res; }
    if (!cb.length) { res.reason = 'destination_not_traversable'; res.message = `Destination: ${whyB}.`; return res; }
    const pair = this.pickConnected(ca, cb);
    if (!pair) {
      res.reason = 'no_traversable_path';
      res.message = `No route exists between the points without crossing ground steeper than ${ctx.maxSlopeDeg} deg` +
        (ctx.unknownPolicy === 'exclude' ? ' or ground without elevation data' : '') +
        ' (they lie in disconnected traversable areas).';
      return res;
    }
    const [sa, sb] = pair;
    res.startSnapM = sa.movedM; res.goalSnapM = sb.movedM;
    const L = haversineM(sa.lat, sa.lon, sb.lat, sb.lon, g.radiusM);
    let pad = Math.max(ctx.config.windowPadFraction * L, ctx.config.windowPadMinM);
    let dxMin = Infinity;
    for (const v of g.dxMRows) dxMin = Math.min(dxMin, v);
    for (;;) {
      const pr = Math.ceil(pad / g.dyM), pc = Math.ceil(pad / dxMin);
      let r0 = Math.max(0, Math.min(sa.row, sb.row) - pr), r1 = Math.min(g.nrows, Math.max(sa.row, sb.row) + pr + 1);
      let c0 = Math.max(0, Math.min(sa.col, sb.col) - pc), c1 = Math.min(g.ncols, Math.max(sa.col, sb.col) + pc + 1);
      if (r1 - r0 < 3) { r0 = Math.max(0, r1 - 3); r1 = Math.max(3, r1); }
      if (c1 - c0 < 3) { c0 = Math.max(0, c1 - 3); c1 = Math.max(3, c1); }
      const full = r0 === 0 && c0 === 0 && r1 === g.nrows && c1 === g.ncols;
      const cells = (r1 - r0) * (c1 - c0);
      res.windowCells = cells;
      const out = cells <= ctx.config.maxSearchCells ? this.native(res, sa, sb, r0, r1, c0, c1)
        : this.coarseToFine(res, sa, sb, r0, r1, c0, c1);
      if (out) return out;
      if (full) { res.reason = 'no_traversable_path'; res.message = 'No route found on the full terrain grid.'; return res; }
      pad *= 2.5;
    }
  }

  private native(res: LegResult, sa: SnapResult, sb: SnapResult, r0: number, r1: number, c0: number, c1: number,
                 mask: Uint8Array | null = null): LegResult | null {
    const surf = nativeSurface(this.terrain, this.ctx, r0, r1, c0, c1, mask);
    const nx = c1 - c0;
    const start = (sa.row - r0) * nx + (sa.col - c0), goal = (sb.row - r0) * nx + (sb.col - c0);
    let dxMin = Infinity;
    for (const v of surf.geometry.dxMRows) dxMin = Math.min(dxMin, v);
    const sr = astar(new EdgeModel(surf, this.ctx), start, goal, surf.geometry.dyM, dxMin, this.ctx.lowerBoundPerM);
    if (!sr) return null;
    res.expanded += sr.expanded;
    const free = mask ? nativeSurface(this.terrain, this.ctx, r0, r1, c0, c1) : surf;
    return this.finish(res, free, sr.path, sa, sb);
  }

  private coarseToFine(res: LegResult, sa: SnapResult, sb: SnapResult, r0: number, r1: number, c0: number, c1: number): LegResult | null {
    const ctx = this.ctx;
    const rows = r1 - r0, cols = c1 - c0;
    let f = Math.max(2, Math.ceil(Math.sqrt(rows * cols / ctx.config.maxSearchCells)));
    f = Math.min(f, Math.max(1, Math.floor(rows / 3)), Math.max(1, Math.floor(cols / 3)));
    const guide = guideSurface(this.terrain, ctx, r0, r1, c0, c1, f);
    const gnx = guide.nx, gny = guide.ny;
    const gs = Math.floor((sa.row - r0) / f) * gnx + Math.floor((sa.col - c0) / f);
    const gg = Math.floor((sb.row - r0) / f) * gnx + Math.floor((sb.col - c0) / f);
    let dxMin = Infinity;
    for (const v of guide.geometry.dxMRows) dxMin = Math.min(dxMin, v);
    const sr = astar(new EdgeModel(guide, ctx), gs, gg, guide.geometry.dyM, dxMin, ctx.lowerBoundPerM);
    if (!sr) return null;
    res.guideFactor = f;
    res.expanded += sr.expanded;
    const coarse = new Uint8Array(gny * gnx);
    for (const p of sr.path) coarse[p] = 1;
    let width = Math.max(1, ctx.config.refineCorridorCells);
    for (let attempt = 0; attempt < 4; attempt++) {
      let m = coarse.slice();
      for (let w = 0; w < width; w++) {
        const nm = new Uint8Array(gny * gnx);
        for (let i = 0; i < gny; i++) for (let j = 0; j < gnx; j++) {
          if (!m[i * gnx + j]) continue;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const a = i + di, b = j + dj;
            if (a >= 0 && a < gny && b >= 0 && b < gnx) nm[a * gnx + b] = 1;
          }
        }
        m = nm;
      }
      let br0 = Infinity, br1 = -Infinity, bc0 = Infinity, bc1 = -Infinity;
      let all = true;
      const native = new Uint8Array(rows * cols);
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const on = m[Math.floor(i / f) * gnx + Math.floor(j / f)];
        native[i * cols + j] = on;
        if (on) { br0 = Math.min(br0, i); br1 = Math.max(br1, i); bc0 = Math.min(bc0, j); bc1 = Math.max(bc1, j); }
        else all = false;
      }
      const R0 = r0 + br0, R1 = r0 + br1 + 1, C0 = c0 + bc0, C1 = c0 + bc1 + 1;
      const sub = new Uint8Array((R1 - R0) * (C1 - C0));
      for (let i = 0; i < R1 - R0; i++) for (let j = 0; j < C1 - C0; j++) sub[i * (C1 - C0) + j] = native[(i + br0) * cols + (j + bc0)];
      const out = this.native(res, sa, sb, R0, R1, C0, C1, sub);
      if (out) {
        out.notes.push(`searched ${rows}x${cols} cells via a ${f}x${f}-block guide, then refined on native ` +
          `${this.terrain.geometry.cellSizeM.toFixed(0)} m cells in a corridor`);
        return out;
      }
      if (all) break;
      width *= 2;
    }
    const out = this.native(res, sa, sb, r0, r1, c0, c1);
    if (out) out.notes.push(`searched all ${rows}x${cols} native cells after corridor refinement failed`);
    return out;
  }

  private finish(res: LegResult, surf: SearchSurface, path: number[], sa: SnapResult, sb: SnapResult): LegResult {
    const { nx, row0, col0 } = surf;
    let pts: Array<[number, number]> = [[sa.exact[0] - row0, sa.exact[1] - col0]];
    for (const p of path) pts.push([Math.floor(p / nx), p % nx]);
    pts.push([sb.exact[0] - row0, sb.exact[1] - col0]);
    const ev = new SegmentEvaluator(surf, this.ctx);
    let cost: number;
    if (this.ctx.config.smoothing) [pts, cost] = stringPull(pts, ev, this.ctx.config.smoothingTolerance);
    else cost = polylineCost(pts, ev)[1];
    const geo = surf.geometry;
    res.points = pts.map(([r, c]) => [geo.rowLat(r), geo.colLon(c)] as LatLon);
    res.cost = cost;
    res.ok = true;
    return res;
  }
}

export function directLineStats(t: TerrainGrid, ctx: RoutingContext, a: LatLon, b: LatLon) {
  const g = t.geometry;
  const L = haversineM(a[0], a[1], b[0], b[1], g.radiusM);
  let prohibited = 0, unknown = 0, smax = -Infinity;
  for (const [i, j, t0, t1] of supercover(g.rc(a[0], a[1]), g.rc(b[0], b[1]))) {
    if (!(i >= 0 && i < g.nrows && j >= 0 && j < g.ncols)) continue;
    const s = t.slopeDeg[i * g.ncols + j];
    const piece = (t1 - t0) * L;
    if (!Number.isFinite(s)) { unknown += piece; continue; }
    smax = Math.max(smax, s);
    if (s > ctx.maxSlopeDeg) prohibited += piece;
  }
  return {
    distance_m: Math.round(L * 10) / 10,
    max_terrain_slope_deg: Number.isFinite(smax) ? Math.round(smax * 10) / 10 : null,
    prohibited_length_m: Math.round(prohibited * 10) / 10,
    unknown_length_m: Math.round(unknown * 10) / 10,
    note: 'Straight line for reference only; it is not a planned route.',
  };
}

// --- profile -------------------------------------------------------------------------------------

export interface RouteProfile {
  lat: Float64Array; lon: Float64Array; leg: Int32Array; dist: Float64Array; elev: Float64Array;
  quality: Uint8Array; grade: Float64Array; terrainSlope: Float64Array; time: Float64Array;
  stepClass: SlopeClass[]; stepLen: Float64Array; stepDz: Float64Array; stepTime: Float64Array;
}

function classify(s: number): SlopeClass {
  if (!Number.isFinite(s)) return 'unknown';
  if (s < SLOPE_CLASS_FLAT_MAX) return 'flat';
  if (s < SLOPE_CLASS_MODERATE_MAX) return 'moderate';
  if (s < SLOPE_CLASS_STEEP_MAX) return 'steep';
  return 'hazardous';
}

function interp(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  let lo = 0, hi = xp.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xp[mid] <= x) lo = mid; else hi = mid; }
  const t = (x - xp[lo]) / (xp[hi] - xp[lo]);
  return fp[lo] + t * (fp[hi] - fp[lo]);
}

export function buildProfile(t: TerrainGrid, legs: LatLon[][], mobility: MobilityModel, maxSlopeDeg: number,
                             stepM?: number): RouteProfile {
  const R = t.geometry.radiusM;
  const step = stepM ?? t.geometry.cellSizeM;
  const lats: number[] = [], lons: number[] = [], legi: number[] = [];
  legs.forEach((pts, k) => {
    for (let s = 0; s < pts.length - 1; s++) {
      const p = pts[s], q = pts[s + 1];
      const L = haversineM(p[0], p[1], q[0], q[1], R);
      const n = Math.max(1, Math.ceil(L / step));
      const dlon = lonDelta(q[1], p[1]);
      for (let i = (k === 0 && s === 0) ? 0 : 1; i <= n; i++) {
        const tt = i / n;
        lats.push(p[0] + (q[0] - p[0]) * tt);
        lons.push(normalizeLon(p[1] + dlon * tt));
        legi.push(k);
      }
    }
    if (pts.length === 1 && k === 0) { lats.push(pts[0][0]); lons.push(pts[0][1]); legi.push(0); }
  });
  const n = lats.length;
  const lat = Float64Array.from(lats), lon = Float64Array.from(lons), leg = Int32Array.from(legi);
  const z = new Float64Array(n), quality = new Uint8Array(n);
  for (let i = 0; i < n; i++) { z[i] = t.sampleBilinear(lat[i], lon[i]); quality[i] = Number.isFinite(z[i]) ? 1 : 0; }
  const stepLen = new Float64Array(n), dist = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    stepLen[i] = haversineM(lat[i - 1], lon[i - 1], lat[i], lon[i], R);
    dist[i] = dist[i - 1] + stepLen[i];
  }
  const xp: number[] = [], fp: number[] = [];
  for (let i = 0; i < n; i++) if (quality[i]) { xp.push(dist[i]); fp.push(z[i]); }
  for (let i = 0; i < n; i++) if (!quality[i]) z[i] = xp.length ? interp(dist[i], xp, fp) : 0;
  const dz = new Float64Array(n), grade = new Float64Array(n), stepTime = new Float64Array(n), time = new Float64Array(n);
  const tanMax = Math.tan(maxSlopeDeg * DEG2RAD);
  for (let i = 1; i < n; i++) {
    dz[i] = z[i] - z[i - 1];
    if (stepLen[i] > 0) {
      grade[i] = dz[i] / stepLen[i];
      const both = quality[i] && quality[i - 1];
      stepTime[i] = mobility.minutes(stepLen[i], both ? grade[i] : tanMax);
    }
    time[i] = time[i - 1] + stepTime[i];
  }
  const ts = new Float64Array(n);
  for (let i = 0; i < n; i++) ts[i] = t.sampleNearest(t.slopeDeg, lat[i], lon[i]);
  const stepClass: SlopeClass[] = new Array(n);
  stepClass[0] = classify(ts[0]);
  for (let i = 1; i < n; i++) {
    const unk = !Number.isFinite(ts[i]) || !Number.isFinite(ts[i - 1]);
    stepClass[i] = unk ? 'unknown' : classify(Math.max(ts[i], ts[i - 1]));
  }
  return { lat, lon, leg, dist, elev: z, quality, grade, terrainSlope: ts, time, stepClass, stepLen, stepDz: dz, stepTime };
}

export const profileDistance = (p: RouteProfile) => p.dist[p.dist.length - 1];
export const profileTime = (p: RouteProfile) => p.time[p.time.length - 1];
export function profile3d(p: RouteProfile): number {
  let s = 0;
  for (let i = 0; i < p.stepLen.length; i++) s += Math.sqrt(p.stepLen[i] ** 2 + p.stepDz[i] ** 2);
  return s;
}
export function profileGainLoss(p: RouteProfile, mask?: (i: number) => boolean): [number, number] {
  let g = 0, l = 0;
  for (let i = 0; i < p.stepDz.length; i++) {
    if (mask && !mask(i)) continue;
    if (p.stepDz[i] > 0) g += p.stepDz[i]; else l -= p.stepDz[i];
  }
  return [g, l];
}
export function profileMaxTerrainSlope(p: RouteProfile): number {
  let m = -Infinity;
  for (const v of p.terrainSlope) if (Number.isFinite(v)) m = Math.max(m, v);
  return Number.isFinite(m) ? m : NaN;
}

export function summaryFractions(p: RouteProfile, mask?: (i: number) => boolean): Record<SlopeClass, number> {
  const acc: Record<SlopeClass, number> = { flat: 0, moderate: 0, steep: 0, hazardous: 0, unknown: 0 };
  let tot = 0;
  for (let i = 0; i < p.stepLen.length; i++) {
    if (mask && !mask(i)) continue;
    tot += p.stepLen[i];
    acc[p.stepClass[i]] += p.stepLen[i];
  }
  for (const k of Object.keys(acc) as SlopeClass[]) acc[k] = tot > 0 ? acc[k] / tot : 0;
  return acc;
}

export function legStats(p: RouteProfile, k: number) {
  const sel = (i: number) => i > 0 && p.leg[i] === k;
  let dist = 0, time = 0, along = 0, tsSum = 0, tsLen = 0, tsMax = -Infinity, unknownM = 0;
  for (let i = 0; i < p.stepLen.length; i++) {
    if (!sel(i)) continue;
    const ln = p.stepLen[i];
    dist += ln;
    time += p.stepTime[i];
    along += Math.atan(Math.abs(p.grade[i])) * RAD2DEG * ln;
    const s = p.terrainSlope[i];
    if (Number.isFinite(s)) { tsSum += s * ln; tsLen += ln; tsMax = Math.max(tsMax, s); }
    if (p.stepClass[i] === 'unknown') unknownM += ln;
  }
  const [gain, loss] = profileGainLoss(p, sel);
  return {
    distance_m: dist, time_min: time,
    mean_along_track_slope_deg: dist > 0 ? along / dist : 0,
    mean_terrain_slope_deg: tsLen > 0 ? tsSum / tsLen : NaN,
    max_terrain_slope_deg: Number.isFinite(tsMax) ? tsMax : NaN,
    gain_m: gain, loss_m: loss, unknown_m: unknownM, fractions: summaryFractions(p, sel),
  };
}

export { pmod };
