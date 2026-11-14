import React from 'react';
import type { LocationPoint, ScienceTarget } from '@shared/types';
import type { EngineMissionConstraints, EngineRouteResponse, RouteMetric } from '@shared/types/engine';
import { ArrowDown, ArrowUp, Plus, RefreshCw, X } from 'lucide-react';
import { Disclosure } from './Section';
import { MissionConstraintsPanel } from './MissionConstraintsPanel';
import { fmtDistance, fmtDuration, fmtLatLon } from './format';
import { ROUTE_COLORS } from '../map/mapStyles';

/** A science stop between the start and the destination, in route order. */
export interface PlannedStop {
  point: LocationPoint;
  targetId?: string;
}

const METRICS: Array<{ id: RouteMetric; label: string; note: string }> = [
  { id: 'terrain', label: 'Lowest terrain cost', note: 'Avoids steep and rough ground (the engine default)' },
  { id: 'distance', label: 'Shortest distance', note: 'Fewest metres within the slope limit' },
  { id: 'time', label: 'Fastest time', note: 'Least walking time with the slope-dependent speed model' },
];

interface RoutePlanningPanelProps {
  start: LocationPoint;
  destination: LocationPoint | null;
  stops: PlannedStop[];
  selectedTarget: ScienceTarget | null;
  onAddStop: (t: ScienceTarget) => void;
  onMoveStop: (index: number, delta: -1 | 1) => void;
  onRemoveStop: (index: number) => void;
  metric: RouteMetric;
  onMetricChange: (m: RouteMetric) => void;
  route: EngineRouteResponse | null;
  isCalculating: boolean;
  onRecalculate: () => void;
  constraints: EngineMissionConstraints;
  onChangeConstraints: (c: EngineMissionConstraints) => void;
}

const Point: React.FC<{ color: string; label: string; point: LocationPoint | null; hint: string }> = ({ color, label, point, hint }) => (
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

/**
 * Route planning: starting hub, science stops in order, destination, how the engine should choose
 * the route (its three alternatives), constraints and recalculation. Stops and the route choice are
 * sent in the engine's existing request fields (waypoints, options.metric).
 */
export const RoutePlanningPanel: React.FC<RoutePlanningPanelProps> = ({
  start,
  destination,
  stops,
  selectedTarget,
  onAddStop,
  onMoveStop,
  onRemoveStop,
  metric,
  onMetricChange,
  route,
  isCalculating,
  onRecalculate,
  constraints,
  onChangeConstraints,
}) => {
  const iconBtn =
    'rounded p-0.5 text-faint hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent';
  const sameAs = (p: LocationPoint | null, t: ScienceTarget) => !!p && p.latitude === t.latitude && p.longitude === t.longitude;
  const canAddSelected =
    !!selectedTarget &&
    !stops.some((s) => s.targetId === selectedTarget.id) &&
    !sameAs(destination, selectedTarget) &&
    !sameAs(start, selectedTarget) &&
    stops.length < 25;
  const alts = route?.alternatives ?? null;

  return (
    <div className="space-y-2.5">
      <Point color={ROUTE_COLORS.start} label="Starting hub" point={start} hint="Shift+click the map, or a target's Set as start" />

      <div className="pl-[18px]">
        <div className="text-[11px] text-faint">Science stops{stops.length ? ` (${stops.length})` : ''}</div>
        {stops.length === 0 && <div className="text-[11px] text-faint">None: the route goes straight to the destination.</div>}
        <ol className="space-y-0.5">
          {stops.map((s, i) => (
            <li key={`${s.targetId ?? s.point.name}-${i}`} className="flex items-center gap-1.5">
              <span
                className="num flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-[#0b0d10]"
                style={{ background: ROUTE_COLORS.stop }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate" title={s.point.name}>
                {s.point.name}
              </span>
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onMoveStop(i, -1)} aria-label={`Move ${s.point.name} earlier`}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconBtn}
                disabled={i === stops.length - 1}
                onClick={() => onMoveStop(i, 1)}
                aria-label={`Move ${s.point.name} later`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconBtn} onClick={() => onRemoveStop(i)} aria-label={`Remove ${s.point.name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={!canAddSelected}
          onClick={() => selectedTarget && onAddStop(selectedTarget)}
          className="mt-1 flex items-center gap-1 text-[11px] text-muted hover:text-fg cursor-pointer disabled:cursor-default disabled:text-faint disabled:opacity-60"
          title={selectedTarget ? `Add ${selectedTarget.name} as the next stop` : 'Select a target on the map or in the catalogue first'}
        >
          <Plus className="h-3 w-3" />
          {selectedTarget && canAddSelected ? `Add ${selectedTarget.name}` : 'Add the selected target as a stop'}
        </button>
      </div>

      <Point color={ROUTE_COLORS.destination} label="Destination" point={destination} hint="Click the map or a target" />

      <div>
        <div className="mb-0.5 text-[11px] text-faint">Route alternatives (plan by)</div>
        <div role="radiogroup" aria-label="Route alternative">
          {METRICS.map((m) => {
            const a = alts?.[m.id];
            return (
              <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-raised" title={m.note}>
                <input type="radio" name="route-metric" checked={metric === m.id} onChange={() => onMetricChange(m.id)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span>{m.label}</span>
                    {a && (
                      <span className="num shrink-0 text-[11px] text-muted">
                        {fmtDistance(a.distance_m)} · {fmtDuration(a.estimated_time_min)}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onRecalculate}
        disabled={isCalculating || !destination}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-line px-2 py-1.5 text-muted hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
        {isCalculating ? 'Calculating…' : 'Recalculate route'}
      </button>

      <Disclosure label="Constraints: speed, slope limit, EVA time, science time">
        <MissionConstraintsPanel constraints={constraints} onChangeConstraints={onChangeConstraints} />
      </Disclosure>
    </div>
  );
};
