import React from 'react';

export type StatusTone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad';

const TONES: Record<StatusTone, string> = {
  neutral: 'border-line-strong text-muted',
  info: 'border-accent/50 text-accent',
  ok: 'border-ok/50 text-ok',
  warn: 'border-warn/50 text-warn',
  bad: 'border-bad/50 text-bad',
};

/** A small, quiet status label. Colour only carries meaning; the words always say what it is. */
export const StatusBadge: React.FC<{ tone?: StatusTone; title?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  title,
  children,
}) => (
  <span
    title={title}
    className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4 ${TONES[tone]}`}
  >
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
