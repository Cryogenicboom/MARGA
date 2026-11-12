/** Known-answer tests for the TypeScript port on small artificial grids. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, GridGeometry, LegPlanner, MobilityModel, RoutingContext, TerrainGrid, assessEva, connectedComponents,
  EdgeModel, decodeLayer, edgeCosts, estimateDose, haversineM, hornSlope, planRoute, traversability,
} from '../../../shared/engine/index.ts';
import { nativeSurface } from '../../../shared/engine/routing.ts';

const R = 3396190;
const D = Math.PI / 180;

function grid(z: number[][], cell = 20, lat0 = -4.6, lon0 = 137.4) {
  const ny = z.length, nx = z[0].length;
  const dlat = cell / R / D, dlon = cell / (R * Math.cos(lat0 * D)) / D;
  const g = new GridGeometry(lat0 + (ny - 1) / 2 * dlat, lon0 - (nx - 1) / 2 * dlon, dlat, dlon, ny, nx, R);
  return new TerrainGrid(Float32Array.from(z.flat()), g,
    { dataset_id: 'SYNTH-TS', name: 'ts fixture', synthetic: true, limitations: ['SYNTHETIC'] });
}
const ctx = (t: TerrainGrid, metric: 'terrain' | 'distance' | 'time' = 'terrain', maxSlope = 15) => {
  const [rough, note] = t.roughnessLayer(DEFAULT_CONFIG.roughnessMaxCellM);
  return new RoutingContext(metric, maxSlope, DEFAULT_CONFIG.weights, 'exclude', new MobilityModel(1.2, DEFAULT_CONFIG.mobility),
    DEFAULT_CONFIG, rough, note);
};
const ll = (t: TerrainGrid, r: number, c: number): [number, number] => [t.geometry.rowLat(r), t.geometry.colLon(c)];
const fill = (ny: number, nx: number, f: (r: number, c: number) => number) =>
  Array.from({ length: ny }, (_, r) => Array.from({ length: nx }, (_, c) => f(r, c)));

test('Horn slope is exact on a 10 degree plane (edges included)', () => {
  const t = grid(fill(15, 15, (r) => -4500 + Math.tan(10 * D) * 20 * (14 - r)));
  const s = hornSlope(t.elevation, 15, 15, t.geometry.dyM, t.geometry.dxMRows);
  for (const v of s) assert.ok(Math.abs(v - 10) < 2e-3, String(v));
});

test('open ground route is the great circle', () => {
  const t = grid(fill(40, 60, () => -4500));
  const a = ll(t, 3.2, 4.4), b = ll(t, 35.7, 55.1);
  const r = new LegPlanner(t, ctx(t)).plan(a, b);
  assert.equal(r.points.length, 2);
  assert.ok(Math.abs(r.cost - haversineM(a[0], a[1], b[0], b[1])) < 1e-6);
});

test('route uses the gap in a cliff wall and never crosses it', () => {
  const t = grid(fill(41, 41, (r, c) => (c >= 20 && c <= 22 && !(r >= 31 && r <= 35) ? -4300 : -4500)));
  const r = new LegPlanner(t, ctx(t)).plan(ll(t, 5, 5), ll(t, 5, 35));
  assert.ok(r.ok);
  assert.ok(Math.max(...r.points.map((p) => t.geometry.rc(p[0], p[1])[0])) >= 30);
});

test('no corner cutting between diagonal blocks', () => {
  const t = grid(fill(5, 5, () => -4500));
  const c = ctx(t, 'distance');
  const s = nativeSurface(t, c, 0, 5, 0, 5);
  s.passable[1 * 5 + 2] = 0; s.passable[2 * 5 + 1] = 0;
  const costs = edgeCosts(s, c);
  assert.equal(costs[7][1 * 5 + 1], Infinity);
});

test('4-connected components: diagonal contact does not connect', () => {
  const lab = connectedComponents(Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0, 1]), 3, 3);
  assert.equal(new Set([lab[0], lab[2], lab[4], lab[6], lab[8]]).size, 5);
});

test('EVA margin and dose match the spec formulas', () => {
  const e = assessEva(90, 80, 480, 60, 120);
  assert.equal(e.return_margin_min, 130);
  assert.equal(e.status, 'within_budget');
  assert.equal(assessEva(150, 150, 400, 100).status, 'no_slack');
  assert.throws(() => assessEva(10, 10, 0, 0));
  assert.ok(Math.abs(estimateDose(240).dose_equivalent_msv - 0.1117) < 1e-4);
});

test('planRoute returns a contract-shaped failure for bad input', () => {
  const t = grid(fill(20, 20, () => -4500));
  const r = planRoute({ start: { latitude: 0, longitude: 0 } } as never, t);
  assert.equal(r.status, 'failed');
  assert.equal(r.status_reason, 'invalid_request');
  assert.ok(Array.isArray(r.coordinates) && r.terrain_summary.flat_pct === 0);
});

test('reserve not shorter than the EVA is an exceeded budget, not an error', () => {
  const e = assessEva(30, 30, 120, 240);
  assert.equal(e.status, 'exceeded');
  assert.equal(e.budget_used_percent, 999);
  assert.equal(assessEva(0, 0, 120, 120).budget_used_percent, 0);
  const t = grid(fill(40, 40, () => -4500));
  const [a, b] = [ll(t, 5, 5), ll(t, 30, 30)];
  const r = planRoute({
    start: { latitude: a[0], longitude: a[1], name: 'A' }, destination: { latitude: b[0], longitude: b[1], name: 'B' },
    constraints: { walkingSpeedKmh: 1.2, maxSlopeDegrees: 15, maxEvaHours: 2, reserveEvaHours: 4, maxDistanceMeters: 10000 },
  }, t);
  assert.equal(r.status, 'unreachable');
  assert.equal(r.status_reason, 'eva_budget_exceeded');
  assert.equal(r.eva_budget_used_percent, 999);
  assert.ok(r.coordinates.length >= 2, 'the route is still drawn');
  assert.ok(r.warnings.some((w) => w.includes('safety reserve')));
});

test('profile values are integers and a mission summary is attached', () => {
  const t = grid(fill(40, 40, (r, c) => -4500 + 3.3 * r + 1.7 * c));
  const [a, b] = [ll(t, 5, 5), ll(t, 30, 33)];
  const r = planRoute({
    start: { latitude: a[0], longitude: a[1], name: 'A' }, destination: { latitude: b[0], longitude: b[1], name: 'B' },
    constraints: { walkingSpeedKmh: 1.2, maxSlopeDegrees: 15, maxEvaHours: 8, reserveEvaHours: 1.5, maxDistanceMeters: 10000 },
    objective: { id: 'obj_x', title: 'Test objective' },
  }, t);
  for (const p of r.elevation_profile) assert.ok(Number.isInteger(p.distance_m) && Number.isInteger(p.elevation_m));
  const m = r.mission_summary!;
  assert.equal(m.total_distance_m, r.distance_m);
  assert.equal(m.estimated_travel_time_min, r.estimated_time_min);
  assert.equal(m.return_margin_min, r.return_margin_min);
  assert.deepEqual(m.objective, { id: 'obj_x', title: 'Test objective' });
  assert.deepEqual(m.targets, ['B']);
});

test('int16 layers decode with scale/offset and nodata -> NaN', () => {
  const q = Int16Array.from([0, 100, -32768, -100]);
  const z = decodeLayer({ file: 'x', dtype: 'int16', byte_order: 'little', scale: 0.05, offset: -4500, nodata: -32768 },
    q.buffer, 4);
  assert.ok(Math.abs(z[0] + 4500) < 1e-3 && Math.abs(z[1] + 4495) < 1e-3 && Number.isNaN(z[2]) && Math.abs(z[3] + 4505) < 1e-3);
  assert.throws(() => decodeLayer({ file: 'x', dtype: 'int16', byte_order: 'little', scale: 1, offset: 0, nodata: -32768 }, q.buffer, 5));
});

test('lazy edge model agrees with the precomputed tensor; traversability is cached per terrain', () => {
  const t = grid(fill(12, 14, (r, c) => -4500 + 9 * Math.sin(r / 2) * Math.cos(c / 3)));
  for (const metric of ['terrain', 'distance', 'time'] as const) {
    const c = ctx(t, metric, 10);
    const s = nativeSurface(t, c, 0, 12, 0, 14);
    const m = new EdgeModel(s, c), costs = edgeCosts(s, c);
    for (let k = 0; k < 8; k++) for (let u = 0; u < 12 * 14; u++) {
      const x = m.cost(u, k), y = costs[k][u];
      assert.ok(x === y || Math.abs(x - y) < 1e-12, `${metric} k${k} u${u}: ${x} vs ${y}`);
    }
  }
  const c = ctx(t);
  assert.equal(traversability(t, c), traversability(t, c));
});
