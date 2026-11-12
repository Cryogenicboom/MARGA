import React from 'react';
import { ScientificObjective } from '@shared/types';
import { CATEGORY_COLORS } from '../map/mapStyles';

interface MissionSelectionPanelProps {
  objectives: ScientificObjective[];
  selectedObjectiveId: string | null;
  onSelectObjective: (obj: ScientificObjective | null) => void;
}

/** Science objective. Selecting one sets its first target as the destination; selecting it again clears it. */
export const MissionSelectionPanel: React.FC<MissionSelectionPanelProps> = ({
  objectives,
  selectedObjectiveId,
  onSelectObjective,
}) => (
  <div className="space-y-0.5" role="radiogroup" aria-label="Science objective">
    {objectives.map((obj) => {
      const isSelected = selectedObjectiveId === obj.id;
      return (
        <button
          key={obj.id}
          type="button"
          role="radio"
          aria-checked={isSelected}
          onClick={() => onSelectObjective(isSelected ? null : obj)}
          className={`w-full rounded px-2 py-1.5 text-left cursor-pointer ${
            isSelected ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg'
          }`}
        >
          <span className="flex items-start gap-2">
            <span
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${isSelected ? 'border-accent bg-accent' : 'border-line-strong'}`}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[obj.category] }} />
                <span className="truncate">{obj.title}</span>
              </span>
              {isSelected && <span className="mt-0.5 block text-[11px] text-muted">{obj.description}</span>}
            </span>
          </span>
        </button>
      );
    })}
  </div>
);
