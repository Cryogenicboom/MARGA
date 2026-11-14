import React, { useState } from 'react';
import type { ScienceTarget, ScientificObjective } from '@shared/types';
import { Flag, Lock, Plus } from 'lucide-react';
import { CATEGORY_COLORS } from '../map/mapStyles';

interface MissionSelectionPanelProps {
  objectives: ScientificObjective[];
  targets: ScienceTarget[];
  activeObjectiveId: string | null;
  /** A route is planned: changing the active objective then needs confirming. */
  planInProgress: boolean;
  onActivate: (obj: ScientificObjective | null) => void;
  destinationTargetId: string | null;
  stopTargetIds: string[];
  startTargetId: string | null;
  onSetDestination: (t: ScienceTarget) => void;
  onAddStop: (t: ScienceTarget) => void;
  /** Open the target's catalogue record. */
  onInspect: (t: ScienceTarget) => void;
}

/**
 * Science objectives from the pre-mission plan. They are read-only here: the crew chooses which
 * one is active, never edits them, and switching the active objective during a planned excursion
 * asks for confirmation because it also replaces the destination.
 */
export const MissionSelectionPanel: React.FC<MissionSelectionPanelProps> = ({
  objectives,
  targets,
  activeObjectiveId,
  planInProgress,
  onActivate,
  destinationTargetId,
  stopTargetIds,
  startTargetId,
  onSetDestination,
  onAddStop,
  onInspect,
}) => {
  // The objective (or null = none) waiting for confirmation.
  const [pending, setPending] = useState<ScientificObjective | null | undefined>(undefined);
  const request = (obj: ScientificObjective | null) => {
    if (planInProgress && activeObjectiveId !== null) setPending(obj);
    else onActivate(obj);
  };
  const active = objectives.find((o) => o.id === activeObjectiveId) ?? null;
  const smallBtn =
    'flex items-center gap-1 rounded border border-line px-1.5 py-px text-[11px] text-muted hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Pre-mission plan · read-only
      </p>

      <div className="space-y-0.5" role="radiogroup" aria-label="Active science objective">
        {objectives.map((obj) => {
          const isActive = activeObjectiveId === obj.id;
          return (
            <button
              key={obj.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => request(isActive ? null : obj)}
              className={`w-full rounded px-2 py-1 text-left cursor-pointer ${
                isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg'
              }`}
              title={isActive ? 'Active objective (click to clear)' : 'Make this the active objective'}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border ${isActive ? 'border-accent bg-accent' : 'border-line-strong'}`}
                />
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[obj.category] }} />
                <span className="truncate">{obj.title}</span>
                {isActive && <span className="ml-auto shrink-0 text-[11px] text-accent">Active</span>}
              </span>
            </button>
          );
        })}
      </div>

      {pending !== undefined && (
        <div className="mt-2 rounded border border-warn/60 px-2 py-1.5" role="alertdialog" aria-label="Confirm objective change">
          <p className="text-[12px]">
            {pending
              ? `Make “${pending.title}” the active objective? Its first target becomes the destination.`
              : 'Clear the active objective? The route stays as planned.'}
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              className="rounded border border-warn/60 px-2 py-0.5 text-warn hover:bg-raised cursor-pointer"
              onClick={() => {
                onActivate(pending);
                setPending(undefined);
              }}
            >
              {pending ? 'Switch objective' : 'Clear objective'}
            </button>
            <button
              type="button"
              className="rounded border border-line px-2 py-0.5 text-muted hover:bg-raised hover:text-fg cursor-pointer"
              onClick={() => setPending(undefined)}
            >
              Keep current
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="mt-2 border-l-2 border-accent/60 pl-2">
          <p className="text-[12px] text-muted">{active.description}</p>
          <div className="mt-1.5 text-[11px] text-faint">Objective targets</div>
          <ul className="mt-0.5 space-y-1">
            {active.primary_target_ids.map((id) => {
              const t = targets.find((x) => x.id === id);
              if (!t) return null;
              const isDest = destinationTargetId === id;
              const isStop = stopTargetIds.includes(id);
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} />
                  <button
                    type="button"
                    onClick={() => onInspect(t)}
                    className="min-w-0 flex-1 truncate text-left hover:text-accent hover:underline cursor-pointer"
                    title={`${t.name}: open the catalogue record`}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={isDest}
                    onClick={() => onSetDestination(t)}
                    title={isDest ? 'This is the destination' : 'Set as destination'}
                  >
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {isDest ? 'Destination' : 'Set dest.'}
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={isStop || isDest || startTargetId === id}
                    onClick={() => onAddStop(t)}
                    title={isStop ? 'Already a stop' : 'Add as a science stop on the way'}
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    Stop
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
