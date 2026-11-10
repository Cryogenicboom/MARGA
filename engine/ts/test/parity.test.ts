/**
 * The TypeScript port must reproduce the Python engine's golden vectors
 * (engine/tools/export_golden_vectors.py) on the same terrain package.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, planRoute, terrainFromPackage, withOverrides } from '../../../shared/engine/index.ts';
import type { TerrainPackageJson } from '../../../shared/engine/index.ts';
import type { EngineRouteRequest } from '../../../shared/types/engine.ts';

const here = dirname(fileURLToPath(import.meta.url));
// The same package the browser loads (frontend/public/terrain/gale), so parity covers the shipped data.
const pkg = join(here, '..', '..', '..', 'frontend', 'public', 'terrain', 'gale');
const meta = JSON.parse(readFileSync(join(pkg, 'terrain.json'), 'utf8')) as TerrainPackageJson;
const raw = (file: string) => {
  const b = readFileSync(join(pkg, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const terrain = terrainFromPackage(meta, raw(meta.layers.elevation.file),
  meta.layers.roughness ? raw(meta.layers.roughness.file) : null);
const cases = JSON.parse(readFileSync(join(here, 'golden', 'cases.json'), 'utf8'));

const near = (a: number, b: number, tol: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ts ${a} vs py ${b} (tol ${tol})`);

for (const c of cases) {
  test(`parity: ${c.name}`, () => {
    const r = planRoute(c.request as EngineRouteRequest, terrain, withOverrides(DEFAULT_CONFIG, c.config));
    const e = c.expected;
    assert.equal(r.status, e.status);
    assert.equal(r.status_reason ?? null, e.status_reason ?? null);
    assert.equal(r.warnings.length, e.warnings.length, `warnings: ${JSON.stringify(r.warnings)}`);
    for (const k of ['distance_m', 'distance_3d_m', 'elevation_gain_m', 'elevation_loss_m', 'estimated_time_min',
      'eva_budget_used_percent', 'return_margin_min'] as const) {
      near(r[k], e[k], Math.max(1, Math.abs(e[k]) * 0.002), k);
    }
    for (const k of Object.keys(e.terrain_summary)) {
      near((r.terrain_summary as unknown as Record<string, number>)[k], e.terrain_summary[k], 1, `terrain_summary.${k}`);
    }
    assert.equal(r.segments.length, e.segments.length);
    r.segments.forEach((s, i) => {
      assert.equal(s.from_name, e.segments[i].from_name);
      near(s.distance_m, e.segments[i].distance_m, 2, 'segment distance');
      near(s.estimated_time_min, e.segments[i].estimated_time_min, 1, 'segment time');
    });
    if (e.coordinates.length) {
      assert.deepEqual(r.coordinates[0], e.coordinates[0]);
      assert.deepEqual(r.coordinates[r.coordinates.length - 1], e.coordinates[e.coordinates.length - 1]);
      assert.equal(r.coordinates.length, e.coordinates.length, "same path vertices");
      {
        r.coordinates.forEach((p, i) => {
          near(p[0], e.coordinates[i][0], 1e-6, 'lon');
          near(p[1], e.coordinates[i][1], 1e-6, 'lat');
        });
      }
    }
    if (e.eva_assessment) {
      for (const k of ['outbound_min', 'return_min', 'science_min', 'return_margin_min', 'mission_time_min']) {
        near((r.eva_assessment as unknown as Record<string, number>)[k], e.eva_assessment[k], 0.25, `eva.${k}`);
      }
      assert.equal(r.eva_assessment!.status, e.eva_assessment.status);
    }
    assert.equal(r.elevation_profile.length, e.profile_len, 'profile length');
    (e.profile_head as Array<{ distance_m: number; elevation_m: number }>).forEach((q, i) => {
      assert.ok(Number.isInteger(r.elevation_profile[i].distance_m) && Number.isInteger(r.elevation_profile[i].elevation_m));
      near(r.elevation_profile[i].distance_m, q.distance_m, 1, 'profile distance');
      near(r.elevation_profile[i].elevation_m, q.elevation_m, 1, 'profile elevation');
    });
    if (e.mission_summary) {
      const m = r.mission_summary!;
      assert.equal(m.route_status, e.mission_summary.route_status);
      assert.deepEqual(m.targets, e.mission_summary.targets);
      assert.deepEqual(m.dataset_references, e.mission_summary.dataset_references);
      for (const k of ['total_distance_m', 'estimated_travel_time_min', 'estimated_working_time_min',
        'estimated_return_time_min', 'return_margin_min'] as const) near(m[k], e.mission_summary[k], 1, `mission_summary.${k}`);
    } else assert.equal(r.mission_summary, undefined);
    if (e.dose_msv !== undefined) near(r.radiation!.planned_activity.dose_equivalent_msv, e.dose_msv, 2e-4, 'dose');
    if (e.return) near(r.return_route!.distance_m!, e.return.distance_m, 1, 'return distance');
    if (e.alternatives) {
      for (const [k, v] of Object.entries(e.alternatives as Record<string, { route_cost: number } | null>)) {
        const got = (r.alternatives as unknown as Record<string, { route_cost: number } | null>)[k];
        if (v === null) assert.equal(got, null);
        else near(got!.route_cost, v.route_cost, Math.max(0.05, v.route_cost * 1e-6), `alt ${k} cost`);
      }
    }
  });
}
