/**
 * What the map shows: independent layer switches (left panel, "Map layers").
 *
 * Base imagery sits at the bottom: an orbital image from the GIS manifest ('imagery:<id>'), the DEM
 * hillshade, or nothing. Elevation colours, slope, roughness, targets, the planned route and the
 * context layers are switched on and off independently above it.
 */
export type BaseImagery = 'none' | 'hillshade' | `imagery:${string}`;

/** Continuous slope from the slope GeoTIFF, or the engine's slope classes on its routing grid. */
export type SlopeDisplay = 'continuous' | 'classes';

export interface MapLayers {
  base: BaseImagery;
  /** Elevation colours with contours. Over hillshade they combine into shaded relief. */
  elevation: boolean;
  /** Opacity of the elevation colours over imagery, 0-1. */
  elevationOpacity: number;
  slope: boolean;
  slopeDisplay: SlopeDisplay;
  /** Ground over the slope limit (route avoids) and near it; follows the slope-limit constraint. */
  hazard: boolean;
  roughness: boolean;
  /** Opacity of the slope and roughness overlays, 0-1. */
  overlayOpacity: number;
  targets: boolean;
  /** Curiosity CheMin sampling sites (NASA PDS mineral abundances). */
  samples: boolean;
  /** Curiosity stops with a 360-degree Navcam rover view. */
  roverViews: boolean;
  /** The planned route, with its return leg and alternatives as sub-options. */
  route: boolean;
  returnRoute: boolean;
  alternatives: boolean;
  /** Context vector layer id (layers.json "vectors") -> visible. */
  vectors: Record<string, boolean>;
}

export const DEFAULT_MAP_LAYERS: MapLayers = {
  base: 'hillshade',
  elevation: true,
  elevationOpacity: 0.55,
  slope: false,
  slopeDisplay: 'continuous',
  hazard: true,
  roughness: false,
  overlayOpacity: 0.7,
  targets: true,
  samples: true,
  roverViews: true,
  route: true,
  returnRoute: true,
  alternatives: false,
  vectors: {},
};
