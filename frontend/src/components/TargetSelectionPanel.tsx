import React, { useState } from 'react';
import { ScienceTarget, ScienceCategory } from '@shared/types';
import { Info, Search } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../map/mapStyles';

interface TargetSelectionPanelProps {
  targets: ScienceTarget[];
  selectedTarget: ScienceTarget | null;
  onSelectTarget: (target: ScienceTarget) => void;
  destinationPoint: ScienceTarget | null;
  onSetAsDestination: (target: ScienceTarget) => void;
  /** Show the target's catalogue record in the inspector. */
  onInspect: (target: ScienceTarget) => void;
}

const CATEGORIES: ScienceCategory[] = ['hydration', 'mineralogical', 'sedimentary', 'geological', 'radiation'];

/** Science target catalogue: search, filter, pick a destination, inspect a record. */
export const TargetSelectionPanel: React.FC<TargetSelectionPanelProps> = ({
  targets,
  selectedTarget,
  onSelectTarget,
  destinationPoint,
  onSetAsDestination,
  onInspect,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState<ScienceCategory | 'all'>('all');

  const q = searchTerm.toLowerCase();
  const filtered = targets.filter(
    (t) =>
      (category === 'all' || t.category === category) &&
      (t.name.toLowerCase().includes(q) || t.instrument.toLowerCase().includes(q) || t.source.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Name, instrument or source"
            aria-label="Search targets"
            className="w-full rounded border border-line bg-bg py-1 pl-7 pr-2 text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ScienceCategory | 'all')}
          aria-label="Category"
          className="rounded border border-line bg-bg px-1.5 py-1 text-fg focus:border-accent focus:outline-none"
        >
          <option value="all">All ({targets.length})</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <ul className="-mx-1">
        {filtered.map((t) => {
          const isDest = destinationPoint?.id === t.id;
          const isSelected = selectedTarget?.id === t.id;
          return (
            <li key={t.id} className={`flex items-center rounded ${isSelected ? 'bg-raised' : 'hover:bg-raised'}`}>
              <button
                type="button"
                onClick={() => {
                  onSelectTarget(t);
                  onSetAsDestination(t);
                }}
                className="flex min-w-0 flex-1 items-start gap-2 px-1 py-1.5 text-left cursor-pointer"
                title="Set as destination"
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} />
                <span className="min-w-0">
                  <span className="block truncate">{t.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {CATEGORY_LABELS[t.category]} · {t.instrument}
                  </span>
                </span>
              </button>
              {isDest && <span className="mr-1 shrink-0 text-[11px] text-bad">Destination</span>}
              <button
                type="button"
                onClick={() => onInspect(t)}
                className="mr-1 shrink-0 rounded p-1 text-faint hover:bg-panel hover:text-fg cursor-pointer"
                aria-label={`Details for ${t.name}`}
                title="Details and source"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="px-1 py-1.5 text-faint">No targets match.</li>}
      </ul>
    </div>
  );
};
