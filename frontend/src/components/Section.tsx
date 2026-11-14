import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NOT_PROVIDED } from './format';

/** A collapsible pane section: a quiet uppercase title, its content below. */
export const Section: React.FC<{
  title: string;
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, aside, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg cursor-pointer"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </button>
        {aside}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
};

/** Label / value rows. A missing value reads "Not provided", never a blank or a guess. */
export const KeyValues: React.FC<{ rows: Array<[string, React.ReactNode]> }> = ({ rows }) => (
  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
    {rows.map(([k, v]) => (
      <React.Fragment key={k}>
        <dt className="text-muted">{k}</dt>
        <dd className={`num text-right ${v === NOT_PROVIDED ? 'text-faint' : ''}`}>{v}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/** A small heading inside a pane or tab. */
export const SubHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">{children}</h3>
);

/** A collapsed-by-default group for detail that should stay reachable but out of the primary view. */
export const Disclosure: React.FC<{
  label: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, defaultOpen = false, className = '', children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-[11px] text-faint hover:text-fg cursor-pointer"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
};

/** Explicit "not available" state. */
export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-faint">{children}</p>
);
