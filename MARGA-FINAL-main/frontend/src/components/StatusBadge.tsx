import React from 'react';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';

export type StatusTone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad';

const TONES: Record<StatusTone, string> = {
  neutral: 'border-line-strong text-muted',
  info: 'border-accent/50 text-accent',
  ok: 'border-ok/50 text-ok',
  warn: 'border-warn/50 text-warn',
  bad: 'border-bad/50 text-bad',
};

/** Symbols for the states that carry meaning, so status never depends on colour alone. */
const ICONS: Partial<Record<StatusTone, React.FC<{ className?: string }>>> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
};

export const StatusIcon: React.FC<{ tone: StatusTone; className?: string }> = ({ tone, className = 'h-3 w-3' }) => {
  const Icon = ICONS[tone];
  return Icon ? <Icon className={`shrink-0 ${className}`} aria-hidden="true" /> : null;
};

/** A small, quiet status label: words always say what it is, a symbol marks ok / warning / problem. */
export const StatusBadge: React.FC<{ tone?: StatusTone; title?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  title,
  children,
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4 ${TONES[tone]}`}
  >
    <StatusIcon tone={tone} />
    {children}
  </span>
);

/** Route status from the engine, worded plainly. "Calculated" never means "safe". */
export function routeStatusBadge(status: string | undefined): { tone: StatusTone; label: string } {
  switch (status) {
    case 'calculated':
      return { tone: 'info', label: 'Calculated' };
    case 'warning':
      return { tone: 'warn', label: 'Warning' };
    case 'unreachable':
      return { tone: 'bad', label: 'Unreachable' };
    case 'failed':
      return { tone: 'bad', label: 'Failed' };
    default:
      return { tone: 'neutral', label: 'No route' };
  }
}
