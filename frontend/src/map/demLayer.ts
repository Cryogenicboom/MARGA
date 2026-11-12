/**
 * Georeferenced DEM layers, rendered from the Cloud-Optimized GeoTIFFs built by
 * gis/marga_gis/build_site.py (frontend/public/gis/<site>/).
 *
 * The browser reads the actual raster values (elevation in metres, hillshade 1-255) with OpenLayers'
 * GeoTIFF source and styles them on the GPU; nothing is drawn from a pre-coloured picture. The raster
 * extent comes from the GeoTIFF's own transform, in MARGA's Mars CRS.
 */
import GeoTIFF from 'ol/source/GeoTIFF';
import WebGLTileLayer from 'ol/layer/WebGLTile';
import { isMarsCrsCode, MARS_CRS_CODE } from '@shared/gis/marsCrs';
import { MARS_PROJECTION } from './projection';
import { ELEVATION_RAMP } from './terrainRaster';

export interface GisLayerManifest {
  format: 'marga-gis-layers';
  format_version: number;
  site: string;
  crs: { code: string; name: string; note: string };
  declared_crs: string;
  grid: {
    width: number;
    height: number;
    transform: number[];
    bounds: [number, number, number, number];
    resolution_deg: [number, number];
    resolution_m: { north_south: number; east_west_at_centre: number };
  };
  layers: {
    elevation: { file: string; units: string; min: number; max: number; vertical_datum: string | null; sha256?: string };
    hillshade: { file: string; azimuth_deg: number; altitude_deg: number; z_factor: number; sha256?: string };
    slope?: DerivedRasterEntry;
    roughness?: DerivedRasterEntry;
  };
  dataset: {
    dataset_id: string | null;
    name: string | null;
    status: string | null;
    synthetic: boolean | null;
    mission?: string | null;
    instrument?: string | null;
    source?: string | null;
  };
  /** Orbital imagery clipped to the region (gis/marga_gis/region.py build). */
  imagery?: Record<string, ImageryEntry>;
  /** Vector layers clipped to the region, GeoJSON in MARGA's CRS. */
  vectors?: Record<string, VectorEntry>;
  acquisition?: { package_manifest: string; source: string; notes: string[] };
}

/** A raster derived from the elevation COG by the engine's own analysis functions. */
export interface DerivedRasterEntry {
  file: string;
  units: string;
  method: string;
  min: number;
  p50: number;
  p95: number;
  p98: number;
  max: number;
  derived_from: string;
  sha256: string;
}

export interface OffsetCheck {
  method: string;
  reference: string;
  cell_m: number;
  verdict: 'aligned' | 'offset' | 'inconclusive';
  ncc_best?: number;
  peak_significance_sigma?: number;
  image_offset_m?: { north: number; east: number; total: number };
}

export interface ImageryEntry {
  file: string;
  title: string;
  product_label: string;
  catalogue_title: string | null;
  mission: string | null;
  instrument: string | null;
  catalogue_created: string | null;
  resolution_m: number;
  width: number;
  height: number;
  values: string;
  coverage_fraction: number;
  registration: OffsetCheck;
  cross_check?: OffsetCheck;
  registration_summary?: {
    verdict: 'aligned' | 'offset' | 'inconclusive';
    offset_m: { north: number; east: number; total: number } | null;
    basis: string;
  };
  crs_note: string;
  source: { service: string; layer: string; requests?: string[]; tile_url_template?: string; tile_matrix?: string };
  fetched_at: string | null;
  sha256: string;
}

export interface VectorEntry {
  file: string;
  title: string;
  geometry_type: string;
  features_in_region: number;
  features_fetched: number;
  source: string;
  copyright: string | null;
  crs_note: string;
  check: {
    method: string;
    latest_sol_on_line?: number | null;
    first_sol_off_line_after_that?: number | null;
    latest_waypoint_sol?: number;
  } | null;
  fetched_at: string | null;
  sha256: string;
}

export type DemStyleMode = 'relief' | 'elevation' | 'hillshade';

export const GIS_BASE = `${import.meta.env.BASE_URL}gis/gale/`;

/** Fetch and check the layer manifest. Layers in any CRS other than MARGA's are refused, not reprojected. */
export async function loadGisManifest(): Promise<GisLayerManifest> {
  const res = await fetch(GIS_BASE + 'layers.json');
  if (!res.ok) throw new Error(`layers.json could not be loaded (HTTP ${res.status})`);
  const m = (await res.json()) as GisLayerManifest;
  if (m.format !== 'marga-gis-layers') throw new Error('layers.json is not a MARGA GIS layer manifest');
  if (!isMarsCrsCode(m.crs?.code)) {
    throw new Error(`layers are in ${m.crs?.code ?? 'an unstated CRS'}, not ${MARS_CRS_CODE}; they are not reprojected`);
  }
  return m;
}

/** Contour spacing for an elevation range: ~20-40 lines across the area, every 5th one bold. */
export function contourIntervalFor(min: number, max: number): number {
  const range = Math.max(1, max - min);
  return [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => range / s <= 40) ?? 1000;
}

// Bands: 1 = elevation (m), 2 = hillshade (1-255), 3 = no-data mask added by OpenLayers (0 or 255).
const ELEV: unknown[] = ['band', 1];
const SHADE: unknown[] = ['/', ['-', ['band', 2], 1], 254];
const ALPHA: unknown[] = ['clamp', ['band', 3], 0, 1];

/** 1 off contour lines, 0.72 on a contour, 0.45 on every 5th (index) contour. Neighbours: east, south. */
function contourFactor(interval: number): unknown[] {
  const cls = (v: unknown[], step: number) => ['floor', ['/', v, step]];
  const east: unknown[] = ['band', 1, 1, 0];
  const south: unknown[] = ['band', 1, 0, 1];
  const crosses = (step: number) => ['any', ['!=', cls(ELEV, step), cls(east, step)], ['!=', cls(ELEV, step), cls(south, step)]];
  return ['case', crosses(interval * 5), 0.45, crosses(interval), 0.72, 1];
}

function rampChannel(i: 0 | 1 | 2, min: number, max: number): unknown[] {
  const t = ['clamp', ['/', ['-', ELEV, min], Math.max(1, max - min)], 0, 1];
  return ['interpolate', ['linear'], t, ...ELEVATION_RAMP.flatMap(([stop, rgb]) => [stop, rgb[i]])];
}

/** GPU style for one display mode, computed from the raster values. */
export function demStyle(mode: DemStyleMode, m: GisLayerManifest): { color: unknown[] } {
  const { min, max } = m.layers.elevation;
  const cf = contourFactor(contourIntervalFor(min, max));
  if (mode === 'hillshade') {
    const grey = ['*', ['+', 30, ['*', 205, SHADE]], cf];
    return { color: ['color', grey, grey, grey, ALPHA] };
  }
  // relief: strong hillshade under the elevation colours; elevation: colours with light shading.
  const light =
    mode === 'relief' ? ['*', ['+', 0.25, ['*', 0.9, SHADE]], cf] : ['*', ['+', 0.8, ['*', 0.25, SHADE]], cf];
  const ch = (i: 0 | 1 | 2) => ['*', rampChannel(i, min, max), light];
  return { color: ['color', ch(0), ch(1), ch(2), ALPHA] };
}

/** One WebGL tile layer over the elevation and hillshade COGs, in MARGA's Mars CRS. */
export function createDemLayer(m: GisLayerManifest, mode: DemStyleMode): WebGLTileLayer {
  const source = new GeoTIFF({
    sources: [{ url: GIS_BASE + m.layers.elevation.file }, { url: GIS_BASE + m.layers.hillshade.file }],
    projection: MARS_PROJECTION,
    normalize: false, // keep real values: metres and shade levels
    interpolate: true,
    wrapX: false,
    sourceOptions: { allowFullFile: true },
  });
  return new WebGLTileLayer({
    source,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: demStyle(mode, m) as any,
    zIndex: 0,
  });
}
