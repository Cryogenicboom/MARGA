import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import OlMap from 'ol/Map';
import View from 'ol/View';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { buffer as bufferExtent, type Extent } from 'ol/extent';
import { getPointResolution } from 'ol/proj';
import type WebGLTileLayer from 'ol/layer/WebGLTile';
import { ScienceTarget, LocationPoint } from '@shared/types';
import type { EngineRouteResponse } from '@shared/types/engine';
import { MARS_CRS_CODE, MARS_METRES_PER_DEGREE } from '@shared/gis/marsCrs';
import { MARS_PROJECTION } from './projection';
import { createDemLayer, demStyle, loadGisManifest, type GisLayerManifest } from './demLayer';
import type { MapLayers } from './layers';
import {
  createDerivedLayer,
  createImageryLayer,
  derivedRamp,
  imageryIds,
  compassDirection,
  imageryIdOf,
  loadVectorLayer,
  type DerivedRasterId,
} from './gisLayers';
import {
  ROUTE_COLORS,
  ROUTE_DASH,
  SLOPE_CLASS_COLORS,
  SLOPE_CLASS_LABELS,
  SLOPE_THRESHOLDS,
  contextLayerSymbol,
  rampCss,
  getAlternativeStyle,
  getCoverageStyle,
  getHighlightStyle,
  getReturnRouteStyle,
  getRouteStyle,
  getTargetStyle,
  getWaypointMarkerStyle,
  getSampleStyle,
  getRoverViewStyle,
  getRoverLeaderStyle,
  getViewConeStyle,
  SURFACE_COLORS,
} from './mapStyles';
import {
  ELEVATION_RAMP_CSS,
  HAZARD_COLORS,
  NEAR_LIMIT_DEG,
  contourInterval,
  insideTerrain,
  renderRelief,
  renderSlopeHazard,
  sampleTerrain,
  type ReliefStyle,
} from './terrainRaster';
import { loadTerrainLayers, type TerrainLayers } from '../services/routeService';
import { GALE_CRATER_METADATA } from '../services/mockData';
import type { CheminSample } from '../services/minerals';
import type { RoverView } from '../services/roverViews';
import { StatusBadge, routeStatusBadge } from '../components/StatusBadge';
import { fmtDistance, fmtDuration } from '../components/format';
import { AlertTriangle, Loader2, Maximize2, Minus, Plus } from 'lucide-react';

export interface CursorInfo {
  lat: number;
  lon: number;
  elevation_m: number | null;
  slope_deg: number | null;
}

/** What the map knows about the loaded terrain package, for the header, legend and status bar. */
export interface TerrainInfo {
  name: string;
  synthetic: boolean;
  status: string | null;
  cellSizeM: number;
  minElevation: number;
  maxElevation: number;
  contourInterval: number;
}


interface MarsMapProps {
  targets: ScienceTarget[];
  selectedTarget: ScienceTarget | null;
  onSelectTarget: (target: ScienceTarget) => void;
  startPoint: LocationPoint;
  destinationPoint: LocationPoint | null;
  onSetStartPoint: (point: LocationPoint) => void;
  onSetDestinationPoint: (point: LocationPoint) => void;
  /** The engine's response, displayed as returned. */
  route: EngineRouteResponse | null;
  isCalculating: boolean;
  /** Science stops between start and destination, in route order. */
  stops?: LocationPoint[];
  /** Current slope limit: drives the slope-hazard overlay. */
  maxSlopeDeg: number;
  /** What the map shows (left panel, Map layers). */
  layers: MapLayers;
  /** Report the elevation-profile point of the route under the map pointer (null when off the route). */
  onRouteHover?: (index: number | null) => void;
  /** Centre the map here (a point picked on the elevation profile); seq makes repeat picks re-centre. */
  focus?: { coordinate: [number, number]; seq: number } | null;
  /** Profile point under the cursor ([lon, lat] from the engine's elevation profile). */
  highlight: [number, number] | null;
  /** Show a one-line route summary on the map (when the inspector pane is collapsed). */
  showRouteSummary: boolean;
  onCursorMove?: (info: CursorInfo | null) => void;
  onTerrainInfo?: (info: TerrainInfo | null, error: string | null) => void;
  /** The GIS layer manifest (layers.json) once loaded, for the layer controls and provenance. */
  onGisInfo?: (manifest: GisLayerManifest | null, error: string | null) => void;
  /** Curiosity CheMin sampling sites (Catalogue → Minerals). */
  samples?: CheminSample[];
  selectedSampleId?: string | null;
  onSelectSample?: (s: CheminSample) => void;
  /** Curiosity stops with a Navcam rover view. */
  roverViews?: RoverView[];
  onSelectRoverView?: (v: RoverView) => void;
  /** The open rover view: its stop, where it looks, and the screen inset the map shows it in. */
  roverLook?: RoverLook | null;
}

/** The open rover view as the map shows it: a field-of-view cone, centred in the panel's map inset. */
export interface RoverLook {
  view: RoverView;
  headingDeg: number;
  fovDeg: number;
  /** The inset's centre in map-container pixels: the stop is kept there. */
  insetCentre: [number, number] | null;
}

/**
 * MARGA's Mars CRS (IAU_2015:49900): [longitude, latitude] degrees, planetocentric, Mars sphere.
 * The same coordinates the engine and the data use, so nothing is transformed for display, and
 * distances (scale bar) are measured on Mars, not on Earth.
 */
const MAP_PROJECTION = MARS_PROJECTION;
const FIT_PADDING = [56, 56, 56, 56];
const bb = GALE_CRATER_METADATA.bounding_box;
const REGION_EXTENT: Extent = [bb.min_lon, bb.min_lat, bb.max_lon, bb.max_lat];

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const NO_STOPS: LocationPoint[] = [];
const NO_SAMPLES: CheminSample[] = [];
const NO_VIEWS: RoverView[] = [];

/** Wedge on the Mars sphere from a point: radius in metres, azimuths clockwise from north. */
function viewCone(lat: number, lon: number, headingDeg: number, fovDeg: number, radiusM: number): Polygon {
  const k = Math.cos((lat * Math.PI) / 180);
  const pts: number[][] = [[lon, lat]];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const az = ((headingDeg - fovDeg / 2 + (fovDeg * i) / n) * Math.PI) / 180;
    pts.push([lon + (radiusM * Math.sin(az)) / (MARS_METRES_PER_DEGREE * k), lat + (radiusM * Math.cos(az)) / MARS_METRES_PER_DEGREE]);
  }
  pts.push([lon, lat]);
  return new Polygon([pts]);
}
const ALT_KINDS = ['terrain', 'distance', 'time'] as const;
const ALT_LABELS = { terrain: 'Alternative: lowest terrain cost', distance: 'Alternative: shortest', time: 'Alternative: fastest' };

function terrainExtent(t: TerrainLayers): Extent {
  return [t.bounds.min_lon, t.bounds.min_lat, t.bounds.max_lon, t.bounds.max_lat];
}

function makeView(extent: Extent): View {
  const span = Math.max(extent[2] - extent[0], extent[3] - extent[1]);
  return new View({
    projection: MAP_PROJECTION,
    center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
    zoom: 11,
    extent: bufferExtent(extent, span * 0.35),
    showFullExtent: true,
    maxZoom: 17,
  });
}

/** A round scale length (1, 2 or 5 x 10^n m) close to `targetPx` pixels wide. */
function niceScale(metresPerPixel: number, targetPx = 110): { px: number; label: string } {
  const target = metresPerPixel * targetPx;
  const pow = 10 ** Math.floor(Math.log10(target));
  const len = [5, 2, 1].map((s) => s * pow).find((v) => v <= target) ?? pow;
  return { px: len / metresPerPixel, label: len >= 1000 ? `${len / 1000} km` : `${len} m` };
}

function rgba(c: readonly number[], minAlpha = 0): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(minAlpha, c[3] / 255).toFixed(2)})`;
}

const LegendLine: React.FC<{ color: string; dash?: number[]; width?: number; label: string }> = ({
  color,
  dash,
  width = 2.5,
  label,
}) => (
  <div className="flex items-center gap-2">
    <svg width="22" height="8" aria-hidden="true">
      <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth={width} strokeDasharray={dash?.join(' ')} />
    </svg>
    <span>{label}</span>
  </div>
);

const LegendSwatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-2">
    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
    <span>{label}</span>
  </div>
);

export const MarsMap: React.FC<MarsMapProps> = ({
  targets,
  selectedTarget,
  onSelectTarget,
  startPoint,
  destinationPoint,
  onSetStartPoint,
  onSetDestinationPoint,
  route,
  isCalculating,
  stops = NO_STOPS,
  maxSlopeDeg,
  layers,
  highlight,
  onRouteHover,
  focus = null,
  showRouteSummary,
  onCursorMove,
  onTerrainInfo,
  onGisInfo,
  samples = NO_SAMPLES,
  selectedSampleId = null,
  onSelectSample,
  roverViews = NO_VIEWS,
  onSelectRoverView,
  roverLook = null,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OlMap | null>(null);
  const reliefLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const slopeClassLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const demLayerRef = useRef<WebGLTileLayer | null>(null);
  const imageryLayersRef = useRef(new Map<string, WebGLTileLayer>());
  const derivedLayersRef = useRef(new Map<DerivedRasterId, WebGLTileLayer>());
  const vectorLayersRef = useRef(new Map<string, VectorLayer<Feature>>());
  const targetsLayerRef = useRef<VectorLayer<Feature> | null>(null);
  const hazardLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const targetsSourceRef = useRef(new VectorSource());
  const routeSourceRef = useRef(new VectorSource());
  const returnSourceRef = useRef(new VectorSource());
  const altSourceRef = useRef(new VectorSource());
  const waypointsSourceRef = useRef(new VectorSource());
  const coverageSourceRef = useRef(new VectorSource());
  const highlightSourceRef = useRef(new VectorSource());
  const samplesSourceRef = useRef(new VectorSource());
  const roverSourceRef = useRef(new VectorSource());
  const roverLeaderSourceRef = useRef(new VectorSource());
  const roverLeaderLayerRef = useRef<VectorLayer<Feature> | null>(null);
  const coneSourceRef = useRef(new VectorSource());
  const samplesLayerRef = useRef<VectorLayer<Feature> | null>(null);
  const roverLayerRef = useRef<VectorLayer<Feature> | null>(null);
  const terrainRef = useRef<TerrainLayers | null>(null);
  const reliefCacheRef = useRef(new Map<ReliefStyle, string>());
  const hazardCacheRef = useRef(new Map<number, string>());
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callbacks used inside OpenLayers handlers, which are registered once.
  const callbacksRef = useRef({ onSelectTarget, onSetStartPoint, onSetDestinationPoint, onCursorMove, onTerrainInfo, onGisInfo, onRouteHover, onSelectSample, onSelectRoverView });
  callbacksRef.current = { onSelectTarget, onSetStartPoint, onSetDestinationPoint, onCursorMove, onTerrainInfo, onGisInfo, onRouteHover, onSelectSample, onSelectRoverView };
  // The displayed route's elevation profile, for finding the route point under the pointer.
  const profileRef = useRef<Array<{ coordinate: [number, number] }>>([]);
  profileRef.current = layers.route ? route?.elevation_profile ?? [] : [];
  const routeHoverRef = useRef<number | null>(null);

  const [terrain, setTerrain] = useState<TerrainLayers | null>(null);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scale, setScale] = useState<{ px: number; label: string } | null>(null);
  const [gis, setGis] = useState<GisLayerManifest | null>(null);
  const [gisError, setGisError] = useState<string | null>(null);
  const [vectorErrors, setVectorErrors] = useState<Record<string, string>>({});
  const [vectorsLoaded, setVectorsLoaded] = useState(0);

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3500);
  };
  const flashNoticeRef = useRef(flashNotice);
  flashNoticeRef.current = flashNotice;

  // --- map setup (once) ------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const container = mapContainerRef.current;

    // Terrain-grid renderings: the fallback base when the GeoTIFFs are unavailable, and the engine's slope classes.
    const reliefLayer = new ImageLayer<ImageStatic>({ zIndex: 0, visible: false });
    const slopeClassLayer = new ImageLayer<ImageStatic>({ zIndex: 0.5, visible: false });
    const hazardLayer = new ImageLayer<ImageStatic>({ zIndex: 1, visible: false });
    reliefLayerRef.current = reliefLayer;
    slopeClassLayerRef.current = slopeClassLayer;
    hazardLayerRef.current = hazardLayer;

    const coverageLayer = new VectorLayer({ source: coverageSourceRef.current, style: getCoverageStyle(), zIndex: 2 });
    const altLayer = new VectorLayer({ source: altSourceRef.current, zIndex: 4 });
    const returnLayer = new VectorLayer({ source: returnSourceRef.current, style: getReturnRouteStyle(), zIndex: 5 });
    const routeLayer = new VectorLayer({ source: routeSourceRef.current, style: getRouteStyle(), zIndex: 6 });
    const highlightLayer = new VectorLayer({ source: highlightSourceRef.current, style: getHighlightStyle(), zIndex: 8 });
    // Same declutter group: start/destination labels win over target names, which win in list order.
    const targetsLayer = new VectorLayer({ source: targetsSourceRef.current, zIndex: 10, declutter: 'labels' });
    const waypointsLayer = new VectorLayer({ source: waypointsSourceRef.current, zIndex: 15, declutter: 'labels' });
    targetsLayerRef.current = targetsLayer;
    const coneLayer = new VectorLayer({ source: coneSourceRef.current, style: getViewConeStyle(), zIndex: 7.5 });
    const samplesLayer = new VectorLayer({ source: samplesSourceRef.current, zIndex: 9, declutter: 'labels' });
    // Above the target pins: the rover-view badge is drawn beside its stop, so it never hides a pin.
    const roverLayer = new VectorLayer({ source: roverSourceRef.current, zIndex: 12 });
    const roverLeaderLayer = new VectorLayer({ source: roverLeaderSourceRef.current, style: getRoverLeaderStyle(), zIndex: 9.5 });
    samplesLayerRef.current = samplesLayer;
    roverLayerRef.current = roverLayer;
    roverLeaderLayerRef.current = roverLeaderLayer;

    const map = new OlMap({
      target: container,
      layers: [reliefLayer, slopeClassLayer, hazardLayer, coverageLayer, altLayer, returnLayer, routeLayer, coneLayer, highlightLayer, samplesLayer, roverLeaderLayer, roverLayer, targetsLayer, waypointsLayer],
      view: makeView(REGION_EXTENT),
      controls: [],
    });
    map.getView().fit(REGION_EXTENT, { padding: FIT_PADDING });
    mapRef.current = map;

    const updateScale = () => {
      const view = map.getView();
      const res = view.getResolution();
      const center = view.getCenter();
      if (!res || !center) return;
      // Metres per pixel at the map centre, measured on Mars through MARGA's projection.
      setScale(niceScale(getPointResolution(MAP_PROJECTION, res, center, 'm')));
    };
    map.on('moveend', updateScale);
    updateScale();

    const onlyTargets = { layerFilter: (l: unknown) => l === targetsLayer, hitTolerance: 4 };
    const surfaceLayers = {
      layerFilter: (l: unknown) => (l === roverLayer && roverLayer.getVisible()) || (l === samplesLayer && samplesLayer.getVisible()),
      hitTolerance: 4,
    };

    // Single click (not double-click zoom): pick a target, or drop the destination / start (Shift).
    map.on('singleclick', (evt) => {
      const cb = callbacksRef.current;
      let hit: ScienceTarget | undefined;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const t = feature.get('targetData') as ScienceTarget | undefined;
          if (t) {
            hit = t;
            return true;
          }
          return undefined;
        },
        onlyTargets,
      );
      // A rover-view badge (drawn beside its stop) wins over a target pin under it.
      let badge: RoverView | undefined;
      if (roverLayer.getVisible()) {
        map.forEachFeatureAtPixel(
          evt.pixel,
          (feature) => {
            badge = feature.get('roverView') as RoverView | undefined;
            return badge ? true : undefined;
          },
          { layerFilter: (l: unknown) => l === roverLayer, hitTolerance: 1 },
        );
      }
      if (badge && cb.onSelectRoverView) {
        cb.onSelectRoverView(badge);
        return;
      }
      if (hit) {
        cb.onSelectTarget(hit);
        return;
      }
      // Then a rover-view stop, then a CheMin sampling site (only where those layers are shown).
      let view: RoverView | undefined;
      let sample: CheminSample | undefined;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          view = view ?? (feature.get('roverView') as RoverView | undefined);
          sample = sample ?? (feature.get('cheminSample') as CheminSample | undefined);
          return view ? true : undefined;
        },
        surfaceLayers,
      );
      if (view && cb.onSelectRoverView) {
        cb.onSelectRoverView(view);
        return;
      }
      if (sample && cb.onSelectSample) {
        cb.onSelectSample(sample);
        return;
      }

      const [lon, lat] = evt.coordinate;
      const t = terrainRef.current;
      const inside = t
        ? insideTerrain(t, lat, lon)
        : lon >= REGION_EXTENT[0] && lon <= REGION_EXTENT[2] && lat >= REGION_EXTENT[1] && lat <= REGION_EXTENT[3];
      if (!inside) {
        flashNoticeRef.current('Outside the terrain model. Routes can only be planned inside the dashed boundary.');
        return;
      }
      const rlat = round4(lat);
      const rlon = round4(lon);
      if ((evt.originalEvent as MouseEvent).shiftKey) {
        cb.onSetStartPoint({ latitude: rlat, longitude: rlon, name: `Custom start (${rlat}, ${rlon})` });
      } else {
        cb.onSetDestinationPoint({ latitude: rlat, longitude: rlon, name: `Map location (${rlat}, ${rlon})` });
      }
    });

    // Cursor readout: position plus the elevation and slope of the terrain cell under the pointer.
    // The profile point nearest the pointer, if the pointer is within a few pixels of the route.
    const nearestProfileIndex = (lon: number, lat: number): number | null => {
      const pts = profileRef.current;
      const res = map.getView().getResolution();
      if (pts.length < 2 || !res) return null;
      const k = Math.cos((lat * Math.PI) / 180);
      const tol2 = (8 * res) ** 2; // 8 px, in degrees
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = (pts[i].coordinate[0] - lon) * k;
        const dy = pts[i].coordinate[1] - lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 && bestD <= tol2 ? best : null;
    };

    map.on('pointermove', (evt) => {
      if (evt.dragging) return;
      container.style.cursor =
        map.hasFeatureAtPixel(evt.pixel, onlyTargets) || map.hasFeatureAtPixel(evt.pixel, surfaceLayers) ? 'pointer' : 'crosshair';
      const [plon, plat] = evt.coordinate;
      const idx = nearestProfileIndex(plon, plat);
      if (idx !== routeHoverRef.current) {
        routeHoverRef.current = idx;
        callbacksRef.current.onRouteHover?.(idx);
      }
      const report = callbacksRef.current.onCursorMove;
      if (!report) return;
      const [lon, lat] = evt.coordinate;
      const t = terrainRef.current;
      const s = t ? sampleTerrain(t, lat, lon) : null;
      report({
        lat: round4(lat),
        lon: round4(lon),
        elevation_m: s ? Math.round(s.elevation_m) : null,
        slope_deg: s && s.slope_deg !== null ? Math.round(s.slope_deg * 10) / 10 : null,
      });
    });
    const onLeave = () => {
      callbacksRef.current.onCursorMove?.(null);
      if (routeHoverRef.current !== null) {
        routeHoverRef.current = null;
        callbacksRef.current.onRouteHover?.(null);
      }
    };
    map.getViewport().addEventListener('mouseleave', onLeave);

    // Side panes open and close: keep the canvas matched to its container.
    const resize = new ResizeObserver(() => map.updateSize());
    resize.observe(container);

    return () => {
      resize.disconnect();
      map.getViewport().removeEventListener('mouseleave', onLeave);
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  // --- terrain model (once) --------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    loadTerrainLayers()
      .then((t) => {
        if (cancelled) return;
        terrainRef.current = t;
        setTerrain(t);
        callbacksRef.current.onTerrainInfo?.(
          {
            name: t.name,
            synthetic: t.synthetic,
            status: t.status,
            cellSizeM: t.cellSizeM,
            minElevation: t.minElevation,
            maxElevation: t.maxElevation,
            contourInterval: contourInterval(t),
          },
          null,
        );
        const extent = terrainExtent(t);
        coverageSourceRef.current.clear();
        coverageSourceRef.current.addFeature(new Feature(polygonFromExtent(extent)));
        const map = mapRef.current;
        if (map) {
          map.setView(makeView(extent));
          map.getView().fit(extent, { padding: FIT_PADDING });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setTerrainError(msg);
        callbacksRef.current.onTerrainInfo?.(null, msg);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- GIS layers: DEM, imagery, slope/roughness rasters, vectors (frontend/public/gis/<site>) ---
  useEffect(() => {
    let cancelled = false;
    const added: Array<WebGLTileLayer | VectorLayer<Feature>> = [];
    const add = <L extends WebGLTileLayer | VectorLayer<Feature>>(layer: L): L => {
      mapRef.current?.addLayer(layer);
      added.push(layer);
      return layer;
    };
    loadGisManifest()
      .then((m) => {
        if (cancelled || !mapRef.current) return;
        const dem = add(createDemLayer(m, 'relief'));
        dem.setVisible(false);
        demLayerRef.current = dem;
        for (const id of imageryIds(m)) imageryLayersRef.current.set(id, add(createImageryLayer(m.imagery![id].file)));
        (['slope', 'roughness'] as const).forEach((id) => {
          const entry = m.layers[id];
          if (entry) derivedLayersRef.current.set(id, add(createDerivedLayer(id, entry)));
        });
        setGis(m);
        callbacksRef.current.onGisInfo?.(m, null);
        // Vector layers load independently: one missing file doesn't take the others down.
        Object.entries(m.vectors ?? {}).forEach(([id, entry]) => {
          loadVectorLayer(id, entry)
            .then((layer) => {
              if (cancelled || !mapRef.current) {
                layer.dispose();
                return;
              }
              vectorLayersRef.current.set(id, add(layer));
              setVectorsLoaded((n) => n + 1);
            })
            .catch((e: unknown) => {
              if (!cancelled) setVectorErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
            });
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setGisError(msg);
        callbacksRef.current.onGisInfo?.(null, msg);
      });
    return () => {
      cancelled = true;
      for (const layer of added) {
        mapRef.current?.removeLayer(layer);
        layer.dispose();
      }
      demLayerRef.current = null;
      imageryLayersRef.current.clear();
      derivedLayersRef.current.clear();
      vectorLayersRef.current.clear();
    };
  }, []);

  // --- basemap ---------------------------------------------------------------------------------
  useEffect(() => {
    const layer = reliefLayerRef.current;
    const dem = demLayerRef.current;
    if (!layer) return;
    const imageryId = imageryIdOf(layers.base);
    imageryLayersRef.current.forEach((l, id) => l.setVisible(id === imageryId));
    const hillshade = layers.base === 'hillshade';
    // What the DEM contributes: shaded relief (hillshade base + elevation), hillshade alone, or
    // elevation colours alone (over imagery, at the chosen opacity, or with no base).
    const demMode: ReliefStyle | null = hillshade ? (layers.elevation ? 'relief' : 'hillshade') : layers.elevation ? 'elevation' : null;
    const opacity = demMode === 'elevation' && imageryId ? layers.elevationOpacity : 1;
    if (dem && gis) {
      layer.setVisible(false);
      if (!demMode) {
        dem.setVisible(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dem.setStyle(demStyle(demMode, gis) as any);
      dem.setOpacity(opacity);
      dem.setZIndex(imageryId ? 0.2 : 0); // elevation colours sit over the imagery
      dem.setVisible(true);
      return;
    }
    dem?.setVisible(false);
    // Without the GeoTIFFs, the same renderings come from the engine's terrain grid.
    if (!terrain || !demMode) {
      layer.setVisible(false);
      return;
    }
    let url = reliefCacheRef.current.get(demMode);
    if (!url) {
      url = renderRelief(terrain, demMode);
      reliefCacheRef.current.set(demMode, url);
    }
    layer.setSource(new ImageStatic({ url, imageExtent: terrainExtent(terrain), projection: MAP_PROJECTION, interpolate: true }));
    layer.setOpacity(opacity);
    layer.setZIndex(imageryId ? 0.2 : 0);
    layer.setVisible(true);
  }, [terrain, gis, layers.base, layers.elevation, layers.elevationOpacity]);

  // --- slope classes on the engine's routing grid ----------------------------------------------
  useEffect(() => {
    const layer = slopeClassLayerRef.current;
    if (!layer) return;
    if (!terrain || !layers.slope || layers.slopeDisplay !== 'classes') {
      layer.setVisible(false);
      return;
    }
    let url = reliefCacheRef.current.get('slope');
    if (!url) {
      url = renderRelief(terrain, 'slope');
      reliefCacheRef.current.set('slope', url);
    }
    // Classes stay crisp: one pixel per routing cell.
    layer.setSource(new ImageStatic({ url, imageExtent: terrainExtent(terrain), projection: MAP_PROJECTION, interpolate: false }));
    layer.setOpacity(layers.overlayOpacity);
    layer.setVisible(true);
  }, [terrain, layers.slope, layers.slopeDisplay, layers.overlayOpacity]);

  // --- slope-hazard overlay (follows the slope limit) ------------------------------------------
  useEffect(() => {
    const layer = hazardLayerRef.current;
    if (!layer) return;
    if (!terrain || !layers.hazard) {
      layer.setVisible(false);
      return;
    }
    const apply = () => {
      let url = hazardCacheRef.current.get(maxSlopeDeg);
      if (!url) {
        url = renderSlopeHazard(terrain, maxSlopeDeg);
        hazardCacheRef.current.set(maxSlopeDeg, url);
      }
      layer.setSource(
        new ImageStatic({ url, imageExtent: terrainExtent(terrain), projection: MAP_PROJECTION, interpolate: false }),
      );
      layer.setVisible(true);
    };
    if (hazardCacheRef.current.has(maxSlopeDeg)) {
      apply();
      return;
    }
    const timer = setTimeout(apply, 80); // don't re-render on every step while dragging the slider
    return () => clearTimeout(timer);
  }, [terrain, layers.hazard, maxSlopeDeg]);

  // --- GIS overlay visibility: slope/roughness rasters, vector layers, science targets -----------
  useEffect(() => {
    derivedLayersRef.current.forEach((l, id) => {
      l.setVisible(id === 'slope' ? layers.slope && layers.slopeDisplay === 'continuous' : layers.roughness);
      l.setOpacity(layers.overlayOpacity);
    });
    vectorLayersRef.current.forEach((l, id) => l.setVisible(!!layers.vectors[id]));
    targetsLayerRef.current?.setVisible(layers.targets);
    samplesLayerRef.current?.setVisible(layers.samples);
    // The open view's stop always shows, so the cone has its origin.
    roverLayerRef.current?.setVisible(layers.roverViews || !!roverLook);
    roverLeaderLayerRef.current?.setVisible(layers.roverViews || !!roverLook);
  }, [layers, gis, vectorsLoaded, roverLook]);

  // --- CheMin sampling sites -------------------------------------------------------------------
  useEffect(() => {
    const source = samplesSourceRef.current;
    source.clear();
    source.addFeatures(
      samples
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s) => {
          const f = new Feature({ geometry: new Point([s.lon as number, s.lat as number]), cheminSample: s });
          f.setStyle(getSampleStyle(s.name, s.id === selectedSampleId));
          return f;
        }),
    );
  }, [samples, selectedSampleId]);

  // --- rover-view stops and the open view's cone -------------------------------------------------
  const openViewId = roverLook?.view.id ?? null;
  useEffect(() => {
    const source = roverSourceRef.current;
    source.clear();
    source.addFeatures(
      roverViews.map((v) => {
        const f = new Feature({ geometry: new Point([v.lon, v.lat]), roverView: v });
        f.setStyle(getRoverViewStyle(v.id === openViewId));
        return f;
      }),
    );
    roverLeaderSourceRef.current.clear();
    roverLeaderSourceRef.current.addFeatures(roverViews.map((v) => new Feature({ geometry: new Point([v.lon, v.lat]) })));
  }, [roverViews, openViewId]);

  useEffect(() => {
    const source = coneSourceRef.current;
    source.clear();
    if (!roverLook) return;
    const { view, headingDeg, fovDeg } = roverLook;
    source.addFeature(new Feature(viewCone(view.lat, view.lon, headingDeg, fovDeg, 90)));
  }, [roverLook]);

  // Keep the open view's stop in the panel's map inset (Street View style).
  const insetKey = roverLook?.insetCentre ? `${openViewId}:${roverLook.insetCentre.join(',')}` : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !roverLook?.insetCentre) return;
    const view = map.getView();
    const size = map.getSize();
    if (!size) return;
    if ((view.getZoom() ?? 0) < 15) view.setZoom(15);
    view.centerOn([roverLook.view.lon, roverLook.view.lat], size, roverLook.insetCentre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insetKey]);

  // --- target pins -----------------------------------------------------------------------------
  useEffect(() => {
    const source = targetsSourceRef.current;
    source.clear();
    // Selected target first: earlier features win label decluttering.
    const ordered = selectedTarget
      ? [...targets.filter((t) => t.id === selectedTarget.id), ...targets.filter((t) => t.id !== selectedTarget.id)]
      : targets;
    source.addFeatures(
      ordered.map((target) => {
        const feature = new Feature({ geometry: new Point([target.longitude, target.latitude]), targetData: target });
        feature.setStyle(getTargetStyle(target.category, target.name, selectedTarget?.id === target.id));
        return feature;
      }),
    );
  }, [targets, selectedTarget]);

  // --- start & destination markers -------------------------------------------------------------
  useEffect(() => {
    const source = waypointsSourceRef.current;
    source.clear();
    const start = new Feature({ geometry: new Point([startPoint.longitude, startPoint.latitude]) });
    start.setStyle(getWaypointMarkerStyle('start', 'START'));
    source.addFeature(start);
    stops.forEach((s, i) => {
      const f = new Feature({ geometry: new Point([s.longitude, s.latitude]) });
      f.setStyle(getWaypointMarkerStyle('stop', `STOP ${i + 1}`));
      source.addFeature(f);
    });
    if (destinationPoint) {
      const dest = new Feature({ geometry: new Point([destinationPoint.longitude, destinationPoint.latitude]) });
      dest.setStyle(getWaypointMarkerStyle('destination', 'DEST'));
      source.addFeature(dest);
    }
  }, [startPoint, destinationPoint, stops]);

  // --- route geometry: planned route, return route, alternatives (all as returned) -------------
  useEffect(() => {
    const line = (coords: Array<[number, number]> | undefined) =>
      coords && coords.length > 1 ? new Feature({ geometry: new LineString(coords.map((c) => [c[0], c[1]])) }) : null;

    const shown = layers.route ? route : null;
    routeSourceRef.current.clear();
    const main = line(shown?.coordinates);
    if (main) routeSourceRef.current.addFeature(main);

    returnSourceRef.current.clear();
    const ret = layers.returnRoute ? line(shown?.return_route?.coordinates) : null;
    if (ret) returnSourceRef.current.addFeature(ret);

    altSourceRef.current.clear();
    const alts = shown?.alternatives;
    if (layers.alternatives && alts) {
      ALT_KINDS.forEach((kind) => {
        if (alts.selected_metric === kind) return;
        const f = line(alts[kind]?.coordinates);
        if (f) {
          f.setStyle(getAlternativeStyle(kind));
          altSourceRef.current.addFeature(f);
        }
      });
    }
  }, [route, layers.route, layers.returnRoute, layers.alternatives]);

  // --- centre on a point picked on the elevation profile ---------------------------------------
  useEffect(() => {
    if (!focus) return;
    mapRef.current?.getView().animate({ center: focus.coordinate, duration: 300 });
  }, [focus]);

  // --- profile hover marker --------------------------------------------------------------------
  useEffect(() => {
    const source = highlightSourceRef.current;
    source.clear();
    if (highlight) source.addFeature(new Feature({ geometry: new Point([highlight[0], highlight[1]]) }));
  }, [highlight]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  const zoomBy = (delta: number) => {
    const view = mapRef.current?.getView();
    if (!view) return;
    view.animate({ zoom: (view.getZoom() ?? 11) + delta, duration: 200 });
  };

  const handleFit = () => {
    mapRef.current?.getView().fit(terrain ? terrainExtent(terrain) : REGION_EXTENT, { padding: FIT_PADDING, duration: 400 });
  };

  const hasReturn = layers.returnRoute && (route?.return_route?.coordinates.length ?? 0) > 1;
  const altKinds = layers.alternatives && route?.alternatives
    ? ALT_KINDS.filter((k) => route.alternatives?.selected_metric !== k && (route.alternatives?.[k]?.coordinates.length ?? 0) > 1)
    : [];
  const status = routeStatusBadge(route?.status);
  const imageryId = imageryIdOf(layers.base);
  const imagery = imageryId ? gis?.imagery?.[imageryId] ?? null : null;
  const offset = imagery?.registration_summary?.verdict === 'offset' ? imagery.registration_summary.offset_m : null;
  const visibleVectors = gis?.vectors ? Object.keys(gis.vectors).filter((id) => layers.vectors[id] && vectorLayersRef.current.has(id)) : [];
  const ctrl =
    'flex h-7 w-7 items-center justify-center border-line bg-panel text-muted hover:bg-raised hover:text-fg cursor-pointer';

  return (
    <div className="relative h-full w-full overflow-hidden select-none">
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Zoom and fit */}
      <div className="absolute right-3 top-3 z-20 flex flex-col overflow-hidden rounded border border-line">
        <button type="button" onClick={() => zoomBy(1)} className={`${ctrl} border-b`} title="Zoom in" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => zoomBy(-1)} className={`${ctrl} border-b`} title="Zoom out" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" onClick={handleFit} className={ctrl} title="Fit the terrain area" aria-label="Fit the terrain area">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Interaction hint */}
      <div className="absolute left-3 top-3 z-10 rounded border border-line bg-panel/90 px-2 py-1 text-[11px] text-muted">
        Click a target or the map: destination · Shift+click: start · Ringed dot: rover view · Diamond: mineral sample
      </div>

      {notice && (
        <div className="absolute left-3 top-11 z-10 flex items-center gap-1.5 rounded border border-warn/50 bg-panel px-2 py-1 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {isCalculating && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded border border-line bg-panel px-2 py-1 text-[11px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Calculating route…
        </div>
      )}

      {/* Terrain loading / error */}
      {!terrain && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center px-6">
          {terrainError ? (
            <div className="flex max-w-md items-start gap-2 rounded border border-bad/50 bg-panel px-3 py-2 text-xs text-bad">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Terrain model could not be loaded: {terrainError}. Routing is unavailable until the terrain package in
                frontend/public/terrain/gale is restored.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded border border-line bg-panel px-3 py-1.5 text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading terrain model…
            </div>
          )}
        </div>
      )}

      {/* Scale bar (Mars radius, at the map centre) and compact route summary */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
        {showRouteSummary && route && (
          <div className="flex items-center gap-2 rounded border border-line bg-panel/95 px-2 py-1 text-[11px]">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {route.coordinates.length > 1 && (
              <span className="num text-muted">
                {fmtDistance(route.distance_m)} · {fmtDuration(route.estimated_time_min)} outbound
              </span>
            )}
          </div>
        )}
        {scale && (
          <div className="rounded bg-panel/80 px-1.5 py-1 text-[11px] text-muted" title="Scale at the map centre, Mars radius 3,396.19 km">
            <div className="num mb-0.5">{scale.label}</div>
            <div className="h-1.5 border border-t-0 border-fg/70" style={{ width: `${Math.round(scale.px)}px` }} />
          </div>
        )}
      </div>

      {/* Legend: only what is on the map */}
      {terrain && (
        <div className="absolute bottom-3 right-3 z-10 w-52 space-y-1.5 rounded border border-line bg-panel/95 px-2.5 py-2 text-[11px] text-muted">
          {imageryId ? (
            imagery ? (
              <div className="space-y-0.5">
                <div className="text-faint" title={imagery.crs_note}>
                  {imagery.title} · {imagery.resolution_m} m · {MARS_CRS_CODE}
                </div>
                {offset && (
                  <div className="flex items-start gap-1 text-warn" title={imagery.registration_summary?.basis}>
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      Lies ≈{Math.round(offset.total)} m {compassDirection(offset.north, offset.east)} of the DEM
                      (measured). Shown as delivered.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-faint">{gisError ? 'Imagery unavailable: GIS layers did not load' : 'Loading imagery…'}</div>
            )
          ) : (
            (layers.base === 'hillshade' || layers.elevation) && (
              <div className="text-faint" title={gis?.crs.note ?? gisError ?? undefined}>
                {gis
                  ? `DEM raster (GeoTIFF) · ${MARS_CRS_CODE}`
                  : gisError
                  ? 'GeoTIFF layers unavailable: terrain grid'
                  : `Terrain grid · ${MARS_CRS_CODE}`}
              </div>
            )
          )}
          {layers.elevation && (
            <div>
              <div className="h-2 rounded-sm" style={{ background: ELEVATION_RAMP_CSS }} />
              <div className="num mt-0.5 flex justify-between">
                <span>{Math.round(terrain.minElevation)} m</span>
                <span className="text-faint">contours {contourInterval(terrain)} m</span>
                <span>{Math.round(terrain.maxElevation)} m</span>
              </div>
            </div>
          )}
          {layers.slope && layers.slopeDisplay === 'classes' && (
            <div className="space-y-0.5">
              <div className="text-faint">Slope classes (routing grid)</div>
              {(['flat', 'moderate', 'steep', 'hazardous'] as const).map((k) => (
                <LegendSwatch key={k} color={SLOPE_CLASS_COLORS[k]} label={SLOPE_CLASS_LABELS[k]} />
              ))}
            </div>
          )}
          {layers.hazard && (
            <div className="space-y-0.5">
              <LegendSwatch color={rgba(HAZARD_COLORS.impassable, 0.85)} label={`Over ${maxSlopeDeg}°: route avoids`} />
              <LegendSwatch
                color={rgba(HAZARD_COLORS.nearLimit, 0.7)}
                label={`${Math.max(0, maxSlopeDeg - NEAR_LIMIT_DEG)}–${maxSlopeDeg}°: near limit`}
              />
              <LegendSwatch color={rgba(HAZARD_COLORS.noData, 0.9)} label="No elevation data" />
            </div>
          )}
          {layers.slope && layers.slopeDisplay === 'continuous' && gis?.layers.slope && (
            <div title={gis.layers.slope.method}>
              <div className="text-faint">Slope (GeoTIFF)</div>
              <div className="h-2 rounded-sm" style={{ background: rampCss(derivedRamp('slope', gis.layers.slope)) }} />
              <div className="num mt-0.5 flex justify-between">
                <span>0°</span>
                <span>{SLOPE_THRESHOLDS.moderate}°</span>
                <span>{SLOPE_THRESHOLDS.steep + 10}°+</span>
              </div>
            </div>
          )}
          {layers.roughness && gis?.layers.roughness && (
            <div title={gis.layers.roughness.method}>
              <div className="text-faint">Roughness (GeoTIFF)</div>
              <div className="h-2 rounded-sm" style={{ background: rampCss(derivedRamp('roughness', gis.layers.roughness)) }} />
              <div className="num mt-0.5 flex justify-between">
                <span>0 m</span>
                <span>{gis.layers.roughness.p50.toFixed(2)}</span>
                <span>{gis.layers.roughness.p98.toFixed(1)} m+</span>
              </div>
            </div>
          )}
          {visibleVectors.length > 0 && (
            <div className="space-y-0.5 border-t border-line pt-1.5">
              {visibleVectors.map((id) => {
                const entry = gis!.vectors![id];
                const sym = contextLayerSymbol(id);
                const sol = entry.check?.latest_sol_on_line;
                const label = sol != null ? `${entry.title}, to sol ${sol}` : entry.title;
                return sym.kind === 'line' ? (
                  <LegendLine key={id} color={sym.color} dash={sym.dash} width={2} label={label} />
                ) : (
                  <div key={id} className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 ${sym.kind === 'area' ? 'rounded-sm' : 'rounded-full'}`}
                      style={{
                        border: `1.5px ${sym.dash ? 'dashed' : 'solid'} ${sym.color}`,
                        background: sym.kind === 'label' ? sym.color : 'transparent',
                      }}
                    />
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
          {Object.keys(vectorErrors).length > 0 && (
            <div className="flex items-start gap-1 text-warn" title={Object.values(vectorErrors).join('\n')}>
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>{Object.keys(vectorErrors).length} vector layer(s) could not be loaded</span>
            </div>
          )}
          {((layers.samples && samples.length > 0) || (layers.roverViews && roverViews.length > 0)) && (
            <div className="space-y-0.5 border-t border-line pt-1.5">
              {layers.samples && samples.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="ml-0.5 h-2 w-2 shrink-0 rotate-45 border border-black/80" style={{ background: SURFACE_COLORS.sample }} />
                  <span>CheMin samples (NASA PDS)</span>
                </div>
              )}
              {layers.roverViews && roverViews.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border-2 border-white bg-black">
                    <span className="h-1 w-1 rounded-full bg-white" />
                  </span>
                  <span>Rover views (Navcam 360°)</span>
                </div>
              )}
            </div>
          )}
          {layers.route && route && route.coordinates.length > 1 && (
            <div className="space-y-0.5 border-t border-line pt-1.5">
              <LegendLine color={ROUTE_COLORS.route} label="Planned route" />
              {stops.length > 0 && <LegendSwatch color={ROUTE_COLORS.stop} label={`Science stops (${stops.length})`} />}
              {hasReturn && <LegendLine color={ROUTE_COLORS.returnRoute} dash={ROUTE_DASH.returnRoute} width={2} label="Return route" />}
              {altKinds.map((k) => {
                const key = k === 'terrain' ? 'alternativeTerrain' : k === 'distance' ? 'alternativeDistance' : 'alternativeTime';
                return <LegendLine key={k} color={ROUTE_COLORS[key]} dash={ROUTE_DASH[key]} width={1.5} label={ALT_LABELS[k]} />;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
