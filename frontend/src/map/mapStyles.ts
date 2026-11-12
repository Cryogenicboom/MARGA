/**
 * MARGA map symbology: one place for every colour and line style used on the map, its legend and
 * the elevation profile, so the same thing always looks the same.
 *
 * Slope classes come from the engine itself (shared/engine slopeClass + its thresholds); this file
 * only assigns colours to them.
 */
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { ScienceCategory } from '@shared/types';
import {
  SLOPE_CLASS_FLAT_MAX,
  SLOPE_CLASS_MODERATE_MAX,
  SLOPE_CLASS_STEEP_MAX,
} from '@shared/engine/config.ts';
import { slopeClass, type SlopeClass } from '@shared/engine/terrain.ts';

export { slopeClass, type SlopeClass };
export const SLOPE_THRESHOLDS = {
  flat: SLOPE_CLASS_FLAT_MAX,
  moderate: SLOPE_CLASS_MODERATE_MAX,
  steep: SLOPE_CLASS_STEEP_MAX,
};

const LABEL_FONT = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif';

export const CATEGORY_COLORS: Record<ScienceCategory, string> = {
  mineralogical: '#d9a441',
  hydration: '#4fb3c8',
  sedimentary: '#6dbb8a',
  radiation: '#a98bd8',
  geological: '#d77a6e',
};

export const CATEGORY_LABELS: Record<ScienceCategory, string> = {
  mineralogical: 'Mineralogical',
  hydration: 'Hydration',
  sedimentary: 'Sedimentary',
  radiation: 'Radiation',
  geological: 'Geological',
};

/** Terrain slope classes (engine thresholds), light to dark warm, plus unknown. */
export const SLOPE_CLASS_COLORS: Record<SlopeClass, string> = {
  flat: '#4f8f6a',
  moderate: '#b3a845',
  steep: '#d58a3c',
  hazardous: '#c9483c',
  unknown: '#55595f',
};

export const SLOPE_CLASS_LABELS: Record<SlopeClass, string> = {
  flat: `Flat, under ${SLOPE_CLASS_FLAT_MAX}°`,
  moderate: `Moderate, ${SLOPE_CLASS_FLAT_MAX}–${SLOPE_CLASS_MODERATE_MAX}°`,
  steep: `Steep, ${SLOPE_CLASS_MODERATE_MAX}–${SLOPE_CLASS_STEEP_MAX}°`,
  hazardous: `Hazardous, over ${SLOPE_CLASS_STEEP_MAX}°`,
  unknown: 'No elevation data',
};

export const ROUTE_COLORS = {
  route: '#5aa2f0',
  returnRoute: '#a9cdf7',
  alternativeDistance: '#c7ccd3',
  alternativeTime: '#c7ccd3',
  start: '#5fb58a',
  destination: '#e06c5f',
  casing: 'rgba(10, 12, 15, 0.85)',
};

export const ROUTE_DASH = {
  returnRoute: [8, 6],
  alternativeDistance: [2, 5],
  alternativeTime: [10, 4, 2, 4],
};

/** Target pin + name. Pins always draw; names declutter so dense clusters stay readable. */
export function getTargetStyle(category: ScienceCategory, name: string, isSelected = false) {
  const color = CATEGORY_COLORS[category] || '#9aa3ae';
  return new Style({
    image: new CircleStyle({
      radius: isSelected ? 7 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: isSelected ? '#ffffff' : '#0b0d10', width: isSelected ? 2 : 1.5 }),
      declutterMode: 'none',
    }),
    text: new Text({
      text: name,
      font: `${isSelected ? '600 ' : ''}12px ${LABEL_FONT}`,
      offsetY: -14,
      padding: [1, 3, 1, 3],
      fill: new Fill({ color: isSelected ? '#ffffff' : '#d4d8dd' }),
      stroke: new Stroke({ color: '#0b0d10', width: 3 }),
    }),
  });
}

/** The selected (planned) route: solid accent line on a dark casing. */
export function getRouteStyle() {
  return [
    new Style({ stroke: new Stroke({ color: ROUTE_COLORS.casing, width: 6 }) }),
    new Style({ stroke: new Stroke({ color: ROUTE_COLORS.route, width: 3 }) }),
  ];
}

/** The return route the engine searched separately (turnaround to habitat). */
export function getReturnRouteStyle() {
  return [
    new Style({ stroke: new Stroke({ color: ROUTE_COLORS.casing, width: 4.5 }) }),
    new Style({ stroke: new Stroke({ color: ROUTE_COLORS.returnRoute, width: 2, lineDash: ROUTE_DASH.returnRoute }) }),
  ];
}

/** Alternative routes from the engine (other cost metrics). Thin, grey, for comparison only. */
export function getAlternativeStyle(kind: 'distance' | 'time') {
  const color = kind === 'distance' ? ROUTE_COLORS.alternativeDistance : ROUTE_COLORS.alternativeTime;
  const lineDash = kind === 'distance' ? ROUTE_DASH.alternativeDistance : ROUTE_DASH.alternativeTime;
  return [
    new Style({ stroke: new Stroke({ color: ROUTE_COLORS.casing, width: 4 }) }),
    new Style({ stroke: new Stroke({ color, width: 1.5, lineDash }) }),
  ];
}

export function getWaypointMarkerStyle(type: 'start' | 'destination', label: string) {
  const color = type === 'start' ? ROUTE_COLORS.start : ROUTE_COLORS.destination;
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
      declutterMode: 'none',
    }),
    text: new Text({
      text: label,
      font: `600 11px ${LABEL_FONT}`,
      offsetY: 16,
      padding: [1, 4, 1, 4],
      fill: new Fill({ color: '#0b0d10' }),
      backgroundFill: new Fill({ color }),
    }),
  });
}

/** Marker for the profile point under the cursor. */
export function getHighlightStyle() {
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: 'rgba(255,255,255,0.15)' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  });
}

/** Dashed outline of the terrain package: routes can only be planned inside it. */
export function getCoverageStyle() {
  return new Style({
    stroke: new Stroke({ color: 'rgba(154, 163, 174, 0.6)', width: 1, lineDash: [5, 5] }),
  });
}

// --- GIS raster overlays (GeoTIFF values styled on the GPU) --------------------------------------

/** RGBA stop: value, [r, g, b, alpha 0-1]. */
export type RampStop = readonly [number, readonly [number, number, number, number]];

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Continuous slope (degrees), from the slope GeoTIFF. Colours follow the engine's slope classes at
 * the engine's thresholds; gentle ground is see-through so the basemap shows where it matters least.
 */
export const SLOPE_OVERLAY_RAMP: RampStop[] = [
  [0, [...hexRgb(SLOPE_CLASS_COLORS.flat), 0]],
  [SLOPE_CLASS_FLAT_MAX, [...hexRgb(SLOPE_CLASS_COLORS.flat), 0.35]],
  [SLOPE_CLASS_MODERATE_MAX, [...hexRgb(SLOPE_CLASS_COLORS.moderate), 0.7]],
  [SLOPE_CLASS_STEEP_MAX, [...hexRgb(SLOPE_CLASS_COLORS.steep), 0.85]],
  [SLOPE_CLASS_STEEP_MAX + 10, [...hexRgb(SLOPE_CLASS_COLORS.hazardous), 0.95]],
];

/** Roughness (m): stops at the layer's own median, 95th and 98th percentiles (from layers.json). */
export function roughnessOverlayRamp(p50: number, p95: number, p98: number): RampStop[] {
  return [
    [0, [43, 26, 77, 0]],
    [p50, [106, 61, 154, 0.35]],
    [p95, [176, 95, 199, 0.8]],
    [p98, [240, 166, 255, 0.95]],
  ];
}

/** CSS gradient for a ramp's legend bar, stops placed by value across [ramp start, ramp end]. */
export function rampCss(ramp: RampStop[]): string {
  const lo = ramp[0][0];
  const span = Math.max(1e-9, ramp[ramp.length - 1][0] - lo);
  const stops = ramp.map(
    ([v, c]) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0.15, c[3]).toFixed(2)}) ${(((v - lo) / span) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// --- Mars Trek vector layers -------------------------------------------------------------------

export interface ContextLayerSymbol {
  /** How the legend draws it. */
  kind: 'line' | 'area' | 'point' | 'label';
  color: string;
  dash?: number[];
  zIndex: number;
  style: (feature: { get: (k: string) => unknown }) => Style | Style[];
}

const labelText = (text: string, color: string, offsetY = 0, size = 11) =>
  new Text({
    text,
    font: `${size}px ${LABEL_FONT}`,
    offsetY,
    padding: [1, 3, 1, 3],
    fill: new Fill({ color }),
    stroke: new Stroke({ color: '#0b0d10', width: 3 }),
    overflow: true,
  });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : '');

function areaSymbol(color: string, fillAlpha: number, dash: number[] | undefined, label: (f: { get: (k: string) => unknown }) => string, zIndex: number): ContextLayerSymbol {
  const [r, g, b] = hexRgb(color);
  const line = new Stroke({ color, width: 1.5, lineDash: dash });
  const fill = new Fill({ color: `rgba(${r}, ${g}, ${b}, ${fillAlpha})` });
  return {
    kind: 'area',
    color,
    dash,
    zIndex,
    style: (f) => new Style({ stroke: line, fill, text: labelText(label(f), color) }),
  };
}

/** Symbology per vector layer id (gis/regions/<site>.json). Unknown ids get a neutral outline. */
export const CONTEXT_LAYER_SYMBOLS: Record<string, ContextLayerSymbol> = {
  curiosity_traverse: {
    kind: 'line',
    color: '#f2c46d',
    zIndex: 3.4,
    style: () => [
      new Style({ stroke: new Stroke({ color: ROUTE_COLORS.casing, width: 4 }) }),
      new Style({ stroke: new Stroke({ color: '#f2c46d', width: 1.8 }) }),
    ],
  },
  regions_of_interest: areaSymbol('#5fc9b8', 0.1, undefined, (f) => (str(f.get('name')) ? `ROI ${str(f.get('name'))}` : ''), 3.2),
  geologic_units: areaSymbol('#b9a3e3', 0, [6, 4], (f) => str(f.get('Unit')), 3.0),
  dune_fields: areaSymbol('#e0b072', 0.14, [2, 3], () => 'Dune field', 3.1),
  exploration_zone: {
    kind: 'point',
    color: '#ff9f6b',
    zIndex: 3.6,
    style: (f) =>
      new Style({
        image: new CircleStyle({
          radius: 8,
          stroke: new Stroke({ color: '#ff9f6b', width: 2 }),
          fill: new Fill({ color: 'rgba(255, 159, 107, 0.15)' }),
          declutterMode: 'none',
        }),
        text: labelText(str(f.get('name')) || 'Exploration Zone', '#ff9f6b', 18),
      }),
  },
  place_names: {
    kind: 'label',
    color: '#e6e8eb',
    zIndex: 9,
    style: (f) =>
      new Style({
        image: new CircleStyle({ radius: 2.5, fill: new Fill({ color: '#e6e8eb' }), declutterMode: 'none' }),
        text: labelText(str(f.get('clean_name')) || str(f.get('LABEL')), '#e6e8eb', -11, 12),
      }),
  },
};

export function contextLayerSymbol(id: string): ContextLayerSymbol {
  return CONTEXT_LAYER_SYMBOLS[id] ?? areaSymbol('#9aa3ae', 0, undefined, () => '', 3);
}
