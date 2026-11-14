/**
 * Regional GIS layers built by gis/marga_gis/region.py from NASA Mars Trek data
 * (frontend/public/gis/<site>/): orbital imagery, the slope and roughness rasters, and vector layers.
 *
 * Everything is read in MARGA's Mars CRS: rasters from their GeoTIFF transforms, vectors from GeoJSON
 * whose crs member must name MARGA's CRS. Files in any other CRS are refused, not reprojected. Raster
 * values are the real values (8-bit brightness, degrees, metres), styled on the GPU.
 */
import GeoTIFF from 'ol/source/GeoTIFF';
import WebGLTileLayer from 'ol/layer/WebGLTile';
import VectorLayer from 'ol/layer/Vector';
import type Feature from 'ol/Feature';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { isMarsCrsCode, MARS_CRS_CODE } from '@shared/gis/marsCrs';
import { MARS_PROJECTION } from './projection';
import { GIS_BASE, type DerivedRasterEntry, type GisLayerManifest, type VectorEntry } from './demLayer';
import { SLOPE_OVERLAY_RAMP, contextLayerSymbol, roughnessOverlayRamp, type RampStop } from './mapStyles';

function cogSource(file: string): GeoTIFF {
  return new GeoTIFF({
    sources: [{ url: GIS_BASE + file }],
    projection: MARS_PROJECTION,
    normalize: false, // keep the real values
    interpolate: true,
    wrapX: false,
    sourceOptions: { allowFullFile: true },
  });
}

// Single-file sources with a declared no-data value: band 1 = values, band 2 = OpenLayers' mask (0 or 255).
const VALUE: unknown[] = ['band', 1];
const MASK: unknown[] = ['clamp', ['band', 2], 0, 1];

/** Orbital image (8-bit brightness, 0 = no data) as a grey basemap. */
export function createImageryLayer(file: string): WebGLTileLayer {
  return new WebGLTileLayer({
    source: cogSource(file),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: { color: ['color', VALUE, VALUE, VALUE, MASK] } as any,
    zIndex: 0,
    visible: false,
  });
}

function rampStyle(ramp: RampStop[]): { color: unknown[] } {
  const ch = (i: 0 | 1 | 2 | 3) => ['interpolate', ['linear'], VALUE, ...ramp.flatMap(([v, c]) => [v, c[i]])];
  return { color: ['color', ch(0), ch(1), ch(2), ['*', ch(3), MASK]] };
}

export type DerivedRasterId = 'slope' | 'roughness';

export function derivedRamp(id: DerivedRasterId, entry: DerivedRasterEntry): RampStop[] {
  return id === 'slope' ? SLOPE_OVERLAY_RAMP : roughnessOverlayRamp(entry.p50, entry.p95, entry.p98);
}

/** Slope (degrees) or roughness (metres) GeoTIFF as a colour overlay. */
export function createDerivedLayer(id: DerivedRasterId, entry: DerivedRasterEntry): WebGLTileLayer {
  return new WebGLTileLayer({
    source: cogSource(entry.file),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: rampStyle(derivedRamp(id, entry)) as any,
    zIndex: 0.5,
    visible: false,
  });
}

/** One vector layer, read as GeoJSON in MARGA's CRS (refused if its crs member names anything else). */
export async function loadVectorLayer(id: string, entry: VectorEntry): Promise<VectorLayer<Feature>> {
  const res = await fetch(GIS_BASE + entry.file);
  if (!res.ok) throw new Error(`${entry.file} could not be loaded (HTTP ${res.status})`);
  const doc = await res.json();
  const crs: string | undefined = doc?.crs?.properties?.name;
  if (!isMarsCrsCode(crs)) {
    throw new Error(`${entry.file} is in ${crs ?? 'an unstated CRS'}, not ${MARS_CRS_CODE}; it is not reprojected`);
  }
  const features = new GeoJSON().readFeatures(doc, { dataProjection: MARS_PROJECTION, featureProjection: MARS_PROJECTION });
  const symbol = contextLayerSymbol(id);
  return new VectorLayer({
    source: new VectorSource({ features }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: symbol.style as any,
    zIndex: symbol.zIndex,
    declutter: 'labels', // shares label space with the target and waypoint labels
    visible: false,
  });
}

/** Ids of the imagery products in the manifest, finest resolution first. */
export function imageryIds(m: GisLayerManifest | null): string[] {
  const im = m?.imagery ?? {};
  return Object.keys(im).sort((a, b) => im[a].resolution_m - im[b].resolution_m);
}

/** Basemap ids for imagery are 'imagery:<id>' (see BasemapStyle in MarsMap). */
export const isImageryBasemap = (b: string): b is `imagery:${string}` => b.startsWith('imagery:');
export const imageryIdOf = (b: string): string | null => (isImageryBasemap(b) ? b.slice('imagery:'.length) : null);

/** 8-point compass direction of an offset given as metres north and east. */
export function compassDirection(north: number, east: number): string {
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg + 360) % 360) / 45) % 8];
}
