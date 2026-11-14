import React from 'react';

export type InspectorTab = 'route' | 'eva' | 'context' | 'catalogue';

const TABS: Array<[InspectorTab, string]> = [
  ['route', 'Route'],
  ['eva', 'EVA'],
  ['context', 'Context'],
  ['catalogue', 'Catalogue'],
];

interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  /** The content of each tab; only the active one is mounted. */
  panels: Record<InspectorTab, React.ReactNode>;
  /** Small markers on the tab labels (e.g. a warning symbol on EVA). */
  badges?: Partial<Record<InspectorTab, React.ReactNode>>;
}

/** Right-hand mission operations panel: Route, EVA, Context and Catalogue, one tab at a time. */
export const Inspector: React.FC<InspectorProps> = ({ tab, onTabChange, panels, badges }) => (
  <div className="flex h-full flex-col">
    <div role="tablist" aria-label="Mission operations" className="flex shrink-0 border-b border-line px-1">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTabChange(id)}
          className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-[12px] font-medium uppercase tracking-wider cursor-pointer ${
            tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {label}
          {badges?.[id]}
        </button>
      ))}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="tabpanel">
      {panels[tab]}
    </div>
  </div>
);
