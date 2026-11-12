/**
 * MARGA's Mars coordinate reference system for TypeScript.
 *
 * Values come from mars_crs.json, generated from the PROJ database entry IAU_2015:49900
 * ("Mars (2015) - Sphere / Ocentric"); the Python GIS code (gis/marga_gis/crs.py) reads the same file.
 * Coordinates are [longitude, latitude] degrees: planetocentric latitude, east-positive longitude,
 * on the Mars reference sphere. Earth CRSs (WGS 84 / EPSG:4326) are not used for Mars data.
 */
import definition from './mars_crs.json';

export const MARS_CRS_CODE: string = definition.code;
export const MARS_CRS_NAME: string = definition.name;
export const MARS_CRS_RADIUS_M: number = definition.radius_m;
/** Ground length of one degree of latitude (and of longitude at the equator) on the Mars sphere. */
export const MARS_METRES_PER_DEGREE: number = definition.metres_per_degree;
export const MARS_CRS_WKT: string = definition.wkt;

/** Valid coordinate range in MARGA order: [west, south, east, north] degrees. */
export const MARS_CRS_EXTENT: [number, number, number, number] = [-180, -90, 180, 90];

/** True if a CRS identifier names MARGA's Mars CRS. */
export function isMarsCrsCode(code: string | null | undefined): boolean {
  return !!code && code.trim().toUpperCase() === MARS_CRS_CODE.toUpperCase();
}
