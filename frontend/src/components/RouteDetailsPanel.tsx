import React from 'react';
import type { EngineRouteResponse, EngineStatusReason, RouteSummary } from '@shared/types/engine';
import { Download } from 'lucide-react';
import { EmptyNote, KeyValues, SubHeading } from './Section';
import { StatusBadge, routeStatusBadge } from './StatusBadge';
import { NOT_PROVIDED, fmtDeg, fmtDistance, fmtDuration, fmtMetres, fmtPct } from './format';
import { SLOPE_CLASS_COLORS, SLOPE_CLASS_LABELS, type SlopeClass } from '../map/mapStyles';

/** Plain-language labels for the engine's status_reason codes (the engine's own warnings follow below). */
const REASON_TEXT: Record<Exclude<EngineStatusReason, null>, string> = {
  invalid_request: 'The request was not valid.',
  outside_terrain_coverage: 'A point lies outside the terrain model.',
  start_not_traversable: 'The start lies on ground the route may not use.',
  destination_not_traversable: 'The destination lies on ground the route may not use.',
  no_traversable_path: 'No path stays within the slope limit and known terrain.',
  return_no_traversable_path: 'No return path stays within the slope limit and known terrain.',
  return_start_not_traversable: 'The return leg starts on ground the route may not use.',
  return_destination_not_traversable: 'The return leg ends on ground the route may not use.',
  eva_budget_exceeded: 'The round trip does not fit the EVA time budget.',
  engine_error: 'The engine reported an internal error.',
  terrain_unavailable: 'The terrain model could not be loaded.',
};

const ALT_LABELS: Record<'terrain' | 'distance' | 'time', string> = {
  terrain: 'Lowest terrain cost',
  distance: 'Shortest distance',
  time: 'Fastest time',
};

interface RouteDetailsPanelProps {
  route: EngineRouteResponse | null;
  isCalculating: boolean;
}

/** Route assessment: the engine's route response, shown as returned. */
export const RouteDetailsPanel: React.FC<RouteDetailsPanelProps> = ({ route, isCalculating }) => {
  if (!route) {
    return (
      <EmptyNote>
        {isCalculating ? 'Calculating route…' : 'No route yet. Choose a destination on the map or in the Targets list.'}
      </EmptyNote>
    );
  }

  const status = routeStatusBadge(route.status);
  const reason = route.status_reason ? REASON_TEXT[route.status_reason] : null;
  const alts = route.alternatives ?? null;
  const selected: RouteSummary | null | undefined = alts ? alts[alts.selected_metric] : undefined;
  const ts = route.terrain_summary;
  const classes: Array<[SlopeClass, number | undefined]> = [
    ['flat', ts?.flat_pct],
    ['moderate', ts?.moderate_pct],
    ['steep', ts?.steep_pct],
    ['hazardous', ts?.hazardous_pct],
    ['unknown', ts?.unknown_pct],
  ];
  const hasPath = route.coordinates.length > 1;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(route, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.route_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={isCalculating ? 'opacity-60' : ''}>
      <div className="flex items-center gap-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {isCalculating && <span className="text-[11px] text-faint">updating…</span>}
      </div>
      {reason && <p className="mt-1.5">{reason}</p>}

      {hasPath && (
        <>
          <SubHeading>Route</SubHeading>
          <KeyValues
            rows={[
              ['Map distance', fmtDistance(route.distance_m)],
              ['Surface distance', fmtDistance(route.distance_3d_m)],
              ['Outbound walking time', fmtDuration(route.estimated_time_min)],
              ['Elevation gain', fmtMetres(route.elevation_gain_m)],
              ['Elevation loss', fmtMetres(route.elevation_loss_m)],
              ['Max terrain slope', fmtDeg(selected?.max_terrain_slope_deg)],
            ]}
          />

          <SubHeading>Terrain along the route</SubHeading>
          <div className="flex h-2 overflow-hidden rounded-sm bg-raised" aria-hidden="true">
            {classes.map(([k, v]) =>
              v ? <div key={k} style={{ width: `${v}%`, background: SLOPE_CLASS_COLORS[k] }} /> : null,
            )}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {classes.map(([k, v]) =>
              typeof v === 'number' ? (
                <div key={k} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SLOPE_CLASS_COLORS[k] }} />
                  <span className="flex-1 text-muted">{SLOPE_CLASS_LABELS[k]}</span>
                  <span className="num">{fmtPct(v)}</span>
                </div>
              ) : null,
            )}
          </div>
          <p className="mt-1 text-[11px] text-faint">Share of route length by terrain slope class.</p>

          <SubHeading>Segments ({route.segments.length})</SubHeading>
          <div className="space-y-3">
            {route.segments.map((s, i) => (
              <div key={i}>
                <div className="mb-1 truncate font-medium" title={`${s.from_name} to ${s.to_name}`}>
                  {s.from_name} → {s.to_name}
                </div>
                <KeyValues
                  rows={[
                    ['Distance', fmtDistance(s.distance_m)],
                    ['Walking time', fmtDuration(s.estimated_time_min)],
                    ['Gain / loss', s.elevation_gain_m == null ? NOT_PROVIDED : `${fmtMetres(s.elevation_gain_m)} / ${fmtMetres(s.elevation_loss_m)}`],
                    ['Mean along-track slope', fmtDeg(s.average_slope_deg)],
                    ['Max terrain slope', fmtDeg(s.max_terrain_slope_deg)],
                    ['Ground without data', fmtMetres(s.unknown_length_m)],
                  ]}
                />
                {(s.start_snapped_m ?? 0) > 0 || (s.end_snapped_m ?? 0) > 0 ? (
                  <p className="mt-1 text-[11px] text-warn">
                    Endpoint moved to traversable ground: start {fmtMetres(s.start_snapped_m)}, end {fmtMetres(s.end_snapped_m)}.
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-faint">{s.terrain_type}</p>
              </div>
            ))}
          </div>

          {route.return_route && (
            <>
              <SubHeading>Return route</SubHeading>
              <p className="mb-1 text-[11px] text-faint">
                {route.return_route.from_name} → {route.return_route.to_name}, searched separately from the turnaround point.
              </p>
              <KeyValues
                rows={[
                  ['Distance', fmtDistance(route.return_route.distance_m)],
                  ['Walking time', fmtDuration(route.return_route.estimated_time_min)],
                  ['Max terrain slope', fmtDeg(route.return_route.max_terrain_slope_deg)],
                ]}
              />
            </>
          )}

          {alts && (
            <>
              <SubHeading>Alternatives</SubHeading>
              <ul className="divide-y divide-line">
                {(['terrain', 'distance', 'time'] as const).map((k) => {
                  const a = alts[k];
                  if (!a) return null;
                  return (
                    <li key={k} className="py-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span>{ALT_LABELS[k]}</span>
                        {alts.selected_metric === k && <span className="text-[11px] text-accent">Planned</span>}
                      </div>
                      <div className="num text-[11px] text-muted">
                        {fmtDistance(a.distance_m)} · {fmtDuration(a.estimated_time_min)} · max slope{' '}
                        {fmtDeg(a.max_terrain_slope_deg)} · gain {fmtMetres(a.elevation_gain_m)}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {alts.direct_line.map((d, i) => (
                <p key={i} className="mt-2 text-[11px] text-muted">
                  Straight line {d.from_name} → {d.to_name}: {fmtDistance(d.distance_m)}, of which{' '}
                  {fmtMetres(d.prohibited_length_m)} over the slope limit and {fmtMetres(d.unknown_length_m)} without data.{' '}
                  <span className="text-faint">{d.note}</span>
                </p>
              ))}
              {alts.notes.map((n, i) => (
                <p key={i} className="mt-1 text-[11px] text-faint">
                  {n}
                </p>
              ))}
            </>
          )}
        </>
      )}

      <SubHeading>Warnings</SubHeading>
      {route.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-warn">
          {route.warnings.map((w, i) => (
            <li key={i}>
              <span className="text-fg">{w}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>No warnings from the engine.</EmptyNote>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-faint" title={route.route_id}>
          {route.route_id}
        </span>
        <button
          type="button"
          onClick={downloadJson}
          className="flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          Export JSON
        </button>
      </div>
    </div>
  );
};
