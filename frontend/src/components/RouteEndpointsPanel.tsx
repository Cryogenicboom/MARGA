import React from 'react';
import type { LocationPoint } from '@shared/types';
import { RefreshCw } from 'lucide-react';
import { fmtLatLon } from './format';

interface RouteEndpointsPanelProps {
  start: LocationPoint;
  destination: LocationPoint | null;
  isCalculating: boolean;
  onRecalculate: () => void;
}

const Endpoint: React.FC<{ color: string; label: string; point: LocationPoint | null; hint: string }> = ({
  color,
  label,
  point,
  hint,
}) => (
  <div className="flex items-start gap-2">
    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white/80" style={{ background: color }} />
    <div className="min-w-0">
      <div className="text-[11px] text-faint">{label}</div>
      {point ? (
        <>
          <div className="truncate" title={point.name}>
            {point.name || 'Unnamed point'}
          </div>
          <div className="num text-[11px] text-muted">{fmtLatLon(point.latitude, point.longitude)}</div>
        </>
      ) : (
        <div className="text-faint">Not set</div>
      )}
      <div className="text-[11px] text-faint">{hint}</div>
    </div>
  </div>
);

/** Start and destination of the route. The route re-plans automatically when either changes. */
export const RouteEndpointsPanel: React.FC<RouteEndpointsPanelProps> = ({
  start,
  destination,
  isCalculating,
  onRecalculate,
}) => (
  <div className="space-y-2.5">
    <Endpoint color="#5fb58a" label="Start" point={start} hint="Shift+click the map, or a target's Set as start" />
    <Endpoint color="#e06c5f" label="Destination" point={destination} hint="Click the map or a target" />
    <button
      type="button"
      onClick={onRecalculate}
      disabled={isCalculating || !destination}
      className="flex w-full items-center justify-center gap-1.5 rounded border border-line px-2 py-1.5 text-muted hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
      {isCalculating ? 'Calculating…' : 'Recalculate route'}
    </button>
  </div>
);
