import React from 'react';
import type { EngineRouteResponse, EvaAssessment as EvaAssessmentData } from '@shared/types/engine';
import { EmptyNote, KeyValues, SubHeading } from './Section';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { fmtDuration, fmtMargin, fmtPct } from './format';

const STATUS: Record<EvaAssessmentData['status'], { tone: StatusTone; label: string; text: string }> = {
  within_budget: {
    tone: 'ok',
    label: 'Within budget',
    text: 'The estimated round trip and reserve fit in the configured EVA duration.',
  },
  no_slack: {
    tone: 'warn',
    label: 'No slack',
    text: 'The estimated round trip uses the whole usable time; any delay cuts into the reserve.',
  },
  exceeded: {
    tone: 'bad',
    label: 'Budget exceeded',
    text: 'The estimated round trip and reserve take longer than the configured EVA duration.',
  },
};

const PART_COLORS = {
  outbound: '#5aa2f0',
  science: '#8f7fd6',
  return: '#a9cdf7',
  reserve: '#6c7581',
};

/** EVA assessment: the engine's time budget for this route, shown as returned. */
export const EVAAssessment: React.FC<{ route: EngineRouteResponse | null }> = ({ route }) => {
  const eva = route?.eva_assessment;
  if (!route) return <EmptyNote>No route yet.</EmptyNote>;
  if (!eva) {
    return (
      <EmptyNote>
        The engine did not return an EVA assessment for this route (status: {route.status}). See the Route tab for the reason.
      </EmptyNote>
    );
  }

  const s = STATUS[eva.status];
  // Bar widths are the engine's own minutes, drawn against the longer of the EVA and the mission time.
  const span = Math.max(eva.eva_duration_min, eva.mission_time_min, 1);
  const parts: Array<[keyof typeof PART_COLORS, string, number]> = [
    ['outbound', 'Outbound', eva.outbound_min],
    ['science', 'Science', eva.science_min],
    ['return', 'Return', eva.return_min],
    ['reserve', 'Reserve', eva.reserve_min],
  ];
  const evaEndPct = (eva.eva_duration_min / span) * 100;
  const scienceText =
    eva.science_min_per_stop == null
      ? `${fmtDuration(eva.science_min)} (not configured)`
      : `${fmtDuration(eva.science_min)} (${eva.science_stops} × ${fmtDuration(eva.science_min_per_stop)})`;

  return (
    <div>
      <div className="flex items-center gap-2">
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        <span className="num text-muted">{fmtPct(eva.budget_used_percent)} of usable time</span>
      </div>
      <p className="mt-1.5">{s.text}</p>
      <p className="mt-1 text-[11px] text-faint">
        Planning estimate from the engine's walking-speed model. It is not a safety certification.
      </p>

      <SubHeading>Time budget</SubHeading>
      <div className="relative">
        <div className="flex h-3 overflow-hidden rounded-sm bg-raised">
          {parts.map(([k, , v]) =>
            v > 0 ? <div key={k} style={{ width: `${(v / span) * 100}%`, background: PART_COLORS[k] }} /> : null,
          )}
        </div>
        <div
          className="absolute -bottom-1 -top-1 w-px bg-fg"
          style={{ left: `calc(${evaEndPct}% - 0.5px)` }}
          title="End of the configured EVA duration"
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>0</span>
        <span>EVA {fmtDuration(eva.eva_duration_min)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {parts.map(([k, label, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: PART_COLORS[k] }} />
            <span className="flex-1 text-muted">{label}</span>
            <span className="num">{fmtDuration(v)}</span>
          </div>
        ))}
      </div>

      <SubHeading>Figures</SubHeading>
      <KeyValues
        rows={[
          ['EVA duration', fmtDuration(eva.eva_duration_min)],
          ['Safety reserve', fmtDuration(eva.reserve_min)],
          ['Usable time', fmtDuration(eva.usable_min)],
          ['Outbound', fmtDuration(eva.outbound_min)],
          ['Science work', scienceText],
          ['Return', `${fmtDuration(eva.return_min)}${eva.return_route_recalculated ? ' (own route)' : ''}`],
          ['Mission time incl. reserve', fmtDuration(eva.mission_time_min)],
          ['Return margin', fmtMargin(eva.return_margin_min)],
          ['Max science time that fits', eva.max_science_time_min >= 0 ? fmtDuration(eva.max_science_time_min) : 'None'],
          ['Latest turnaround (elapsed)', eva.latest_turnaround_elapsed_min >= 0 ? fmtDuration(eva.latest_turnaround_elapsed_min) : 'None'],
        ]}
      />

      <SubHeading>Walking-speed model</SubHeading>
      <p className="text-[11px] text-muted">{eva.walking_speed_model}</p>

      {eva.notes.length > 0 && (
        <>
          <SubHeading>Notes from the engine</SubHeading>
          <ul className="list-disc space-y-1 pl-4 text-muted">
            {eva.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
