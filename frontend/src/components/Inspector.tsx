import React from 'react';
import type { ScienceTarget } from '@shared/types';
import type { EngineRouteResponse } from '@shared/types/engine';
import { RouteDetailsPanel } from './RouteDetailsPanel';
import { EVAAssessment } from './EVAAssessment';
import { ContextPanel } from './ContextPanel';
import { TargetInspector } from './TargetInspector';
import type { TerrainInfo } from '../map/MarsMap';
import type { GisLayerManifest } from '../map/demLayer';

export type InspectorTab = 'route' | 'eva' | 'context' | 'target';

const TABS: Array<[InspectorTab, string]> = [
  ['route', 'Route'],
  ['eva', 'EVA'],
  ['context', 'Context'],
  ['target', 'Target'],
];

interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  route: EngineRouteResponse | null;
  isCalculating: boolean;
  terrain: TerrainInfo | null;
  gis: GisLayerManifest | null;
  engineMode: string;
  target: ScienceTarget | null;
  targetIsDestination: boolean;
  targetIsStart: boolean;
  onSetDestination: (t: ScienceTarget) => void;
  onSetStart: (t: ScienceTarget) => void;
}

/** Right-hand inspector: details for the planned route and the selected target, one tab at a time. */
export const Inspector: React.FC<InspectorProps> = (p) => (
  <div className="flex h-full flex-col">
    <div role="tablist" className="flex shrink-0 border-b border-line px-1">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={p.tab === id}
          onClick={() => p.onTabChange(id)}
          className={`-mb-px border-b-2 px-3 py-2 text-[12px] cursor-pointer ${
            p.tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="tabpanel">
      {p.tab === 'route' && <RouteDetailsPanel route={p.route} isCalculating={p.isCalculating} />}
      {p.tab === 'eva' && <EVAAssessment route={p.route} />}
      {p.tab === 'context' && <ContextPanel route={p.route} terrain={p.terrain} gis={p.gis} engineMode={p.engineMode} />}
      {p.tab === 'target' && (
        <TargetInspector
          target={p.target}
          isDestination={p.targetIsDestination}
          isStart={p.targetIsStart}
          onSetDestination={p.onSetDestination}
          onSetStart={p.onSetStart}
        />
      )}
    </div>
  </div>
);
