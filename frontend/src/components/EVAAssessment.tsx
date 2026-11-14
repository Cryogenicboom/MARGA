import React from 'react';
import type { EngineRouteResponse, EvaAssessment as EvaAssessmentData } from '@shared/types/engine';
import { Disclosure, EmptyNote, KeyValues } from './Section';
import { StatusIcon, type StatusTone } from './StatusBadge';
import { fmtDuration, fmtMargin, fmtPct } from './format';

const STATUS: Record<EvaAssessmentData['status'], { tone: StatusTone; label: string; text: string }> = {
  within_budget: {
    tone: 'ok',
    label: 'Within EVA budget',
    text: 'The estimated round trip and reserve fit in the configured EVA duration.',
  },
  no_slack: {
    tone: 'warn',
    label: 'No time margin',
    text: 'The estimated round trip uses the whole usable time; any delay cuts into the reserve.',
  },
  exceeded: {
    tone: 'bad',
    label: 'Exceeds EVA budget',
    text: 'The estimated round trip and reserve take longer than the configured EVA duration.',
  },
};

const TONE_TEXT = { neutral: 'text-muted', info: 'text-accent', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Timeline block kinds. Patterns as well as colours, so the blocks are told apart without colour. */
const KIND = {
  travel: { label: 'Outbound travel', color: '#5aa2f0', pattern: null },
  science: { label: 'Science stop', color: '#8f7fd6', pattern: 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(0,0,0,0.28) 4px 6px)' },
  return: { label: 'Return', color: '#a9cdf7', pattern: null },
  reserve: { label: 'Reserve', color: '#6c7581', pattern: 'repeating-linear-gradient(90deg, transparent 0 5px, rgba(0,0,0,0.3) 5px 6px)' },
  remaining: { label: 'Remaining', color: 'transparent', pattern: null },
} as const;
type Kind = keyof typeof KIND;

interface Block {
  kind: Kind;
  minutes: number;
  title: string;
}

/**
 * The EVA in order, from the engine's own minutes: each outbound leg (route segments), science time
 * at each stop and the destination, the return leg, the reserve. Nothing is re-estimated here.
 */
function timeline(route: EngineRouteResponse, eva: EvaAssessmentData): Block[] {
  const legs = route.segments;
  const perStop = eva.science_min_per_stop;
  const blocks: Block[] = [];
  const legsTotal = legs.reduce((a, s) => a + (s.estimated_time_min ?? 0), 0);
  if (legs.length > 0 && perStop != null && legs.length === eva.science_stops && legsTotal > 0) {
    legs.forEach((s, i) => {
      blocks.push({ kind: 'travel', minutes: s.estimated_time_min, title: `Leg ${i + 1}: ${s.from_name} → ${s.to_name}` });
      if (perStop > 0) blocks.push({ kind: 'science', minutes: perStop, title: `Science at ${s.to_name}` });
    });
  } else {
    blocks.push({ kind: 'travel', minutes: eva.outbound_min, title: 'Outbound travel' });
    if (eva.science_min > 0) blocks.push({ kind: 'science', minutes: eva.science_min, title: 'Science work' });
  }
  blocks.push({ kind: 'return', minutes: eva.return_min, title: `Return${eva.return_route_recalculated ? ' (own route)' : ''}` });
  blocks.push({ kind: 'reserve', minutes: eva.reserve_min, title: 'Safety reserve' });
  return blocks.filter((b) => b.minutes > 0);
}

const EvaTimeline: React.FC<{ route: EngineRouteResponse; eva: EvaAssessmentData }> = ({ route, eva }) => {
  const blocks = timeline(route, eva);
  const used = blocks.reduce((a, b) => a + b.minutes, 0);
  const span = Math.max(eva.eva_duration_min, used, 1);
  const pct = (m: number) => `${(m / span) * 100}%`;
  // Remaining time or deficit is the engine's own return margin (EVA duration minus mission time).
  const deficit = Math.max(0, -eva.return_margin_min);
  const remaining = Math.max(0, eva.return_margin_min);
  const hourStep = span > 12 * 60 ? 120 : 60;
  const ticks = Array.from({ length: Math.floor(span / hourStep) + 1 }, (_, i) => i * hourStep);
  const turnaround = eva.latest_turnaround_elapsed_min;

  return (
    <div className="select-none" aria-label="EVA timeline">
      <div className="relative h-7">
        <div className="absolute inset-0 flex overflow-hidden rounded-sm border border-line bg-raised">
          {blocks.map((b, i) => (
            <div
              key={i}
              className="h-full border-r border-[#0b0d10]/60 last:border-r-0"
              style={{ width: pct(b.minutes), background: KIND[b.kind].pattern ? `${KIND[b.kind].pattern}, ${KIND[b.kind].color}` : KIND[b.kind].color }}
              title={`${b.title}: ${fmtDuration(b.minutes)}`}
            />
          ))}
          {remaining > 0 && (
            <div
              className="h-full border-l border-dashed border-ok/80"
              style={{ width: pct(remaining), background: 'repeating-linear-gradient(135deg, transparent 0 5px, rgba(95,181,138,0.25) 5px 7px)' }}
              title={`Remaining: ${fmtDuration(remaining)}`}
            />
          )}
        </div>
        {/* Time beyond the EVA end: the deficit */}
        {deficit > 0 && (
          <div
            className="absolute inset-y-0 rounded-r-sm border-2 border-bad"
            style={{ left: pct(eva.eva_duration_min), width: pct(deficit) }}
            title={`Deficit: ${fmtDuration(deficit)} beyond the EVA duration`}
          />
        )}
        {/* EVA end and latest turnaround markers */}
        <div className="absolute -bottom-1 -top-1 w-0.5 bg-fg" style={{ left: `calc(${pct(eva.eva_duration_min)} - 1px)` }} title="End of the EVA" />
        {turnaround > 0 && (
          <div
            className="absolute -bottom-1 -top-1 w-0 border-l-2 border-dotted border-warn"
            style={{ left: pct(turnaround) }}
            title={`Latest turnaround: ${fmtDuration(turnaround)} after leaving`}
          />
        )}
      </div>
      <div className="relative mt-1 h-3.5 text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {t / 60}h
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 bg-fg" /> EVA end {fmtDuration(eva.eva_duration_min)}
        </span>
        {turnaround > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-0 border-l-2 border-dotted border-warn" /> Latest turnaround {fmtDuration(turnaround)}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-0.5">
        {blocks.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: KIND[b.kind].pattern ? `${KIND[b.kind].pattern}, ${KIND[b.kind].color}` : KIND[b.kind].color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted" title={b.title}>
              {b.title}
            </span>
            <span className="num shrink-0">{fmtDuration(b.minutes)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-line pt-1">
          <span className="h-2.5 w-2.5 shrink-0" />
          <span className="flex-1">Total allocated (EVA duration)</span>
          <span className="num">{fmtDuration(eva.eva_duration_min)}</span>
        </li>
        <li className={`flex items-center gap-2 font-medium ${deficit > 0 ? 'text-bad' : 'text-ok'}`}>
          <StatusIcon tone={deficit > 0 ? 'bad' : 'ok'} className="h-2.5 w-2.5" />
          <span className="flex-1">{deficit > 0 ? 'Time deficit' : 'Remaining time'}</span>
          <span className="num">{fmtDuration(deficit > 0 ? deficit : remaining)}</span>
        </li>
      </ul>
    </div>
  );
};

/** EVA tab: the engine's time budget for this route as a mission timeline, with all figures on demand. */
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
  const scienceText =
    eva.science_min_per_stop == null
      ? `${fmtDuration(eva.science_min)} (not configured)`
      : `${fmtDuration(eva.science_min)} (${eva.science_stops} × ${fmtDuration(eva.science_min_per_stop)})`;

  return (
    <div>
      <div className={`flex items-center gap-2 text-[14px] font-semibold ${TONE_TEXT[s.tone]}`}>
        <StatusIcon tone={s.tone} className="h-4 w-4" />
        {s.label}
        <span className="num ml-auto text-[12px] font-normal text-muted">
          {eva.return_margin_min >= 0 ? `${fmtDuration(eva.return_margin_min)} to spare` : `${fmtDuration(-eva.return_margin_min)} short`}
        </span>
      </div>
      <p className="mt-1">{s.text}</p>
      <p className="mb-3 mt-1 text-[11px] text-faint">
        Planning estimate from the engine's walking-speed model ({fmtPct(eva.budget_used_percent)} of usable time). Not a safety certification.
      </p>

      <EvaTimeline route={route} eva={eva} />

      <div className="mt-4 space-y-2 border-t border-line pt-2">
        <Disclosure label="All figures">
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
        </Disclosure>
        <Disclosure label="Walking-speed model and engine notes">
          <p className="text-[11px] text-muted">{eva.walking_speed_model}</p>
          {eva.notes.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-muted">
              {eva.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>
    </div>
  );
};
