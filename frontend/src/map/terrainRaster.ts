/**
 * Turns the terrain grids handed over by the engine (elevation + Horn slope, see
 * services/engineHost.ts) into map images. Rendering only: no route values are computed here.
 *   - 'relief'    hillshade x elevation tint, with contours
 *   - 'elevation' elevation tint with contours, lightly shaded
 *   - 'slope'     the engine's slope classes, lightly shaded
 *   - 'hillshade' grey hillshade with contours
 *   - slope-hazard overlay: cells the router will not enter at the current slope limit
 * Pixels map 1:1 to terrain cells (row 0 = north), so images line up with the routing grid.
 */
import type { TerrainLayers } from '../services/routeService';
import { SLOPE_CLASS_COLORS, slopeClass } from './mapStyles';

export type ReliefStyle = 'relief' | 'elevation' | 'slope' | 'hillshade';

/** Elevation ramp, low to high: dark basalt, rust, ochre, pale dust. */
export const ELEVATION_RAMP: ReadonlyArray<readonly [number, [number, number, number]]> = [
  [0.0, [52, 30, 22]],
  [0.3, [112, 58, 34]],
  [0.6, [176, 108, 58]],
  [0.85, [214, 160, 104]],
  [1.0, [236, 206, 160]],
];

export const ELEVATION_RAMP_CSS = `linear-gradient(to right, ${ELEVATION_RAMP.map(
  ([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`,
).join(', ')})`;

export const HAZARD_COLORS = {
  impassable: [224, 108, 95, 160] as const, // steeper than the limit
  nearLimit: [217, 164, 65, 80] as const, // within NEAR_LIMIT_DEG of the limit
  noData: [8, 10, 14, 200] as const, // unknown terrain (the router avoids it)
};
export const NEAR_LIMIT_DEG = 3;

const DEG = Math.PI / 180;
const MARS_R = 3396190;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const SLOPE_RGB = {
  flat: hexRgb(SLOPE_CLASS_COLORS.flat),
  moderate: hexRgb(SLOPE_CLASS_COLORS.moderate),
  steep: hexRgb(SLOPE_CLASS_COLORS.steep),
  hazardous: hexRgb(SLOPE_CLASS_COLORS.hazardous),
  unknown: hexRgb(SLOPE_CLASS_COLORS.unknown),
};

function rampColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < ELEVATION_RAMP.length; i++) {
    const [t1, c1] = ELEVATION_RAMP[i];
    if (x <= t1) {
      const [t0, c0] = ELEVATION_RAMP[i - 1];
      const f = (x - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return [...ELEVATION_RAMP[ELEVATION_RAMP.length - 1][1]];
}

function cellSpacingM(t: TerrainLayers): { dy: number; dx: Float64Array } {
  const dy = MARS_R * t.dlatDeg * DEG;
  const dx = new Float64Array(t.nrows);
  for (let r = 0; r < t.nrows; r++) dx[r] = MARS_R * Math.cos((t.northLat - r * t.dlatDeg) * DEG) * t.dlonDeg * DEG;
  return { dy, dx };
}

function toDataUrl(t: TerrainLayers, rgba: Uint8ClampedArray): string {
  const canvas = document.createElement('canvas');
  canvas.width = t.ncols;
  canvas.height = t.nrows;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const img = ctx.createImageData(t.ncols, t.nrows);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Contour spacing for an elevation range: ~20-40 lines across the grid, every 5th one bold. */
export function contourInterval(t: TerrainLayers): number {
  const range = Math.max(1, t.maxElevation - t.minElevation);
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.find((s) => range / s <= 40) ?? 1000;
}

/** Renders one basemap style as a PNG data URL the size of the grid. */
export function renderRelief(t: TerrainLayers, style: ReliefStyle): string {
  const { nrows: ny, ncols: nx, elevation: z, slope } = t;
  const { dy, dx } = cellSpacingM(t);
  const zFactor = 4; // vertical exaggeration so gentle relief reads
  const az = 315 * DEG; // sun from the north-west
  const alt = 45 * DEG;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const range = Math.max(1, t.maxElevation - t.minElevation);
  const interval = contourInterval(t);
  const indexInterval = interval * 5;
  const contours = style !== 'slope';
  const out = new Uint8ClampedArray(nx * ny * 4);

  const at = (r: number, c: number, fallback: number) => {
    const rr = r < 0 ? 0 : r >= ny ? ny - 1 : r;
    const cc = c < 0 ? 0 : c >= nx ? nx - 1 : c;
    const v = z[rr * nx + cc];
    return Number.isFinite(v) ? v : fallback;
  };

  for (let r = 0; r < ny; r++) {
    const dxr = dx[r];
    for (let c = 0; c < nx; c++) {
      const i = r * nx + c;
      const e = z[i];
      const o = i * 4;
      if (!Number.isFinite(e)) {
        out[o + 3] = 0;
        continue;
      }
      const a = at(r - 1, c - 1, e), b = at(r - 1, c, e), cc = at(r - 1, c + 1, e);
      const d = at(r, c - 1, e), f = at(r, c + 1, e);
      const g = at(r + 1, c - 1, e), h = at(r + 1, c, e), k = at(r + 1, c + 1, e);
      const dzdx = (((cc + 2 * f + k) - (a + 2 * d + g)) / (8 * dxr)) * zFactor; // east
      const dzdy = (((a + 2 * b + cc) - (g + 2 * h + k)) / (8 * dy)) * zFactor; // north
      const norm = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / norm);

      let line = 1;
      if (contours) {
        const band = Math.floor(e / interval);
        const crosses = (n: number) => Number.isFinite(n) && Math.floor(n / interval) !== band;
        const east = c + 1 < nx ? z[i + 1] : NaN;
        const south = r + 1 < ny ? z[i + nx] : NaN;
        if (crosses(east) || crosses(south)) {
          const other = crosses(east) ? east : south;
          line = Math.floor(e / indexInterval) !== Math.floor(other / indexInterval) ? 0.45 : 0.72;
        }
      }

      let rgb: [number, number, number];
      let light: number;
      if (style === 'hillshade') {
        const v = 30 + 205 * shade;
        rgb = [v, v, v];
        light = line;
      } else if (style === 'slope') {
        rgb = SLOPE_RGB[slopeClass(slope[i])];
        light = 0.55 + 0.5 * shade;
      } else if (style === 'elevation') {
        rgb = rampColor((e - t.minElevation) / range);
        light = (0.8 + 0.25 * shade) * line;
      } else {
        rgb = rampColor((e - t.minElevation) / range);
        light = (0.25 + 0.9 * shade) * line;
      }
      out[o] = rgb[0] * light;
      out[o + 1] = rgb[1] * light;
      out[o + 2] = rgb[2] * light;
      out[o + 3] = 255;
    }
  }
  return toDataUrl(t, out);
}

/** Cells the router will not enter (slope above the limit, or no data), plus a faint near-limit band. */
export function renderSlopeHazard(t: TerrainLayers, maxSlopeDeg: number): string {
  const { slope, elevation } = t;
  const n = slope.length;
  const out = new Uint8ClampedArray(n * 4);
  const nearFrom = maxSlopeDeg - NEAR_LIMIT_DEG;
  for (let i = 0; i < n; i++) {
    const s = slope[i];
    const o = i * 4;
    let c: readonly number[] | null = null;
    if (!Number.isFinite(s) || !Number.isFinite(elevation[i])) c = HAZARD_COLORS.noData;
    else if (s > maxSlopeDeg) c = HAZARD_COLORS.impassable;
    else if (s > nearFrom) c = HAZARD_COLORS.nearLimit;
    if (c) {
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = c[3];
    }
  }
  return toDataUrl(t, out);
}

/** Nearest-cell elevation and slope at a point, or null outside the grid / on no-data cells. */
export function sampleTerrain(
  t: TerrainLayers,
  lat: number,
  lon: number,
): { elevation_m: number; slope_deg: number | null } | null {
  const r = Math.round((t.northLat - lat) / t.dlatDeg);
  const c = Math.round((lon - t.westLon) / t.dlonDeg);
  if (r < 0 || r >= t.nrows || c < 0 || c >= t.ncols) return null;
  const e = t.elevation[r * t.ncols + c];
  if (!Number.isFinite(e)) return null;
  const s = t.slope[r * t.ncols + c];
  return { elevation_m: e, slope_deg: Number.isFinite(s) ? s : null };
}

export function insideTerrain(t: TerrainLayers, lat: number, lon: number): boolean {
  const b = t.bounds;
  return lat >= b.min_lat && lat <= b.max_lat && lon >= b.min_lon && lon <= b.max_lon;
}
