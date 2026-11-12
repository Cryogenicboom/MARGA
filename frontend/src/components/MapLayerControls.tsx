import React from 'react';
import type { BasemapStyle, MapOverlays } from '../map/MarsMap';
import type { GisLayerManifest } from '../map/demLayer';
import { compassDirection, imageryIds } from '../map/gisLayers';

interface MapLayerControlsProps {
  basemap: BasemapStyle;
  onBasemapChange: (b: BasemapStyle) => void;
  overlays: MapOverlays;
  onOverlaysChange: (o: MapOverlays) => void;
  maxSlopeDeg: number;
  /** GIS layer manifest: which imagery, rasters and vector layers exist. Null until loaded. */
  gis: GisLayerManifest | null;
}

const TERRAIN_BASEMAPS: Array<{ id: BasemapStyle; label: string; note: string }> = [
  { id: 'relief', label: 'Shaded relief', note: 'Elevation colours with hillshade and contours (DEM GeoTIFF)' },
  { id: 'elevation', label: 'Elevation', note: 'Elevation colours and contours (DEM GeoTIFF)' },
  { id: 'slope', label: 'Slope classes', note: 'The engine’s slope classes on its 20 m routing grid' },
  { id: 'hillshade', label: 'Hillshade', note: 'Grey shading with contours (DEM GeoTIFF)' },
];

const Row: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-raised" title={title}>
    {children}
  </label>
);

const Legend: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <legend className="mb-1 text-[11px] text-faint">{children}</legend>
);

/**
 * Basemap and overlay choices for the map. Terrain renderings come from the DEM; imagery, the slope
 * and roughness rasters and the context layers come from the GIS manifest (NASA Mars Trek data
 * processed by gis/marga_gis), so only layers that exist are offered.
 */
export const MapLayerControls: React.FC<MapLayerControlsProps> = ({
  basemap,
  onBasemapChange,
  overlays,
  onOverlaysChange,
  maxSlopeDeg,
  gis,
}) => {
  const toggle = (k: 'hazard' | 'returnRoute' | 'alternatives' | 'targets' | 'slope' | 'roughness') =>
    onOverlaysChange({ ...overlays, [k]: !overlays[k] });
  const toggleVector = (id: string) =>
    onOverlaysChange({ ...overlays, vectors: { ...overlays.vectors, [id]: !overlays.vectors[id] } });
  const radio = (b: { id: BasemapStyle; label: React.ReactNode; note: string }) => (
    <Row key={b.id} title={b.note}>
      <input type="radio" name="basemap" checked={basemap === b.id} onChange={() => onBasemapChange(b.id)} className="mt-0.5" />
      <span className="min-w-0">{b.label}</span>
    </Row>
  );
  const imagery = imageryIds(gis).map((id) => {
    const e = gis!.imagery![id];
    const off = e.registration_summary?.verdict === 'offset' ? e.registration_summary.offset_m : null;
    return {
      id: `imagery:${id}` as BasemapStyle,
      note: `${e.catalogue_title ?? e.title} (${e.product_label}), ${e.resolution_m} m${
        off ? `. Lies about ${Math.round(off.total)} m ${compassDirection(off.north, off.east)} of the DEM (measured).` : ''
      }`,
      label: (
        <span>
          {e.title} <span className="num text-faint">{e.resolution_m} m</span>
          {off && <span className="text-warn"> · offset ≈{Math.round(off.total)} m</span>}
        </span>
      ),
    };
  });
  const vectors = Object.entries(gis?.vectors ?? {});
  const slope = gis?.layers.slope;
  const roughness = gis?.layers.roughness;

  return (
    <div className="space-y-3">
      <fieldset>
        <Legend>Basemap</Legend>
        <div className="space-y-0.5">
          {TERRAIN_BASEMAPS.map(radio)}
          {imagery.map(radio)}
          {radio({ id: 'none', label: 'None', note: 'Vectors only' })}
        </div>
      </fieldset>

      <fieldset>
        <Legend>Terrain overlays</Legend>
        <div className="space-y-0.5">
          <Row>
            <input type="checkbox" checked={overlays.hazard} onChange={() => toggle('hazard')} className="mt-0.5" />
            <span>Slope hazard (over {maxSlopeDeg}°)</span>
          </Row>
          {slope && (
            <Row title={slope.method}>
              <input type="checkbox" checked={overlays.slope} onChange={() => toggle('slope')} className="mt-0.5" />
              <span>Slope, continuous</span>
            </Row>
          )}
          {roughness && (
            <Row title={roughness.method}>
              <input type="checkbox" checked={overlays.roughness} onChange={() => toggle('roughness')} className="mt-0.5" />
              <span>Surface roughness</span>
            </Row>
          )}
          {(slope || roughness) && (
            <div className="flex items-center gap-2 px-1 pt-0.5 text-[11px] text-faint">
              <span>Opacity</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={overlays.rasterOpacity}
                onChange={(e) => onOverlaysChange({ ...overlays, rasterOpacity: Number(e.target.value) })}
                className="min-w-0 flex-1"
                aria-label="Slope and roughness overlay opacity"
              />
              <span className="num w-8 text-right">{Math.round(overlays.rasterOpacity * 100)}%</span>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset>
        <Legend>Science and context</Legend>
        <div className="space-y-0.5">
          <Row>
            <input type="checkbox" checked={overlays.targets} onChange={() => toggle('targets')} className="mt-0.5" />
            <span>Science targets</span>
          </Row>
          {vectors.map(([id, e]) => (
            <Row key={id} title={`${e.features_in_region} feature(s) · ${e.source}`}>
              <input type="checkbox" checked={!!overlays.vectors[id]} onChange={() => toggleVector(id)} className="mt-0.5" />
              <span className="min-w-0">{e.title}</span>
            </Row>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <Legend>Route</Legend>
        <div className="space-y-0.5">
          <Row>
            <input type="checkbox" checked={overlays.returnRoute} onChange={() => toggle('returnRoute')} className="mt-0.5" />
            <span>Return route</span>
          </Row>
          <Row>
            <input type="checkbox" checked={overlays.alternatives} onChange={() => toggle('alternatives')} className="mt-0.5" />
            <span>Alternative routes</span>
          </Row>
        </div>
      </fieldset>
    </div>
  );
};
