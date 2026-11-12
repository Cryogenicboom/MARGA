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
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { buffer as bufferExtent, type Extent } from 'ol/extent';
import { getPointResolution } from 'ol/proj';
import type WebGLTileLayer from 'ol/layer/WebGLTile';
import { ScienceTarget, LocationPoint } from '@shared/types';
import type { EngineRouteResponse } from '@shared/types/engine';
import { MARS_CRS_CODE } from '@shared/gis/marsCrs';
import { MARS_PROJECTION } from './projection';
import { createDemLayer, demStyle, loadGisManifest, type GisLayerManifest } from './demLayer';
import {
  createDerivedLayer,
  createImageryLayer,
  derivedRamp,
  imageryIds,
  compassDirection,
  imageryIdOf,
  isImageryBasemap,
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

/** Terrain renderings, an orbital image from the GIS manifest ('imagery:<id>'), or nothing. */
export type BasemapStyle = ReliefStyle | 'none' | `imagery:${string}`;

export interface MapOverlays {
  hazard: boolean;
  returnRoute: boolean;
  alternatives: boolean;
  /** Science target pins and names. */
  targets: boolean;
  /** Continuous slope from the slope GeoTIFF. */
  slope: boolean;
  /** Surface roughness from the roughness GeoTIFF. */
  roughness: boolean;
  /** Vector layer id (layers.json "vectors") -> visible. */
  vectors: Record<string, boolean>;
  /** Opacity of the slope and roughness rasters, 0-1. */
  rasterOpacity: number;
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
  /** Current slope limit: drives the slope-hazard overlay. */
  maxSlopeDeg: number;
  basemap: BasemapStyle;
  overlays: MapOverlays;
  /** Profile point under the cursor ([lon, lat] from the engine's elevation profile). */
  highlight: [number, number] | null;
  /** Show a one-line route summary on the map (when the inspector pane is collapsed). */
  showRouteSummary: boolean;
  onCursorMove?: (info: CursorInfo | null) => void;
  onTerrainInfo?: (info: TerrainInfo | null, error: string | null) => void;
  /** The GIS layer manifest (layers.json) once loaded, for the layer controls and provenance. */
  onGisInfo?: (manifest: GisLayerManifest | null, error: string | null) => void;
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
  maxSlopeDeg,
  basemap,
  overlays,
  highlight,
  showRouteSummary,
  onCursorMove,
  onTerrainInfo,
  onGisInfo,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OlMap | null>(null);
  const reliefLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
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
  const terrainRef = useRef<TerrainLayers | null>(null);
  const reliefCacheRef = useRef(new Map<ReliefStyle, string>());
  const hazardCacheRef = useRef(new Map<number, string>());
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callbacks used inside OpenLayers handlers, which are registered once.
  const callbacksRef = useRef({ onSelectTarget, onSetStartPoint, onSetDestinationPoint, onCursorMove, onTerrainInfo, onGisInfo });
  callbacksRef.current = { onSelectTarget, onSetStartPoint, onSetDestinationPoint, onCursorMove, onTerrainInfo, onGisInfo };

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

    const reliefLayer = new ImageLayer<ImageStatic>({ zIndex: 0, visible: false });
    const hazardLayer = new ImageLayer<ImageStatic>({ zIndex: 1, visible: false });
    reliefLayerRef.current = reliefLayer;
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

    const map = new OlMap({
      target: container,
      layers: [reliefLayer, hazardLayer, coverageLayer, altLayer, returnLayer, routeLayer, highlightLayer, targetsLayer, waypointsLayer],
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
      if (hit) {
        cb.onSelectTarget(hit);
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
    map.on('pointermove', (evt) => {
      if (evt.dragging) return;
      container.style.cursor = map.hasFeatureAtPixel(evt.pixel, onlyTargets) ? 'pointer' : 'crosshair';
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
    const onLeave = () => callbacksRef.current.onCursorMove?.(null);
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
    // Orbital imagery from the GIS manifest.
    const imageryId = imageryIdOf(basemap);
    imageryLayersRef.current.forEach((l, id) => l.setVisible(id === imageryId));
    if (isImageryBasemap(basemap)) {
      dem?.setVisible(false);
      layer.setVisible(false);
      return;
    }
    // Relief, elevation and hillshade come from the GeoTIFF raster values when it is available.
    if (dem && gis && (basemap === 'relief' || basemap === 'elevation' || basemap === 'hillshade')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dem.setStyle(demStyle(basemap, gis) as any);
      dem.setVisible(true);
      layer.setVisible(false);
      return;
    }
    dem?.setVisible(false);
    // Slope classes (and every style, if the GeoTIFF layers are unavailable) are drawn from the
    // engine's terrain grid.
    if (!terrain || basemap === 'none') {
      layer.setVisible(false);
      return;
    }
    let url = reliefCacheRef.current.get(basemap);
    if (!url) {
      url = renderRelief(terrain, basemap);
      reliefCacheRef.current.set(basemap, url);
    }
    // Classes stay crisp (one pixel per routing cell); continuous shading is interpolated.
    layer.setSource(
      new ImageStatic({ url, imageExtent: terrainExtent(terrain), projection: MAP_PROJECTION, interpolate: basemap !== 'slope' }),
    );
    layer.setVisible(true);
  }, [terrain, basemap, gis]);

  // --- slope-hazard overlay (follows the slope limit) ------------------------------------------
  useEffect(() => {
    const layer = hazardLayerRef.current;
    if (!layer) return;
    if (!terrain || !overlays.hazard) {
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
  }, [terrain, overlays.hazard, maxSlopeDeg]);

  // --- GIS overlay visibility: slope/roughness rasters, vector layers, science targets -----------
  useEffect(() => {
    derivedLayersRef.current.forEach((l, id) => {
      l.setVisible(overlays[id]);
      l.setOpacity(overlays.rasterOpacity);
    });
    vectorLayersRef.current.forEach((l, id) => l.setVisible(!!overlays.vectors[id]));
    targetsLayerRef.current?.setVisible(overlays.targets);
  }, [overlays, gis, vectorsLoaded]);

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
    if (destinationPoint) {
      const dest = new Feature({ geometry: new Point([destinationPoint.longitude, destinationPoint.latitude]) });
      dest.setStyle(getWaypointMarkerStyle('destination', 'DEST'));
      source.addFeature(dest);
    }
  }, [startPoint, destinationPoint]);

  // --- route geometry: planned route, return route, alternatives (all as returned) -------------
  useEffect(() => {
    const line = (coords: Array<[number, number]> | undefined) =>
      coords && coords.length > 1 ? new Feature({ geometry: new LineString(coords.map((c) => [c[0], c[1]])) }) : null;

    routeSourceRef.current.clear();
    const main = line(route?.coordinates);
    if (main) routeSourceRef.current.addFeature(main);

    returnSourceRef.current.clear();
    const ret = overlays.returnRoute ? line(route?.return_route?.coordinates) : null;
    if (ret) returnSourceRef.current.addFeature(ret);

    altSourceRef.current.clear();
    const alts = route?.alternatives;
    if (overlays.alternatives && alts) {
      (['distance', 'time'] as const).forEach((kind) => {
        if (alts.selected_metric === kind) return;
        const f = line(alts[kind]?.coordinates);
        if (f) {
          f.setStyle(getAlternativeStyle(kind));
          altSourceRef.current.addFeature(f);
        }
      });
    }
  }, [route, overlays.returnRoute, overlays.alternatives]);

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

  const hasReturn = overlays.returnRoute && (route?.return_route?.coordinates.length ?? 0) > 1;
  const altKinds = overlays.alternatives && route?.alternatives
    ? (['distance', 'time'] as const).filter(
        (k) => route.alternatives?.selected_metric !== k && (route.alternatives?.[k]?.coordinates.length ?? 0) > 1,
      )
    : [];
  const status = routeStatusBadge(route?.status);
  const imageryId = imageryIdOf(basemap);
  const imagery = imageryId ? gis?.imagery?.[imageryId] ?? null : null;
  const offset = imagery?.registration_summary?.verdict === 'offset' ? imagery.registration_summary.offset_m : null;
  const visibleVectors = gis?.vectors ? Object.keys(gis.vectors).filter((id) => overlays.vectors[id] && vectorLayersRef.current.has(id)) : [];
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
        Click a target or the map: destination · Shift+click: start
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
            basemap !== 'none' && (
              <div className="text-faint" title={gis?.crs.note ?? gisError ?? undefined}>
                {gis && basemap !== 'slope'
                  ? `DEM raster (GeoTIFF) · ${MARS_CRS_CODE}`
                  : gisError
                  ? 'GeoTIFF layers unavailable: terrain grid'
                  : `Terrain grid · ${MARS_CRS_CODE}`}
              </div>
            )
          )}
          {(basemap === 'relief' || basemap === 'elevation') && (
            <div>
              <div className="h-2 rounded-sm" style={{ background: ELEVATION_RAMP_CSS }} />
              <div className="num mt-0.5 flex justify-between">
                <span>{Math.round(terrain.minElevation)} m</span>
                <span className="text-faint">contours {contourInterval(terrain)} m</span>
                <span>{Math.round(terrain.maxElevation)} m</span>
              </div>
            </div>
          )}
          {basemap === 'slope' && (
            <div className="space-y-0.5">
              {(['flat', 'moderate', 'steep', 'hazardous'] as const).map((k) => (
                <LegendSwatch key={k} color={SLOPE_CLASS_COLORS[k]} label={SLOPE_CLASS_LABELS[k]} />
              ))}
            </div>
          )}
          {overlays.hazard && (
            <div className="space-y-0.5">
              <LegendSwatch color={rgba(HAZARD_COLORS.impassable, 0.85)} label={`Over ${maxSlopeDeg}°: route avoids`} />
              <LegendSwatch
                color={rgba(HAZARD_COLORS.nearLimit, 0.7)}
                label={`${Math.max(0, maxSlopeDeg - NEAR_LIMIT_DEG)}–${maxSlopeDeg}°: near limit`}
              />
              <LegendSwatch color={rgba(HAZARD_COLORS.noData, 0.9)} label="No elevation data" />
            </div>
          )}
          {overlays.slope && gis?.layers.slope && (
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
          {overlays.roughness && gis?.layers.roughness && (
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
          {route && route.coordinates.length > 1 && (
            <div className="space-y-0.5 border-t border-line pt-1.5">
              <LegendLine color={ROUTE_COLORS.route} label="Planned route" />
              {hasReturn && <LegendLine color={ROUTE_COLORS.returnRoute} dash={ROUTE_DASH.returnRoute} width={2} label="Return route" />}
              {altKinds.includes('distance') && (
                <LegendLine color={ROUTE_COLORS.alternativeDistance} dash={ROUTE_DASH.alternativeDistance} width={1.5} label="Alternative: shortest" />
              )}
              {altKinds.includes('time') && (
                <LegendLine color={ROUTE_COLORS.alternativeTime} dash={ROUTE_DASH.alternativeTime} width={1.5} label="Alternative: fastest" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
