import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GisLayerManifest } from '../map/demLayer';
import { compassDirection, imageryIds } from '../map/gisLayers';
import type { BaseImagery, MapLayers } from '../map/layers';

interface MapLayerControlsProps {
  layers: MapLayers;
  onChange: (layers: MapLayers) => void;
  maxSlopeDeg: number;
  /** GIS layer manifest: which imagery, rasters and context layers exist. Null until loaded. */
  gis: GisLayerManifest | null;
}

const Check: React.FC<{
  checked: boolean;
  onChange: () => void;
  title?: string;
  indent?: boolean;
  children: React.ReactNode;
}> = ({ checked, onChange, title, indent, children }) => (
  <label
    className={`flex cursor-pointer items-start gap-2 rounded py-0.5 hover:bg-raised ${indent ? 'pl-6 pr-1' : 'px-1'}`}
    title={title}
  >
    <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" />
    <span className="min-w-0">{children}</span>
  </label>
);

const Opacity: React.FC<{ value: number; onChange: (v: number) => void; label: string }> = ({ value, onChange, label }) => (
  <div className="flex items-center gap-2 py-0.5 pl-6 pr-1 text-[11px] text-faint">
    <span className="shrink-0">Opacity</span>
    <input
      type="range"
      min={0.2}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="min-w-0 flex-1"
      aria-label={label}
    />
    <span className="num w-8 text-right">{Math.round(value * 100)}%</span>
  </div>
);

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-0.5 mt-2.5 text-[11px] text-faint first:mt-0">{children}</div>
);

/**
 * Independent map layers. Base imagery is one choice; elevation, slope, roughness, targets and the
 * planned route switch on and off separately above it. Only layers that exist are offered.
 */
export const MapLayerControls: React.FC<MapLayerControlsProps> = ({ layers, onChange, maxSlopeDeg, gis }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const set = (patch: Partial<MapLayers>) => onChange({ ...layers, ...patch });
  const flip = (
    k: 'elevation' | 'slope' | 'hazard' | 'roughness' | 'targets' | 'route' | 'returnRoute' | 'alternatives' | 'samples' | 'roverViews',
  ) =>
    set({ [k]: !layers[k] } as Partial<MapLayers>);

  const bases: Array<{ id: BaseImagery; label: React.ReactNode; note: string }> = [
    ...imageryIds(gis).map((id) => {
      const e = gis!.imagery![id];
      const off = e.registration_summary?.verdict === 'offset' ? e.registration_summary.offset_m : null;
      return {
        id: `imagery:${id}` as BaseImagery,
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
    }),
    { id: 'hillshade', label: 'Hillshade (from the DEM)', note: 'Grey shading computed from the elevation model' },
    { id: 'none', label: 'None', note: 'No base layer' },
  ];
  const overImagery = layers.base.startsWith('imagery:');
  const vectors = Object.entries(gis?.vectors ?? {});
  const vectorsOn = vectors.filter(([id]) => layers.vectors[id]).length;
  const segBtn = (active: boolean) =>
    `px-1.5 py-px cursor-pointer ${active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`;

  return (
    <div>
      <GroupLabel>Base imagery</GroupLabel>
      <div role="radiogroup" aria-label="Base imagery">
        {bases.map((b) => (
          <label key={b.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-raised" title={b.note}>
            <input type="radio" name="base-imagery" checked={layers.base === b.id} onChange={() => set({ base: b.id })} className="mt-0.5" />
            <span className="min-w-0">{b.label}</span>
          </label>
        ))}
      </div>

      <GroupLabel>Terrain</GroupLabel>
      <Check checked={layers.elevation} onChange={() => flip('elevation')} title="Elevation colours with contours, from the DEM">
        Elevation{layers.base === 'hillshade' && layers.elevation ? <span className="text-faint"> (shaded relief)</span> : null}
      </Check>
      {layers.elevation && overImagery && (
        <Opacity value={layers.elevationOpacity} onChange={(v) => set({ elevationOpacity: v })} label="Elevation opacity" />
      )}
      <div className="flex items-start justify-between gap-2">
        <Check checked={layers.slope} onChange={() => flip('slope')} title="Terrain slope from the DEM">
          Slope
        </Check>
        {layers.slope && (
          <div className="mt-0.5 flex shrink-0 overflow-hidden rounded border border-line text-[11px]" role="group" aria-label="Slope display">
            <button
              type="button"
              className={segBtn(layers.slopeDisplay === 'continuous')}
              aria-pressed={layers.slopeDisplay === 'continuous'}
              onClick={() => set({ slopeDisplay: 'continuous' })}
              disabled={!gis?.layers.slope}
              title={gis?.layers.slope?.method ?? 'The slope GeoTIFF is not available'}
            >
              Continuous
            </button>
            <button
              type="button"
              className={`${segBtn(layers.slopeDisplay === 'classes')} border-l border-line`}
              aria-pressed={layers.slopeDisplay === 'classes'}
              onClick={() => set({ slopeDisplay: 'classes' })}
              title="The engine's slope classes on its 20 m routing grid"
            >
              Classes
            </button>
          </div>
        )}
      </div>
      <Check checked={layers.hazard} onChange={() => flip('hazard')} indent title="Follows the slope-limit constraint">
        Slope-limit hazard (over {maxSlopeDeg}°)
      </Check>
      {gis?.layers.roughness && (
        <Check checked={layers.roughness} onChange={() => flip('roughness')} title={gis.layers.roughness.method}>
          Roughness
        </Check>
      )}
      {((layers.slope && layers.slopeDisplay === 'continuous' && gis?.layers.slope) ||
        (layers.slope && layers.slopeDisplay === 'classes') ||
        (layers.roughness && gis?.layers.roughness)) && (
        <Opacity value={layers.overlayOpacity} onChange={(v) => set({ overlayOpacity: v })} label="Slope and roughness opacity" />
      )}

      <GroupLabel>Mission</GroupLabel>
      <Check checked={layers.targets} onChange={() => flip('targets')}>
        Scientific targets
      </Check>
      <Check checked={layers.route} onChange={() => flip('route')}>
        Planned route
      </Check>
      {layers.route && (
        <>
          <Check checked={layers.returnRoute} onChange={() => flip('returnRoute')} indent>
            Return route
          </Check>
          <Check checked={layers.alternatives} onChange={() => flip('alternatives')} indent>
            Route alternatives
          </Check>
        </>
      )}

      <GroupLabel>Curiosity surface data</GroupLabel>
      <Check checked={layers.samples} onChange={() => flip('samples')} title="CheMin X-ray diffraction mineralogy, NASA PDS. Click a diamond for its record.">
        CheMin mineral samples
      </Check>
      <Check checked={layers.roverViews} onChange={() => flip('roverViews')} title="360° Navcam panoramas at rover stops. Click a stop to look around.">
        Rover views (Navcam 360°)
      </Check>

      {vectors.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            className="flex w-full items-center gap-1 text-left text-[11px] text-faint hover:text-fg cursor-pointer"
          >
            {moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            More layers: NASA Mars Trek context ({vectorsOn}/{vectors.length} on)
          </button>
          {moreOpen &&
            vectors.map(([id, e]) => (
              <Check
                key={id}
                checked={!!layers.vectors[id]}
                onChange={() => set({ vectors: { ...layers.vectors, [id]: !layers.vectors[id] } })}
                indent
                title={`${e.features_in_region} feature(s) · ${e.source}`}
              >
                {e.title}
              </Check>
            ))}
        </div>
      )}
    </div>
  );
};
