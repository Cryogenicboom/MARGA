import React from 'react';
import { PanelLeft, PanelRight, RotateCcw } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { TerrainInfo } from '../map/MarsMap';

interface HeaderProps {
  regionName: string;
  objectiveTitle: string | null;
  terrain: TerrainInfo | null;
  terrainError: string | null;
  onReset: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

/** Application bar: what is being planned, the state of the terrain data, and global actions. */
export const Header: React.FC<HeaderProps> = ({
  regionName,
  objectiveTitle,
  terrain,
  terrainError,
  onReset,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}) => {
  const iconBtn = (active: boolean) =>
    `rounded p-1.5 cursor-pointer hover:bg-raised ${active ? 'text-fg' : 'text-faint hover:text-fg'}`;

  let terrainBadge: React.ReactNode;
  if (terrainError) terrainBadge = <StatusBadge tone="bad">Terrain unavailable</StatusBadge>;
  else if (!terrain) terrainBadge = <StatusBadge>Loading terrain</StatusBadge>;
  else if (terrain.synthetic) terrainBadge = <StatusBadge tone="warn" title={terrain.name}>Synthetic terrain</StatusBadge>;
  else if (terrain.status && terrain.status !== 'validated')
    terrainBadge = (
      <StatusBadge tone="warn" title={`${terrain.name}: ${terrain.status}`}>
        Terrain {terrain.status}
      </StatusBadge>
    );
  else terrainBadge = <StatusBadge title={terrain.name}>Terrain validated</StatusBadge>;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-2">
      <button
        type="button"
        onClick={onToggleLeft}
        className={iconBtn(leftOpen)}
        aria-label={leftOpen ? 'Hide mission pane' : 'Show mission pane'}
        title={leftOpen ? 'Hide mission pane' : 'Show mission pane'}
      >
        <PanelLeft className="h-4 w-4" />
      </button>
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold tracking-wide">MARGA</span>
        <span className="hidden text-[11px] text-faint xl:inline">Mars Adaptive Route Guidance</span>
      </div>
      <div className="h-4 w-px bg-line" />
      <div className="min-w-0 truncate">
        <span className="text-fg">{regionName}</span>
        <span className="text-faint"> · </span>
        <span className={objectiveTitle ? 'text-muted' : 'text-faint'}>{objectiveTitle ?? 'No science objective selected'}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {terrainBadge}
        <span className="hidden text-[11px] text-faint lg:inline">Planning estimates, not certified for operations</span>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer"
          title="Restore the default start, destination and constraints"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset plan
        </button>
        <button
          type="button"
          onClick={onToggleRight}
          className={iconBtn(rightOpen)}
          aria-label={rightOpen ? 'Hide inspector' : 'Show inspector'}
          title={rightOpen ? 'Hide inspector' : 'Show inspector'}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
