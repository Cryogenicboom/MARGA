/**
 * Edge costs, A*, Dijkstra and string pulling (mirror of marga_engine/routing/{costs,astar,smoothing}.py).
 *
 * Terrain-aware edge cost:  C = L (1 + w_s P_s + w_r P_r + w_u P_u), P averaged over the two cells,
 *   P_s = (S / S_max)^p, P_r = min(1, r / r_ref), P_u = 1 on unknown cells (penalize policy).
 * A*: f = g + h, h = anisotropic octile distance x minimum cost per metre (admissible, consistent).
 * 8-connected, no corner cutting. Deterministic tie-break (f, h, insertion order).
 */
import type { RouteMetric, UnknownPolicy } from '../types/engine.ts';
import type { CostWeights, EngineConfig } from './config.ts';
import { DEG2RAD } from './geodesy.ts';
import { MobilityModel } from './eva.ts';
import { EngineError, GridGeometry, TerrainGrid } from './terrain.ts';

export const MOVES: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
];
export const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];

export class RoutingContext {
  readonly metric: RouteMetric;
  readonly maxSlopeDeg: number;
  readonly weights: CostWeights;
  readonly unknownPolicy: UnknownPolicy;
  readonly mobility: MobilityModel;
  readonly config: EngineConfig;
  readonly roughness: Float32Array | null;
  readonly roughnessNote: string;
  constructor(metric: RouteMetric, maxSlopeDeg: number, weights: CostWeights, unknownPolicy: UnknownPolicy,
              mobility: MobilityModel, config: EngineConfig, roughness: Float32Array | null, roughnessNote: string) {
    if (!['terrain', 'distance', 'time'].includes(metric)) throw new EngineError('input', `unknown route metric '${metric}'`);
    if (!['exclude', 'penalize'].includes(unknownPolicy)) throw new EngineError('input', `unknown unknown_policy '${unknownPolicy}'`);
    if (!(maxSlopeDeg > 0 && maxSlopeDeg < 90)) throw new EngineError('input', 'maxSlopeDegrees must be between 0 and 90');
    if (Math.min(weights.slope, weights.roughness, weights.uncertainty) < 0 || weights.slopeExponent <= 0) {
      throw new EngineError('input', 'cost weights must be non-negative and slope_exponent positive');
    }
    this.metric = metric; this.maxSlopeDeg = maxSlopeDeg; this.weights = weights; this.unknownPolicy = unknownPolicy;
    this.mobility = mobility; this.config = config; this.roughness = roughness; this.roughnessNote = roughnessNote;
  }
  withMetric(metric: RouteMetric): RoutingContext {
    return new RoutingContext(metric, this.maxSlopeDeg, this.weights, this.unknownPolicy, this.mobility, this.config,
      this.roughness, this.roughnessNote);
  }
  get lowerBoundPerM(): number {
    return this.metric === 'time' ? this.mobility.minMinutesPerM : 1.0;
  }
}

export interface SearchSurface {
  geometry: GridGeometry;
  row0: number;
  col0: number;
  factor: number;
  ny: number;
  nx: number;
  elev: Float64Array;
  slope: Float64Array;
  rough: Float64Array | null;
  known: Uint8Array;
  passable: Uint8Array;
}

export function nativePassable(t: TerrainGrid, ctx: RoutingContext): Uint8Array {
  const n = t.elevation.length;
  const s = t.slopeDeg;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const known = Number.isFinite(t.elevation[i]) && Number.isFinite(s[i]);
    out[i] = (known && s[i] <= ctx.maxSlopeDeg) || (!known && ctx.unknownPolicy === 'penalize') ? 1 : 0;
  }
  return out;
}

export function nativeSurface(t: TerrainGrid, ctx: RoutingContext, r0: number, r1: number, c0: number, c1: number,
                              mask: Uint8Array | null = null): SearchSurface {
  const g = t.geometry;
  const ny = r1 - r0, nx = c1 - c0;
  const elev = new Float64Array(ny * nx), slope = new Float64Array(ny * nx);
  const known = new Uint8Array(ny * nx), passable = new Uint8Array(ny * nx);
  const rough = ctx.roughness ? new Float64Array(ny * nx) : null;
  const S = t.slopeDeg;
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const src = (r + r0) * g.ncols + (c + c0), k = r * nx + c;
      elev[k] = t.elevation[src];
      slope[k] = S[src];
      const kn = Number.isFinite(elev[k]) && Number.isFinite(slope[k]);
      known[k] = kn ? 1 : 0;
      let p = (kn && slope[k] <= ctx.maxSlopeDeg) || (!kn && ctx.unknownPolicy === 'penalize');
      if (mask) p = p && mask[k] === 1;
      passable[k] = p ? 1 : 0;
      if (rough && ctx.roughness) rough[k] = ctx.roughness[src];
    }
  }
  return { geometry: g.window(r0, r1, c0, c1), row0: r0, col0: c0, factor: 1, ny, nx, elev, slope, rough, known, passable };
}

/** Block relaxation: a block is traversable if ANY native cell is; fields are means over those cells. */
export function guideSurface(t: TerrainGrid, ctx: RoutingContext, r0: number, r1: number, c0: number, c1: number,
                             f: number): SearchSurface {
  const g = t.geometry;
  const rows = r1 - r0, cols = c1 - c0;
  const gny = Math.ceil(rows / f), gnx = Math.ceil(cols / f);
  const n = gny * gnx;
  const anyPass = new Uint8Array(n);
  const sumE = new Float64Array(n), cntE = new Float64Array(n);
  const sumS = new Float64Array(n), cntS = new Float64Array(n);
  const sumR = new Float64Array(n), cntR = new Float64Array(n);
  const S = t.slopeDeg;
  // _blocks pads partial blocks by edge replication, so replicated cells count again in the means
  for (let br = 0; br < gny; br++) {
    for (let bc = 0; bc < gnx; bc++) {
      const k = br * gnx + bc;
      for (let i = 0; i < f; i++) {
        for (let j = 0; j < f; j++) {
          const rr = Math.min(br * f + i, rows - 1), cc = Math.min(bc * f + j, cols - 1);
          const src = (rr + r0) * g.ncols + (cc + c0);
          const e = t.elevation[src], s = S[src];
          const kn = Number.isFinite(e) && Number.isFinite(s);
          const p = (kn && s <= ctx.maxSlopeDeg) || (!kn && ctx.unknownPolicy === 'penalize');
          if (!p) continue;
          anyPass[k] = 1;
          if (Number.isFinite(e)) { sumE[k] += e; cntE[k] += 1; }
          if (Number.isFinite(s)) { sumS[k] += s; cntS[k] += 1; }
          if (ctx.roughness) {
            const rv = ctx.roughness[src];
            if (Number.isFinite(rv)) { sumR[k] += rv; cntR[k] += 1; }
          }
        }
      }
    }
  }
  const elev = new Float64Array(n), slope = new Float64Array(n), known = new Uint8Array(n);
  const rough = ctx.roughness ? new Float64Array(n) : null;
  for (let k = 0; k < n; k++) {
    elev[k] = cntE[k] > 0 ? sumE[k] / Math.max(cntE[k], 1) : NaN;
    const sv = cntS[k] > 0 ? sumS[k] / Math.max(cntS[k], 1) : NaN;
    known[k] = Number.isFinite(elev[k]) && Number.isFinite(sv) ? 1 : 0;
    slope[k] = Math.min(sv, ctx.maxSlopeDeg);
    if (Number.isNaN(sv)) slope[k] = NaN;
    if (rough) rough[k] = cntR[k] > 0 ? sumR[k] / Math.max(cntR[k], 1) : NaN;
  }
  const geom = g.window(r0, r1, c0, c1).coarsen(f);
  return { geometry: geom, row0: r0, col0: c0, factor: f, ny: gny, nx: gnx, elev, slope, rough, known, passable: anyPass };
}

export function cellPenaltyFactor(s: SearchSurface, ctx: RoutingContext): Float64Array {
  const n = s.ny * s.nx;
  const F = new Float64Array(n);
  if (ctx.metric !== 'terrain') { F.fill(1); return F; }
  const w = ctx.weights;
  for (let k = 0; k < n; k++) {
    const kn = s.known[k] === 1;
    const sv = Number.isFinite(s.slope[k]) ? s.slope[k] : 0;
    const ps = kn ? Math.pow(Math.min(Math.max(sv / ctx.maxSlopeDeg, 0), 1), w.slopeExponent) : 1.0;
    let f = 1.0 + w.slope * ps;
    if (s.rough) {
      const rv = s.rough[k];
      const pr = kn && Number.isFinite(rv) ? Math.min(Math.max((Number.isFinite(rv) ? rv : 0) / ctx.config.roughnessRefM, 0), 1) : 1.0;
      f = f + w.roughness * pr;
    }
    if (ctx.unknownPolicy === 'penalize') f = f + w.uncertainty * (kn ? 0 : 1);
    F[k] = f;
  }
  return F;
}

const DI = Int8Array.from(MOVES.map((m) => m[0]));
const DJ = Int8Array.from(MOVES.map((m) => m[1]));

/**
 * Edge costs evaluated on demand. A* only ever looks at the edges of cells it expands - usually a
 * small fraction of the window - so nothing is precomputed per edge (the Python engine builds the
 * full 8-direction tensor with numpy instead). The arithmetic is identical in both engines.
 */
export class EdgeModel {
  readonly s: SearchSurface;
  readonly ctx: RoutingContext;
  readonly F: Float64Array | null;
  private readonly lew: Float64Array;   // E-W step length per row
  private readonly ldn: Float64Array;   // diagonal step length from row i to i+1
  private readonly lup: Float64Array;   // diagonal step length from row i to i-1
  private readonly dy: number;
  private readonly tanMax: number;
  constructor(s: SearchSurface, ctx: RoutingContext) {
    this.s = s;
    this.ctx = ctx;
    this.F = ctx.metric === 'terrain' ? cellPenaltyFactor(s, ctx) : null;
    const dx = s.geometry.dxMRows;
    const dy = s.geometry.dyM;
    this.dy = dy;
    this.lew = dx;
    this.ldn = new Float64Array(s.ny);
    this.lup = new Float64Array(s.ny);
    for (let i = 0; i < s.ny; i++) {
      if (i + 1 < s.ny) this.ldn[i] = Math.hypot(dy, (dx[i] + dx[i + 1]) / 2.0);
      if (i > 0) this.lup[i] = Math.hypot(dy, (dx[i] + dx[i - 1]) / 2.0);
    }
    this.tanMax = Math.tan(ctx.maxSlopeDeg * DEG2RAD);
  }

  /** Cost of leaving cell u in direction MOVES[k]; Infinity when the edge does not exist. */
  cost(u: number, k: number): number {
    const s = this.s;
    const nx = s.nx;
    const i = (u / nx) | 0;
    const j = u - i * nx;
    const di = DI[k], dj = DJ[k];
    const vi = i + di, vj = j + dj;
    if (vi < 0 || vi >= s.ny || vj < 0 || vj >= nx) return Infinity;
    const pas = s.passable;
    const v = vi * nx + vj;
    if (!pas[u] || !pas[v]) return Infinity;
    let L: number;
    if (di === 0) L = this.lew[i];
    else if (dj === 0) L = this.dy;
    else {
      if (!pas[vi * nx + j] || !pas[i * nx + vj]) return Infinity;   // no corner cutting
      L = di > 0 ? this.ldn[i] : this.lup[i];
    }
    const metric = this.ctx.metric;
    if (metric === 'distance') return L;
    if (metric === 'terrain') return (L * (this.F![u] + this.F![v])) / 2.0;
    const grade = s.known[u] && s.known[v] ? (s.elev[v] - s.elev[u]) / L : this.tanMax;
    return this.ctx.mobility.minutes(L, grade);
  }
}

/** Full (8, cells) tensor - for tests and tools; routing uses EdgeModel lazily. */
export function edgeCosts(s: SearchSurface, ctx: RoutingContext): Float64Array[] {
  const m = new EdgeModel(s, ctx);
  const n = s.ny * s.nx;
  const out: Float64Array[] = [];
  for (let k = 0; k < 8; k++) {
    const a = new Float64Array(n);
    for (let u = 0; u < n; u++) a[u] = m.cost(u, k);
    out.push(a);
  }
  return out;
}

// --- A* ------------------------------------------------------------------------------------------

/** Binary min-heap on (f, h, insertion counter) held in growable typed arrays. */
class Heap {
  private f = new Float64Array(1024);
  private h = new Float64Array(1024);
  private c = new Float64Array(1024);
  private v = new Int32Array(1024);
  size = 0;
  topKey = 0;
  private less(a: number, b: number): boolean {
    const f = this.f, h = this.h;
    if (f[a] !== f[b]) return f[a] < f[b];
    if (h[a] !== h[b]) return h[a] < h[b];
    return this.c[a] < this.c[b];
  }
  private set(i: number, f: number, h: number, c: number, v: number) {
    this.f[i] = f; this.h[i] = h; this.c[i] = c; this.v[i] = v;
  }
  private grow() {
    const n = this.f.length * 2;
    const f = new Float64Array(n); f.set(this.f); this.f = f;
    const h = new Float64Array(n); h.set(this.h); this.h = h;
    const c = new Float64Array(n); c.set(this.c); this.c = c;
    const v = new Int32Array(n); v.set(this.v); this.v = v;
  }
  push(f: number, h: number, c: number, v: number) {
    if (this.size === this.f.length) this.grow();
    let i = this.size++;
    this.set(i, f, h, c, v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  private swap(a: number, b: number) {
    const f = this.f[a], h = this.h[a], c = this.c[a], v = this.v[a];
    this.set(a, this.f[b], this.h[b], this.c[b], this.v[b]);
    this.set(b, f, h, c, v);
  }
  /** Removes the minimum; returns its node and leaves its first key in topKey. */
  pop(): number {
    const node = this.v[0];
    this.topKey = this.f[0];
    const last = --this.size;
    if (last > 0) {
      this.set(0, this.f[last], this.h[last], this.c[last], this.v[last]);
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return node;
  }
}

export function octile(nx: number, dy: number, dxMin: number, goal: number, scale: number) {
  const gi = Math.floor(goal / nx), gj = goal % nx;
  const diag = Math.hypot(dy, dxMin);
  return (n: number): number => {
    const i = Math.floor(n / nx), j = n % nx;
    const b = Math.abs(i - gi), a = Math.abs(j - gj);
    if (a >= b) return scale * (b * diag + (a - b) * dxMin);
    return scale * (a * diag + (b - a) * dy);
  };
}

export interface SearchResult { path: number[]; cost: number; expanded: number }

export function astar(model: EdgeModel, start: number, goal: number, dy: number, dxMin: number,
                      scale: number): SearchResult | null {
  const { ny, nx } = model.s;
  const n = ny * nx;
  if (!(start >= 0 && start < n && goal >= 0 && goal < n)) throw new EngineError('engine', 'start/goal outside the search grid');
  const offs = MOVES.map(([di, dj]) => di * nx + dj);
  const h = octile(nx, dy, dxMin, goal, scale);
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  g[start] = 0;
  const heap = new Heap();
  const h0 = h(start);
  heap.push(h0, h0, 0, start);
  let counter = 1, expanded = 0;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    if (u === goal) {
      const path = [u];
      while (path[path.length - 1] !== start) path.push(came[path[path.length - 1]]);
      path.reverse();
      return { path, cost: g[goal], expanded };
    }
    closed[u] = 1;
    expanded++;
    const gu = g[u];
    for (let k = 0; k < 8; k++) {
      const c = model.cost(u, k);
      if (c === Infinity) continue;
      const v = u + offs[k];
      if (closed[v]) continue;
      const nv = gu + c;
      if (nv < g[v]) {
        g[v] = nv;
        came[v] = u;
        const hv = h(v);
        heap.push(nv + hv, hv, counter++, v);
      }
    }
  }
  return null;
}

/** Cost between `source` and every cell; reverse=true gives cost cell -> source (return-to-habitat field). */
export function dijkstraField(model: EdgeModel, source: number, reverse = false): Float64Array {
  const { ny, nx } = model.s;
  const n = ny * nx;
  const offs = MOVES.map(([di, dj]) => di * nx + dj);
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[source] = 0;
  const heap = new Heap();
  heap.push(0, 0, 0, source);
  let counter = 1;
  while (heap.size) {
    const u = heap.pop();
    const d = heap.topKey;
    if (done[u]) continue;
    done[u] = 1;
    for (let k = 0; k < 8; k++) {
      if (model.cost(u, k) === Infinity) continue;
      const v = u + offs[k];
      const c = reverse ? model.cost(v, OPPOSITE[k]) : model.cost(u, k);
      if (c === Infinity || done[v]) continue;
      const nd = d + c;
      if (nd < dist[v]) { dist[v] = nd; heap.push(nd, 0, counter++, v); }
    }
  }
  return dist;
}

// --- straightening ----------------------------------------------------------------------------

const EPS = 1e-12;
type RC = [number, number];

/** Cells crossed by p -> q (row, col; centres at integers) as [row, col, t0, t1]; corner touches have t0 == t1. */
export function supercover(p: RC, q: RC): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const R0 = p[0] + 0.5, C0 = p[1] + 0.5, R1 = q[0] + 0.5, C1 = q[1] + 0.5;
  const dr = R1 - R0, dc = C1 - C0;
  let i = Math.floor(R0), j = Math.floor(C0);
  const ie = Math.floor(R1), je = Math.floor(C1);
  const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
  const sc = dc > 0 ? 1 : dc < 0 ? -1 : 0;
  let tMaxR = sr ? (dr > 0 ? (i + 1 - R0) / dr : (R0 - i) / -dr) : Infinity;
  let tMaxC = sc ? (dc > 0 ? (j + 1 - C0) / dc : (C0 - j) / -dc) : Infinity;
  const tDr = sr ? Math.abs(1.0 / dr) : Infinity;
  const tDc = sc ? Math.abs(1.0 / dc) : Infinity;
  let t = 0.0;
  const guard = Math.abs(ie - i) + Math.abs(je - j) + 4;
  for (let it = 0; it < guard * 2 + 4; it++) {
    const tNext = Math.min(tMaxR, tMaxC, 1.0);
    out.push([i, j, t, tNext]);
    if (tNext >= 1.0 || (i === ie && j === je)) return out;
    if (Math.abs(tMaxR - tMaxC) <= 1e-9) {
      out.push([i + sr, j, tNext, tNext]);
      out.push([i, j + sc, tNext, tNext]);
      i += sr; j += sc; tMaxR += tDr; tMaxC += tDc;
    } else if (tMaxR < tMaxC) {
      i += sr; tMaxR += tDr;
    } else {
      j += sc; tMaxC += tDc;
    }
    t = tNext;
  }
  return out;
}

export class SegmentEvaluator {
  readonly s: SearchSurface;
  readonly ctx: RoutingContext;
  readonly F: Float64Array;
  readonly dx: Float64Array;
  readonly dy: number;
  readonly tanMax: number;
  constructor(s: SearchSurface, ctx: RoutingContext) {
    this.s = s; this.ctx = ctx; this.F = cellPenaltyFactor(s, ctx);
    this.dx = s.geometry.dxMRows; this.dy = s.geometry.dyM; this.tanMax = Math.tan(ctx.maxSlopeDeg * DEG2RAD);
  }
  private z(r: number, c: number): number {
    const { ny, nx, elev } = this.s;
    r = Math.min(Math.max(r, 0.0), ny - 1.0);
    c = Math.min(Math.max(c, 0.0), nx - 1.0);
    const r0 = Math.min(Math.trunc(r), ny - 2), c0 = Math.min(Math.trunc(c), nx - 2);
    const fr = r - r0, fc = c - c0;
    return ((elev[r0 * nx + c0] * (1 - fc) + elev[r0 * nx + c0 + 1] * fc) * (1 - fr)
      + (elev[(r0 + 1) * nx + c0] * (1 - fc) + elev[(r0 + 1) * nx + c0 + 1] * fc) * fr);
  }
  evaluate(p: RC, q: RC): [boolean, number] {
    const dr = q[0] - p[0], dc = q[1] - p[1];
    if (Math.abs(dr) < EPS && Math.abs(dc) < EPS) return [true, 0.0];
    const { ny, nx, passable } = this.s;
    let total = 0.0;
    for (const [i, j, t0, t1] of supercover(p, q)) {
      if (!(i >= 0 && i < ny && j >= 0 && j < nx) || !passable[i * nx + j]) return [false, Infinity];
      if (t1 - t0 <= EPS) continue;
      const ln = (t1 - t0) * Math.hypot(dr * this.dy, dc * this.dx[i]);
      if (this.ctx.metric === 'distance') total += ln;
      else if (this.ctx.metric === 'terrain') total += ln * this.F[i * nx + j];
      else {
        const za = this.z(p[0] + dr * t0, p[1] + dc * t0);
        const zb = this.z(p[0] + dr * t1, p[1] + dc * t1);
        const g = Number.isNaN(za) || Number.isNaN(zb) ? this.tanMax : (zb - za) / ln;
        total += this.ctx.mobility.minutes(ln, g);
      }
    }
    return [true, total];
  }
}

function compress(points: RC[]): RC[] {
  if (points.length <= 2) return points;
  const out: RC[] = [points[0]];
  for (let k = 1; k < points.length - 1; k++) {
    const a = points[k - 1], b = points[k], c = points[k + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) > 1e-9 || dot < 0) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function stringPull(points: RC[], ev: SegmentEvaluator, tolerance = 0.0, lookahead = 96): [RC[], number] {
  const pts = compress(points);
  const n = pts.length;
  const seg: number[] = [];
  for (let k = 0; k < n - 1; k++) seg.push(ev.evaluate(pts[k], pts[k + 1])[1]);
  const prefix = [0.0];
  for (const c of seg) prefix.push(prefix[prefix.length - 1] + c);
  const out: RC[] = [pts[0]];
  let total = 0.0, i = 0;
  while (i < n - 1) {
    let bestJ = i + 1, bestC = seg[i];
    for (let j = Math.min(n - 1, i + lookahead); j > i + 1; j--) {
      const [clear, c] = ev.evaluate(pts[i], pts[j]);
      if (clear && c <= (prefix[j] - prefix[i]) * (1.0 + tolerance) + 1e-9) { bestJ = j; bestC = c; break; }
    }
    out.push(pts[bestJ]);
    total += bestC;
    i = bestJ;
  }
  return [out, total];
}

export function polylineCost(points: RC[], ev: SegmentEvaluator): [boolean, number] {
  let total = 0.0, clear = true;
  for (let k = 0; k < points.length - 1; k++) {
    const [ok, c] = ev.evaluate(points[k], points[k + 1]);
    clear = clear && ok;
    total += c;
  }
  return [clear, total];
}
