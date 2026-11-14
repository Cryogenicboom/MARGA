/**
 * Terrain grid, Horn slope, detrended roughness and package loading
 * (mirror of marga_engine/terrain/{grid,analysis,package}.py).
 *
 * Package = terrain.json + elevation.i16 (int16 little-endian, z = offset + scale * q, -32768 = no data)
 * or elevation.f32 (float32 little-endian, NaN = no data); row-major, row 0 = north.
 */
import { DEG2RAD, MARS_RADIUS_M, RAD2DEG, lonDelta, normalizeLon, roundHalfEven } from './geodesy.ts';
import { SLOPE_CLASS_FLAT_MAX, SLOPE_CLASS_MODERATE_MAX, SLOPE_CLASS_STEEP_MAX } from './config.ts';

export class EngineError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

export class GridGeometry {
  readonly northLat: number;
  readonly westLon: number;
  readonly dlatDeg: number;
  readonly dlonDeg: number;
  readonly nrows: number;
  readonly ncols: number;
  readonly radiusM: number;
  private _dx: Float64Array | null = null;

  constructor(northLat: number, westLon: number, dlatDeg: number, dlonDeg: number, nrows: number, ncols: number,
              radiusM = MARS_RADIUS_M) {
    if (!(dlatDeg > 0 && dlonDeg > 0)) throw new EngineError('terrain', 'grid spacing must be positive');
    if (nrows < 3 || ncols < 3) throw new EngineError('terrain', 'terrain grid must be at least 3 x 3 cells');
    this.northLat = northLat; this.westLon = westLon; this.dlatDeg = dlatDeg; this.dlonDeg = dlonDeg;
    this.nrows = nrows; this.ncols = ncols; this.radiusM = radiusM;
  }

  rowLat(r: number): number { return this.northLat - r * this.dlatDeg; }
  colLon(c: number): number { return normalizeLon(this.westLon + c * this.dlonDeg); }
  rc(lat: number, lon: number): [number, number] {
    return [(this.northLat - lat) / this.dlatDeg, lonDelta(lon, this.westLon) / this.dlonDeg];
  }
  contains(lat: number, lon: number): boolean {
    const [r, c] = this.rc(lat, lon);
    return r >= -0.5 && r <= this.nrows - 0.5 && c >= -0.5 && c <= this.ncols - 0.5;
  }
  get bounds() {
    return {
      min_lat: this.northLat - (this.nrows - 0.5) * this.dlatDeg,
      max_lat: this.northLat + 0.5 * this.dlatDeg,
      min_lon: normalizeLon(this.westLon - 0.5 * this.dlonDeg),
      max_lon: normalizeLon(this.westLon + (this.ncols - 0.5) * this.dlonDeg),
    };
  }
  get dyM(): number { return this.radiusM * (this.dlatDeg * DEG2RAD); }
  get dxMRows(): Float64Array {
    if (!this._dx) {
      const k = this.dlonDeg * DEG2RAD;
      const out = new Float64Array(this.nrows);
      for (let r = 0; r < this.nrows; r++) out[r] = this.radiusM * Math.cos(this.rowLat(r) * DEG2RAD) * k;
      this._dx = out;
    }
    return this._dx;
  }
  get cellSizeM(): number {
    let m = Infinity;
    for (const v of this.dxMRows) m = Math.min(m, v);
    return Math.min(this.dyM, m);
  }
  window(r0: number, r1: number, c0: number, c1: number): GridGeometry {
    return new GridGeometry(this.rowLat(r0), normalizeLon(this.westLon + c0 * this.dlonDeg), this.dlatDeg,
      this.dlonDeg, r1 - r0, c1 - c0, this.radiusM);
  }
  coarsen(f: number): GridGeometry {
    const ny = Math.ceil(this.nrows / f), nx = Math.ceil(this.ncols / f);
    const off = (f - 1) / 2;
    return new GridGeometry(this.northLat - off * this.dlatDeg, normalizeLon(this.westLon + off * this.dlonDeg),
      this.dlatDeg * f, this.dlonDeg * f, Math.max(3, ny), Math.max(3, nx), this.radiusM);
  }
}

export interface TerrainMetadata {
  dataset_id: string;
  name: string;
  site_id?: string | null;
  mission?: string | null;
  instrument?: string | null;
  data_type?: string;
  source?: string | null;
  crs?: string | null;
  vertical_datum?: string | null;
  processing_level?: string | null;
  spatial_resolution_m?: number | null;
  observation_period?: string | null;
  synthetic: boolean;
  status?: string;
  limitations: string[];
  lineage?: string[];
}

export function metadataLabel(md: TerrainMetadata): string {
  const res = md.spatial_resolution_m ? ` (${fmtG(md.spatial_resolution_m)} m)` : '';
  return `${md.name}${res}` + (md.synthetic ? ' [SYNTHETIC TEST TERRAIN]' : '');
}

function fmtG(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(6)));
}

// --- analysis ---------------------------------------------------------------------------------

/** Horn (1981) slope in degrees; DEM extended by odd reflection at the edges; NaN where unknown. */
export function hornSlope(z: Float32Array, ny: number, nx: number, dy: number, dxRows: Float64Array): Float32Array {
  const out = new Float32Array(ny * nx);
  const P = paddedReader(z, ny, nx);
  for (let r = 0; r < ny; r++) {
    const dx = dxRows[r];
    for (let c = 0; c < nx; c++) {
      if (!Number.isFinite(z[r * nx + c])) { out[r * nx + c] = NaN; continue; }
      const a = P(r - 1, c - 1), b = P(r - 1, c), cc = P(r - 1, c + 1);
      const d = P(r, c - 1), f = P(r, c + 1);
      const g = P(r + 1, c - 1), h = P(r + 1, c), i = P(r + 1, c + 1);
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx);
      const dzdy = ((a + 2 * b + cc) - (g + 2 * h + i)) / (8.0 * dy);
      out[r * nx + c] = Math.atan(Math.hypot(dzdx, dzdy)) * RAD2DEG;
    }
  }
  return out;
}

/** RMS of residuals from the least-squares plane through each 3x3 window (metres). */
export function detrendedRoughness(z: Float32Array, ny: number, nx: number, dy: number, dxRows: Float64Array): Float32Array {
  const out = new Float32Array(ny * nx);
  const P = paddedReader(z, ny, nx);
  const xs = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
  const ys = [1, 1, 1, 0, 0, 0, -1, -1, -1];
  const zs = new Float64Array(9);
  for (let r = 0; r < ny; r++) {
    const dx = dxRows[r];
    for (let c = 0; c < nx; c++) {
      let k = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) zs[k++] = P(r + dr, c + dc);
      const [a, b, cc, d, e, f, g, h, i] = zs;
      const mean = (a + b + cc + d + e + f + g + h + i) / 9.0;
      const gx = ((cc + f + i) - (a + d + g)) / (6.0 * dx);
      const gy = ((a + b + cc) - (g + h + i)) / (6.0 * dy);
      let ss = 0;
      for (let q = 0; q < 9; q++) {
        const res = zs[q] - (mean + gx * (xs[q] * dx) + gy * (ys[q] * dy));
        ss += res * res;
      }
      out[r * nx + c] = Math.sqrt(ss / 9.0);
    }
  }
  return out;
}

function paddedReader(z: Float32Array, ny: number, nx: number) {
  const rowVal = (r: number, c: number): number => {
    if (r === -1) return 2 * z[c] - z[nx + c];
    if (r === ny) return 2 * z[(ny - 1) * nx + c] - z[(ny - 2) * nx + c];
    return z[r * nx + c];
  };
  return (r: number, c: number): number => {
    if (c === -1) return 2 * rowVal(r, 0) - rowVal(r, 1);
    if (c === nx) return 2 * rowVal(r, nx - 1) - rowVal(r, nx - 2);
    return rowVal(r, c);
  };
}

export type SlopeClass = 'flat' | 'moderate' | 'steep' | 'hazardous' | 'unknown';

export function slopeClass(s: number): SlopeClass {
  if (!Number.isFinite(s)) return 'unknown';
  if (s < SLOPE_CLASS_FLAT_MAX) return 'flat';
  if (s < SLOPE_CLASS_MODERATE_MAX) return 'moderate';
  if (s < SLOPE_CLASS_STEEP_MAX) return 'steep';
  return 'hazardous';
}

// --- grid ---------------------------------------------------------------------------------------

export class TerrainGrid {
  readonly elevation: Float32Array;
  readonly geometry: GridGeometry;
  readonly metadata: TerrainMetadata;
  readonly externalRoughness: Float32Array | null;
  private _slope: Float32Array | null = null;
  private _rough: Float32Array | null = null;

  constructor(elevation: Float32Array, geometry: GridGeometry, metadata: TerrainMetadata,
              roughness: Float32Array | null = null) {
    if (elevation.length !== geometry.nrows * geometry.ncols) {
      throw new EngineError('terrain', 'elevation size does not match geometry');
    }
    let any = false;
    for (let i = 0; i < elevation.length; i++) {
      if (!Number.isFinite(elevation[i])) elevation[i] = NaN; else any = true;
    }
    if (!any) throw new EngineError('terrain', 'terrain grid contains no valid elevation values');
    this.elevation = elevation;
    this.geometry = geometry;
    this.metadata = metadata;
    this.externalRoughness = roughness;
  }

  get slopeDeg(): Float32Array {
    if (!this._slope) {
      const g = this.geometry;
      this._slope = hornSlope(this.elevation, g.nrows, g.ncols, g.dyM, g.dxMRows);
    }
    return this._slope;
  }

  get demRoughnessM(): Float32Array {
    if (!this._rough) {
      const g = this.geometry;
      this._rough = detrendedRoughness(this.elevation, g.nrows, g.ncols, g.dyM, g.dxMRows);
    }
    return this._rough;
  }

  roughnessLayer(maxCellM: number): [Float32Array | null, string] {
    if (this.externalRoughness) return [this.externalRoughness, 'external roughness layer supplied with the terrain package'];
    if (this.geometry.cellSizeM <= maxCellM) return [this.demRoughnessM, 'detrended 3x3 residual RMS of the DEM'];
    return [null, `omitted: DEM spacing ${this.geometry.cellSizeM.toFixed(0)} m is coarser than ${fmtG(maxCellM)} m, ` +
      'too coarse for walking-scale roughness'];
  }

  requireCoverage(lat: number, lon: number, what = 'point'): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new EngineError('coverage', `${what} has non-finite coordinates`);
    if (!this.geometry.contains(lat, lon)) {
      const b = this.geometry.bounds;
      throw new EngineError('coverage',
        `${what} (${lat.toFixed(5)}, ${lon.toFixed(5)}) is outside the terrain package ` +
        `[lat ${b.min_lat.toFixed(4)}..${b.max_lat.toFixed(4)}, lon ${b.min_lon.toFixed(4)}..${b.max_lon.toFixed(4)}]`);
    }
  }

  /** Bilinear elevation; NaN when any of the four cells is no-data or the point is outside. */
  sampleBilinear(lat: number, lon: number): number {
    const g = this.geometry;
    const ny = g.nrows, nx = g.ncols;
    const r = (g.northLat - lat) / g.dlatDeg;
    const c = lonDelta(lon, g.westLon) / g.dlonDeg;
    if (r < -0.5 || r > ny - 0.5 || c < -0.5 || c > nx - 0.5) return NaN;
    const rr = Math.min(Math.max(r, 0), ny - 1), cc = Math.min(Math.max(c, 0), nx - 1);
    const r0 = Math.min(Math.max(Math.floor(rr), 0), ny - 2), c0 = Math.min(Math.max(Math.floor(cc), 0), nx - 2);
    const fr = rr - r0, fc = cc - c0;
    const z = this.elevation;
    return ((z[r0 * nx + c0] * (1 - fc) + z[r0 * nx + c0 + 1] * fc) * (1 - fr)
      + (z[(r0 + 1) * nx + c0] * (1 - fc) + z[(r0 + 1) * nx + c0 + 1] * fc) * fr);
  }

  sampleNearest(layer: Float32Array, lat: number, lon: number): number {
    const g = this.geometry;
    const r = (g.northLat - lat) / g.dlatDeg;
    const c = lonDelta(lon, g.westLon) / g.dlonDeg;
    if (r < -0.5 || r > g.nrows - 0.5 || c < -0.5 || c > g.ncols - 0.5) return NaN;
    // Snap to 1e-6 cell first (= numpy round(x, 6): scale, rint, unscale) so samples lying exactly on a
    // cell edge resolve to the same cell as in the Python engine, then numpy rint (half-even).
    const ri = Math.min(Math.max(roundHalfEven(roundHalfEven(r * 1e6) / 1e6), 0), g.nrows - 1);
    const ci = Math.min(Math.max(roundHalfEven(roundHalfEven(c * 1e6) / 1e6), 0), g.ncols - 1);
    return layer[ri * g.ncols + ci];
  }

  describe() {
    const g = this.geometry;
    let valid = 0;
    for (const v of this.elevation) if (Number.isFinite(v)) valid++;
    return {
      dataset: this.metadata, label: metadataLabel(this.metadata), shape: [g.nrows, g.ncols],
      bounds: g.bounds, cell_size_m: Math.round(g.cellSizeM * 1000) / 1000, radius_m: g.radiusM,
      valid_fraction: valid / this.elevation.length,
    };
  }
}

// --- packages -------------------------------------------------------------------------------------

export interface TerrainLayerSpec {
  file: string;
  dtype: 'float32' | 'int16';
  byte_order: string;
  scale?: number;
  offset?: number;
  nodata?: number | string;
}

export interface TerrainPackageJson {
  format: string;
  format_version: number;
  geometry: { north_lat: number; west_lon: number; dlat_deg: number; dlon_deg: number; nrows: number; ncols: number; radius_m: number };
  layers: Record<string, TerrainLayerSpec>;
  dataset: TerrainMetadata;
  checksums?: Record<string, string>;
}

const LITTLE_ENDIAN_HOST = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Decode a layer to float32 metres (NaN = no data). int16 layers: metres = offset + scale * v. */
export function decodeLayer(spec: TerrainLayerSpec, buf: ArrayBuffer, expected: number): Float32Array {
  const out = new Float32Array(expected);
  if (spec.dtype === 'int16') {
    if (buf.byteLength !== expected * 2) throw new EngineError('terrain', `${spec.file} has the wrong size`);
    const nodata = typeof spec.nodata === 'number' ? spec.nodata : -32768;
    const scale = spec.scale as number, offset = spec.offset as number;
    if (!Number.isFinite(scale) || !Number.isFinite(offset)) throw new EngineError('terrain', `${spec.file}: missing scale/offset`);
    const v = LITTLE_ENDIAN_HOST ? new Int16Array(buf) : null;
    const dv = v ? null : new DataView(buf);
    for (let i = 0; i < expected; i++) {
      const q = v ? v[i] : dv!.getInt16(i * 2, true);
      out[i] = q === nodata ? NaN : offset + scale * q;
    }
    return out;
  }
  if (spec.dtype !== 'float32') throw new EngineError('terrain', `unsupported layer dtype ${spec.dtype}`);
  if (buf.byteLength !== expected * 4) throw new EngineError('terrain', `${spec.file} has the wrong size`);
  if (LITTLE_ENDIAN_HOST) out.set(new Float32Array(buf));
  else {
    const dv = new DataView(buf);
    for (let i = 0; i < expected; i++) out[i] = dv.getFloat32(i * 4, true);
  }
  return out;
}

/** Build a TerrainGrid from a parsed terrain.json and the raw layer buffers. */
export function terrainFromPackage(meta: TerrainPackageJson, elevation: ArrayBuffer, roughness?: ArrayBuffer | null): TerrainGrid {
  if (meta.format !== 'marga-terrain-package') throw new EngineError('terrain', 'not a marga-terrain-package');
  const g = meta.geometry;
  const geom = new GridGeometry(g.north_lat, g.west_lon, g.dlat_deg, g.dlon_deg, g.nrows, g.ncols, g.radius_m);
  const n = g.nrows * g.ncols;
  const elev = decodeLayer(meta.layers.elevation, elevation, n);
  const rough = roughness && meta.layers.roughness ? decodeLayer(meta.layers.roughness, roughness, n) : null;
  return new TerrainGrid(elev, geom, meta.dataset, rough);
}

/** Browser/offline loader: fetch a package directory (served statically or from a service-worker cache). */
export async function fetchTerrainPackage(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<TerrainGrid> {
  const root = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const get = async (name: string) => {
    const res = await fetchImpl(root + name);
    if (!res.ok) throw new EngineError('terrain', `terrain package file ${root + name} could not be loaded (HTTP ${res.status})`);
    return res;
  };
  const meta = (await (await get('terrain.json')).json()) as TerrainPackageJson;
  const elev = await (await get(meta.layers.elevation.file)).arrayBuffer();
  const r = meta.layers.roughness ? await (await get(meta.layers.roughness.file)).arrayBuffer() : null;
  return terrainFromPackage(meta, elev, r);
}
