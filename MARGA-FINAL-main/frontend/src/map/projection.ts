/**
 * MARGA's Mars CRS as an OpenLayers projection.
 *
 * Map coordinates are the same [longitude, latitude] degrees the engine and the data use, so no
 * coordinate transformation exists between them, and none is registered to or from Earth CRSs:
 * OpenLayers cannot silently reproject Mars data through WGS 84.
 *
 * Without this, OpenLayers would measure a degrees-based projection on Earth's sphere (via
 * EPSG:4326). Here distances use the Mars sphere: metresPerUnit is the Mars metres per degree, and
 * the east-west ground size of a degree shrinks with cos(latitude).
 */
import Projection from 'ol/proj/Projection';
import { addProjection, get as getProjection } from 'ol/proj';
import { MARS_CRS_CODE, MARS_CRS_EXTENT, MARS_METRES_PER_DEGREE } from '@shared/gis/marsCrs';

const DEG2RAD = Math.PI / 180;

function createMarsProjection(): Projection {
  const existing = getProjection(MARS_CRS_CODE);
  if (existing) return existing;
  const projection = new Projection({
    code: MARS_CRS_CODE,
    units: 'degrees',
    extent: MARS_CRS_EXTENT,
    worldExtent: MARS_CRS_EXTENT,
    global: true,
    metersPerUnit: MARS_METRES_PER_DEGREE,
    // Resolution in degrees at a point, as east-west ground distance: degrees of longitude shrink
    // with cos(latitude) on the sphere. OpenLayers multiplies this by metersPerUnit for metres.
    getPointResolution: (resolution, point) => resolution * Math.cos(point[1] * DEG2RAD),
  });
  addProjection(projection);
  return projection;
}

export const MARS_PROJECTION = createMarsProjection();
