import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { fromLonLat, toLonLat } from 'ol/proj';
import { ScienceTarget, LocationPoint, RouteResponse } from '@shared/types';
import { getTargetStyle, getRouteStyle, getWaypointMarkerStyle } from './mapStyles';
import { Layers } from 'lucide-react';

interface MarsMapProps {
  targets: ScienceTarget[];
  selectedTarget: ScienceTarget | null;
  onSelectTarget: (target: ScienceTarget | null) => void;
  startPoint: LocationPoint;
  destinationPoint: LocationPoint | null;
  onSetStartPoint: (point: LocationPoint) => void;
  onSetDestinationPoint: (point: LocationPoint) => void;
  currentRoute: RouteResponse | null;
  onCursorMove?: (coords: { lat: number; lon: number } | null) => void;
}

export type BasemapStyle = 'carto_dark' | 'carto_voyager' | 'nasa_mars' | 'mapbox';

export const MarsMap: React.FC<MarsMapProps> = ({
  targets,
  selectedTarget,
  onSelectTarget,
  startPoint,
  destinationPoint,
  onSetStartPoint,
  onSetDestinationPoint,
  currentRoute,
  onCursorMove,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const basemapLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const targetsSourceRef = useRef<VectorSource>(new VectorSource());
  const routeSourceRef = useRef<VectorSource>(new VectorSource());
  const waypointsSourceRef = useRef<VectorSource>(new VectorSource());

  const [activeBasemap, setActiveBasemap] = useState<BasemapStyle>('carto_dark');
  const [showBasemapMenu, setShowBasemapMenu] = useState<boolean>(false);

  // Center on Gale Crater (137.40°E, -4.63°N)
  const GALE_CENTER_LON = 137.40;
  const GALE_CENTER_LAT = -4.63;

  const getTileSource = (style: BasemapStyle) => {
    const mapboxKey = import.meta.env.VITE_MAPBOX_API_KEY?.trim();
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY?.trim();

    switch (style) {
      case 'carto_voyager':
        return new XYZ({
          url: cartoKey
            ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${cartoKey}`
            : 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          crossOrigin: 'anonymous',
        });
      case 'nasa_mars':
        return new XYZ({
          url: cartoKey
            ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${cartoKey}`
            : 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png',
          attributions: 'CARTO Light Baseline | NASA Gale Crater Regional Context',
          crossOrigin: 'anonymous',
        });
      case 'mapbox':
        if (mapboxKey) {
          return new XYZ({
            url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${mapboxKey}`,
            attributions: 'Mapbox Satellite / Dark | Mars Gale Crater Context',
            crossOrigin: 'anonymous',
          });
        }
        return new XYZ({
          url: cartoKey
            ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${cartoKey}`
            : 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
          attributions: 'CARTO Dark Matter',
          crossOrigin: 'anonymous',
        });
      case 'carto_dark':
      default:
        return new XYZ({
          url: cartoKey
            ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${cartoKey}`
            : 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
          attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          crossOrigin: 'anonymous',
        });
    }
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const basemapLayer = new TileLayer({
      source: getTileSource('carto_dark'),
    });
    basemapLayerRef.current = basemapLayer;

    const targetsLayer = new VectorLayer({
      source: targetsSourceRef.current,
      zIndex: 10,
    });

    const routeLayer = new VectorLayer({
      source: routeSourceRef.current,
      style: getRouteStyle(),
      zIndex: 5,
    });

    const waypointsLayer = new VectorLayer({
      source: waypointsSourceRef.current,
      zIndex: 15,
    });

    const initialCenter = fromLonLat([GALE_CENTER_LON, GALE_CENTER_LAT]);

    const map = new Map({
      target: mapContainerRef.current,
      layers: [basemapLayer, routeLayer, targetsLayer, waypointsLayer],
      view: new View({
        center: initialCenter,
        zoom: 12,
        minZoom: 4,
        maxZoom: 18,
      }),
      controls: [],
    });

    mapRef.current = map;

    // Click handler for target selection or setting start/destination
    map.on('click', (evt) => {
      let featureClicked = false;
      map.forEachFeatureAtPixel(evt.pixel, (feature) => {
        const targetData = feature.get('targetData') as ScienceTarget | undefined;
        if (targetData) {
          onSelectTarget(targetData);
          featureClicked = true;
          return true;
        }
      });

      if (!featureClicked) {
        const lonLat = toLonLat(evt.coordinate);
        const lon = Math.round(lonLat[0] * 10000) / 10000;
        const lat = Math.round(lonLat[1] * 10000) / 10000;

        if (evt.originalEvent.shiftKey) {
          onSetStartPoint({ latitude: lat, longitude: lon, name: `Custom Start (${lat}, ${lon})` });
        } else {
          onSetDestinationPoint({
            latitude: lat,
            longitude: lon,
            name: `Map Location (${lat}, ${lon})`,
          });
        }
      }
    });

    // Pointer move handler for coordinates display
    map.on('pointermove', (evt) => {
      const hit = map.hasFeatureAtPixel(evt.pixel);
      if (mapContainerRef.current) {
        mapContainerRef.current.style.cursor = hit ? 'pointer' : 'crosshair';
      }

      if (onCursorMove && evt.coordinate) {
        const lonLat = toLonLat(evt.coordinate);
        onCursorMove({
          lon: Math.round(lonLat[0] * 10000) / 10000,
          lat: Math.round(lonLat[1] * 10000) / 10000,
        });
      }
    });

    return () => {
      map.setTarget(undefined);
    };
  }, []);

  // Handle Basemap Style Changes
  const changeBasemap = (style: BasemapStyle) => {
    setActiveBasemap(style);
    if (basemapLayerRef.current) {
      basemapLayerRef.current.setSource(getTileSource(style));
    }
  };

  // Update target pins
  useEffect(() => {
    const source = targetsSourceRef.current;
    source.clear();

    targets.forEach((target) => {
      const coord = fromLonLat([target.longitude, target.latitude]);
      const feature = new Feature({
        geometry: new Point(coord),
        targetData: target,
      });

      const isSelected = selectedTarget?.id === target.id;
      feature.setStyle(getTargetStyle(target.category, target.name, isSelected));
      source.addFeature(feature);
    });
  }, [targets, selectedTarget]);

  // Update Waypoint Markers (Start & Destination)
  useEffect(() => {
    const source = waypointsSourceRef.current;
    source.clear();

    if (startPoint) {
      const startCoord = fromLonLat([startPoint.longitude, startPoint.latitude]);
      const startFeature = new Feature({
        geometry: new Point(startCoord),
      });
      startFeature.setStyle(getWaypointMarkerStyle('start', `START: ${startPoint.name || 'Rover'}`));
      source.addFeature(startFeature);
    }

    if (destinationPoint) {
      const destCoord = fromLonLat([destinationPoint.longitude, destinationPoint.latitude]);
      const destFeature = new Feature({
        geometry: new Point(destCoord),
      });
      destFeature.setStyle(
        getWaypointMarkerStyle('destination', `DEST: ${destinationPoint.name || 'Target'}`)
      );
      source.addFeature(destFeature);
    }
  }, [startPoint, destinationPoint]);

  // Update Route Polyline
  useEffect(() => {
    const source = routeSourceRef.current;
    source.clear();

    if (currentRoute && currentRoute.coordinates.length > 0) {
      const projectedCoords = currentRoute.coordinates.map((coord) =>
        fromLonLat([coord[0], coord[1]])
      );
      const lineFeature = new Feature({
        geometry: new LineString(projectedCoords),
      });
      source.addFeature(lineFeature);
    }
  }, [currentRoute]);

  const handleZoomIn = () => {
    mapRef.current?.getView().setZoom((mapRef.current.getView().getZoom() || 12) + 1);
  };

  const handleZoomOut = () => {
    mapRef.current?.getView().setZoom((mapRef.current.getView().getZoom() || 12) - 1);
  };

  const handleRecenter = () => {
    mapRef.current?.getView().animate({
      center: fromLonLat([GALE_CENTER_LON, GALE_CENTER_LAT]),
      zoom: 12,
      duration: 500,
    });
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden select-none">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Map Control & Basemap Switcher Buttons */}
      <div className="absolute top-4 right-4 flex flex-col space-y-2 z-20 font-mono">
        <button
          onClick={handleZoomIn}
          className="w-10 h-10 bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border border-cyan-500/30 rounded-lg flex items-center justify-center font-bold text-xl shadow-lg transition-all"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-10 h-10 bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border border-cyan-500/30 rounded-lg flex items-center justify-center font-bold text-xl shadow-lg transition-all"
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={handleRecenter}
          className="w-10 h-10 bg-slate-900/90 hover:bg-slate-800 text-amber-400 border border-amber-500/30 rounded-lg flex items-center justify-center font-bold text-xs shadow-lg transition-all text-center px-1"
          title="Recenter Gale Crater"
        >
          GALE
        </button>

        {/* Layer Switcher Toggle */}
        <div className="relative">
          <button
            onClick={() => setShowBasemapMenu(!showBasemapMenu)}
            className="w-10 h-10 bg-slate-900/90 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 rounded-lg flex items-center justify-center shadow-lg transition-all"
            title="Switch Basemap Layers"
          >
            <Layers className="w-5 h-5" />
          </button>

          {showBasemapMenu && (
            <div className="absolute right-12 top-0 bg-slate-950/95 border border-slate-700 p-2 rounded-xl shadow-2xl space-y-1 w-44 text-[11px] backdrop-blur">
              <span className="text-slate-400 font-bold block px-2 py-1 text-[10px] uppercase border-b border-slate-800">
                Basemap Layers
              </span>
              <button
                onClick={() => {
                  changeBasemap('carto_dark');
                  setShowBasemapMenu(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                  activeBasemap === 'carto_dark'
                    ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-300 hover:bg-slate-850'
                }`}
              >
                <span>CARTO Dark</span>
                {activeBasemap === 'carto_dark' && <span>✓</span>}
              </button>
              <button
                onClick={() => {
                  changeBasemap('carto_voyager');
                  setShowBasemapMenu(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                  activeBasemap === 'carto_voyager'
                    ? 'bg-amber-950 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-300 hover:bg-slate-850'
                }`}
              >
                <span>CARTO Voyager</span>
                {activeBasemap === 'carto_voyager' && <span>✓</span>}
              </button>
              <button
                onClick={() => {
                  changeBasemap('mapbox');
                  setShowBasemapMenu(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                  activeBasemap === 'mapbox'
                    ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-500/40'
                    : 'text-slate-300 hover:bg-slate-850'
                }`}
              >
                <span>Mapbox Dark</span>
                {activeBasemap === 'mapbox' && <span>✓</span>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions Banner */}
      <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur border border-slate-700/60 px-3 py-1.5 rounded text-xs text-slate-300 z-10 flex items-center space-x-2 font-mono">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>Click target or map to set Destination. <strong className="text-amber-400">Shift+Click</strong> sets Start.</span>
      </div>
    </div>
  );
};
