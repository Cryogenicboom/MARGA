import React from 'react';
import type { CursorInfo, TerrainInfo } from '../map/MarsMap';
import { fmtLatLon } from './format';

interface DataProvenanceFooterProps {
  cursor: CursorInfo | null;
  startName: string;
  destName: string;
  terrain: TerrainInfo | null;
  engineMode: string;
}

/** Status bar: cursor position and terrain under it, route endpoints, data and engine provenance. */
export const DataProvenanceFooter: React.FC<DataProvenanceFooterProps> = ({ cursor, startName, destName, terrain, engineMode }) => (
  <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-muted">
    <div className="num w-[22rem] shrink-0 truncate">
      {cursor ? (
        <>
          <span className="text-fg">{fmtLatLon(cursor.lat, cursor.lon)}</span>
          {cursor.elevation_m !== null && (
            <>
              <span className="text-faint"> · </span>
              {cursor.elevation_m} m
              {cursor.slope_deg !== null && (
                <>
                  <span className="text-faint"> · </span>slope {cursor.slope_deg}°
                </>
              )}
            </>
          )}
        </>
      ) : (
        <span className="text-faint">Move the pointer over the map for position, elevation and slope</span>
      )}
    </div>
    <div className="hidden min-w-0 flex-1 truncate md:block">
      <span className="text-faint">Route </span>
      {startName}
      <span className="text-faint"> → </span>
      {destName}
    </div>
    <div className="ml-auto hidden min-w-0 shrink truncate lg:block" title={terrain?.name}>
      {terrain ? `${terrain.name} · ${terrain.cellSizeM.toFixed(0)} m cells` : 'Terrain not loaded'}
    </div>
    <div className="shrink-0 text-faint">{engineMode}</div>
  </footer>
);
