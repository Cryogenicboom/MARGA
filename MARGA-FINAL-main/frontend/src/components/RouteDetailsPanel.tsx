import React from 'react';
import type { LocationPoint } from '@shared/types';
import type { EngineElevationPoint, EngineRouteResponse, RouteSummary } from '@shared/types/engine';
import { Download } from 'lucide-react';
import { Disclosure, EmptyNote, KeyValues, SubHeading } from './Section';
import { StatusBadge, StatusIcon, routeStatusBadge } from './StatusBadge';
import { routeFeasibility } from './feasibility';
import { NOT_PROVIDED, fmtDeg, fmtDistance, fmtDuration, fmtLatLon, fmtMetres, fmtPct } from './format';
import { ROUTE_COLORS, SLOPE_CLASS_COLORS, SLOPE_CLASS_LABELS, type SlopeClass } from '../map/mapStyles';

const ALT_LABELS: Record<'terrain' | 'distance' | 'time', string> = {
  terrain: 'Lowest terrain cost',
  distance: 'Shortest distance',
  time: 'Fastest time',
};

const TONE_TEXT = { neutral: 'text-muted', info: 'text-accent', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

interface RouteDetailsPanelProps {
  route: EngineRouteResponse | null;
  isCalculating: boolean;
  start: LocationPoint;
  destination: LocationPoint | null;
  stops: LocationPoint[];
}

/** Elevation the engine sampled at each place: start, the end of each leg (stops), destination. */
function placeElevations(pts: EngineElevationPoint[]): { start: number | null; legEnds: number[] } {
  if (!pts.length) return { start: null, legEnds: [] };
  const legEnds: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    if (!next || (next.leg !== undefined && next.leg !== pts[i].leg)) legEnds.push(pts[i].elevation_m);
  }
  return { start: pts[0].elevation_m, legEnds };
}

const Place: React.FC<{ color: string; role: string; point: LocationPoint | null; elevation: number | null | undefined }> = ({
  color,
  role,
  point,
  elevation,
}) => (
  <div className="flex items-start gap-2 py-1">
    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white/80" style={{ background: color }} />
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium" title={point?.name}>
          {point?.name || 'Not set'}
        </span>
        <span className="shrink-0 text-[11px] text-faint">{role}</span>
      </div>
      {point && (
        <div className="num flex justify-between gap-2 text-[11px] text-muted">
          <span>{fmtLatLon(point.latitude, point.longitude)}</span>
          <span title="Elevation where the route starts or ends this leg (DEM)">{elevation == null ? '' : fmtMetres(elevation)}</span>
        </div>
      )}
    </div>
  </div>
);

/** ROUTE tab: where the route goes, how long and how hard it is, and whether it fits; technical detail on demand. */
export const RouteDetailsPanel: React.FC<RouteDetailsPanelProps> = ({ route, isCalculating, start, destination, stops }) => {
  if (!route) {
    return (
      <EmptyNote>
        {isCalculating ? 'Calculating route…' : 'No route yet. Choose a destination on the map or in the Catalogue.'}
      </EmptyNote>
    );
  }

  const f = routeFeasibility(route);
  const status = routeStatusBadge(route.status);
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
  const elev = placeElevations((route.elevation_profile ?? []) as EngineElevationPoint[]);
  const eva = route.eva_assessment;

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
      {/* Feasibility first, with the engine's warnings, so nothing critical sits below the fold. */}
      <div className={`flex items-center gap-2 text-[14px] font-semibold ${TONE_TEXT[f.tone]}`}>
        <StatusIcon tone={f.tone} className="h-4 w-4" />
        {f.label}
        <span className="ml-auto">
          <StatusBadge tone={status.tone} title="Route status from the engine">
            {status.label}
          </StatusBadge>
        </span>
      </div>
      {f.detail && <p className="mt-1 text-muted">{f.detail}</p>}
      {isCalculating && <p className="mt-1 text-[11px] text-faint">Updating…</p>}
      {route.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded border border-warn/50 px-2 py-1.5">
          {route.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <StatusIcon tone="warn" className="mt-0.5 h-3 w-3 text-warn" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <SubHeading>Route</SubHeading>
      <Place color={ROUTE_COLORS.start} role="Starting hub" point={start} elevation={elev.start} />
      {stops.map((s, i) => (
        <Place key={i} color={ROUTE_COLORS.stop} role={`Stop ${i + 1}`} point={s} elevation={elev.legEnds[i]} />
      ))}
      <Place color={ROUTE_COLORS.destination} role="Destination" point={destination} elevation={hasPath ? elev.legEnds[elev.legEnds.length - 1] : null} />

      {hasPath && (
        <>
          <div className="mt-2">
            <KeyValues
              rows={[
                ['Route distance (map)', fmtDistance(route.distance_m)],
                ['Surface distance', fmtDistance(route.distance_3d_m)],
                ['Outbound travel', fmtDuration(route.estimated_time_min)],
                ['Return travel', eva ? fmtDuration(eva.return_min) : NOT_PROVIDED],
                ['Elevation gain / loss', `${fmtMetres(route.elevation_gain_m)} / ${fmtMetres(route.elevation_loss_m)}`],
              ]}
            />
          </div>

          <SubHeading>Terrain difficulty</SubHeading>
          <div className="flex h-2.5 overflow-hidden rounded-sm bg-raised" aria-hidden="true">
            {classes.map(([k, v]) => (v ? <div key={k} style={{ width: `${v}%`, background: SLOPE_CLASS_COLORS[k] }} /> : null))}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {classes.map(([k, v]) =>
              typeof v === 'number' && v > 0 ? (
                <div key={k} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SLOPE_CLASS_COLORS[k] }} />
                  <span className="flex-1 text-muted">{SLOPE_CLASS_LABELS[k]}</span>
                  <span className="num">{fmtPct(v)}</span>
                </div>
              ) : null,
            )}
          </div>
          <div className="mt-1.5">
            <KeyValues rows={[['Steepest ground crossed', fmtDeg(selected?.max_terrain_slope_deg)]]} />
          </div>
          <p className="mt-1 text-[11px] text-faint">Share of route length by terrain slope class.</p>
        </>
      )}

      <div className="mt-4 space-y-2 border-t border-line pt-2">
        <Disclosure label="Technical details: per-leg data, return route, alternatives, export">
          <div className="space-y-3">
            {route.segments.map((s, i) => (
              <div key={i}>
                <div className="mb-1 truncate font-medium" title={`${s.from_name} to ${s.to_name}`}>
                  Leg {i + 1}: {s.from_name} → {s.to_name}
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

            {route.return_route && (
              <div>
                <div className="mb-1 font-medium">Return: {route.return_route.from_name} → {route.return_route.to_name}</div>
                <KeyValues
                  rows={[
                    ['Distance', fmtDistance(route.return_route.distance_m)],
                    ['Walking time', fmtDuration(route.return_route.estimated_time_min)],
                    ['Max terrain slope', fmtDeg(route.return_route.max_terrain_slope_deg)],
                  ]}
                />
                <p className="mt-1 text-[11px] text-faint">Searched separately from the turnaround point.</p>
              </div>
            )}

            {alts && (
              <div>
                <div className="mb-1 font-medium">Alternatives</div>
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
                          {fmtDistance(a.distance_m)} · {fmtDuration(a.estimated_time_min)} · max slope {fmtDeg(a.max_terrain_slope_deg)} · gain{' '}
                          {fmtMetres(a.elevation_gain_m)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {alts.direct_line.map((d, i) => (
                  <p key={i} className="mt-2 text-[11px] text-muted">
                    Straight line {d.from_name} → {d.to_name}: {fmtDistance(d.distance_m)}, of which {fmtMetres(d.prohibited_length_m)} over
                    the slope limit and {fmtMetres(d.unknown_length_m)} without data. <span className="text-faint">{d.note}</span>
                  </p>
                ))}
                {alts.notes.map((n, i) => (
                  <p key={i} className="mt-1 text-[11px] text-faint">
                    {n}
                  </p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
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
        </Disclosure>
      </div>
    </div>
  );
};
