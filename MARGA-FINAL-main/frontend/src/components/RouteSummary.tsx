import React from 'react';
import type { EngineRouteResponse } from '@shared/types/engine';
import { StatusIcon } from './StatusBadge';
import { routeFeasibility } from './feasibility';
import { fmtDeg, fmtDistance, fmtDuration, fmtMargin } from './format';

const TONE_TEXT = { neutral: 'text-muted', info: 'text-accent', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Compact distance and feasibility summary of the planned route (left panel). */
export const RouteSummary: React.FC<{ route: EngineRouteResponse | null; isCalculating: boolean }> = ({ route, isCalculating }) => {
  const f = routeFeasibility(route);
  const eva = route?.eva_assessment;
  const hasPath = !!route && route.coordinates.length > 1;
  const cell = (label: string, value: string) => (
    <div className="min-w-0">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="num truncate">{value}</div>
    </div>
  );
  return (
    <div className={isCalculating ? 'opacity-60' : ''}>
      <div className={`flex items-center gap-1.5 font-medium ${TONE_TEXT[f.tone]}`}>
        <StatusIcon tone={f.tone} className="h-4 w-4" />
        {f.label}
        {isCalculating && <span className="text-[11px] font-normal text-faint">updating…</span>}
      </div>
      {f.detail && <p className="mt-0.5 text-[11px] text-muted">{f.detail}</p>}
      {hasPath && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {cell('Outbound distance', fmtDistance(route.distance_m))}
          {cell('Outbound time', fmtDuration(route.estimated_time_min))}
          {cell('EVA time incl. reserve', eva ? fmtDuration(eva.mission_time_min) : '—')}
          {cell('Margin', eva ? fmtMargin(eva.return_margin_min) : '—')}
          {cell('Max terrain slope', fmtDeg(route.alternatives?.[route.alternatives.selected_metric]?.max_terrain_slope_deg))}
          {cell('Science sites', String(eva?.science_stops ?? route.segments.length))}
        </div>
      )}
    </div>
  );
};
