import React from 'react';
import { Contrast, PanelLeft, PanelRight, RotateCcw } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { TerrainInfo } from '../map/MarsMap';

interface HeaderProps {
  regionName: string;
  terrain: TerrainInfo | null;
  terrainError: string | null;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  onReset: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

/** Thin application bar: branding, the operational region, display and plan actions, data validity. */
export const Header: React.FC<HeaderProps> = ({
  regionName,
  terrain,
  terrainError,
  highContrast,
  onToggleHighContrast,
  onReset,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}) => {
  const iconBtn = (active: boolean) =>
    `rounded p-1 cursor-pointer hover:bg-raised ${active ? 'text-fg' : 'text-faint hover:text-fg'}`;

  let validity: React.ReactNode;
  if (terrainError) validity = <StatusBadge tone="bad" title={terrainError}>Terrain unavailable</StatusBadge>;
  else if (!terrain) validity = <StatusBadge>Loading terrain</StatusBadge>;
  else if (terrain.synthetic) validity = <StatusBadge tone="warn" title={terrain.name}>Synthetic terrain</StatusBadge>;
  else if (terrain.status && terrain.status !== 'validated')
    validity = (
      <StatusBadge tone="warn" title={`${terrain.name}: ${terrain.status}. Planning estimates, not certified for operations.`}>
        Terrain {terrain.status}
      </StatusBadge>
    );
  else validity = <StatusBadge tone="ok" title={terrain.name}>Terrain validated</StatusBadge>;

  return (
    <header className="grid h-9 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-3 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleLeft}
          className={iconBtn(leftOpen)}
          aria-label={leftOpen ? 'Hide planning panel' : 'Show planning panel'}
          title={leftOpen ? 'Hide planning panel' : 'Show planning panel'}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        {/* Project name only: Space Apps rules do not allow NASA branding in team-made content. */}
        <div className="flex shrink-0 items-baseline gap-1.5" title="Mars Adaptive Route Guidance Architecture">
          <span className="text-[14px] font-semibold tracking-wide">MARGA</span>
        </div>
      </div>

      {/* Operational region, centred on the bar */}
      <div className="min-w-0 truncate text-center text-fg" title="Operational region">
        {regionName}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onToggleHighContrast}
          aria-pressed={highContrast}
          className={`flex items-center gap-1.5 rounded border px-2 py-0.5 cursor-pointer hover:bg-raised ${
            highContrast ? 'border-fg text-fg' : 'border-line text-muted hover:text-fg'
          }`}
          title="High-contrast display"
        >
          <Contrast className="h-3.5 w-3.5" />
          High contrast
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-muted hover:bg-raised hover:text-fg cursor-pointer"
          title="Restore the default start, destination, stops and constraints"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset plan
        </button>
        {validity}
        <button
          type="button"
          onClick={onToggleRight}
          className={iconBtn(rightOpen)}
          aria-label={rightOpen ? 'Hide operations panel' : 'Show operations panel'}
          title={rightOpen ? 'Hide operations panel' : 'Show operations panel'}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
