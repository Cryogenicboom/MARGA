import React from 'react';
import { ScientificObjective } from '@shared/types';
import { Droplets, Layers, FileText, Compass, CheckCircle2, Target } from 'lucide-react';

interface MissionSelectionPanelProps {
  objectives: ScientificObjective[];
  selectedObjectiveId: string | null;
  onSelectObjective: (obj: ScientificObjective | null) => void;
}

const OBJECTIVE_ICONS: Record<string, React.ReactNode> = {
  Droplets: <Droplets className="w-5 h-5 text-cyan-400" />,
  Layers: <Layers className="w-5 h-5 text-amber-400" />,
  FileText: <FileText className="w-5 h-5 text-emerald-400" />,
  Compass: <Compass className="w-5 h-5 text-rose-400" />,
};

export const MissionSelectionPanel: React.FC<MissionSelectionPanelProps> = ({
  objectives,
  selectedObjectiveId,
  onSelectObjective,
}) => {
  return (
    <div className="space-y-4 font-sans">
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#105bd8]/20 text-[#38bdf8] border border-[#105bd8]/40">
            01
          </span>
          <h2 className="font-display font-bold text-sm tracking-wider text-slate-100 uppercase">
            PRIMARY SCIENTIFIC OBJECTIVES
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Select an excursion primary science objective to filter associated NASA observations.
        </p>
      </div>

      <div className="space-y-2.5">
        {objectives.map((obj) => {
          const isSelected = selectedObjectiveId === obj.id;
          return (
            <div
              key={obj.id}
              onClick={() => onSelectObjective(isSelected ? null : obj)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-[#101622] border-[#38bdf8] shadow-lg shadow-cyan-950/40 ring-1 ring-[#38bdf8]/50'
                  : 'bg-[#0d121d] border-slate-800 hover:border-slate-700 hover:bg-[#101622]'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className="p-2.5 rounded-lg bg-[#06090e] border border-slate-800 shrink-0">
                  {OBJECTIVE_ICONS[obj.icon] || <Compass className="w-5 h-5 text-slate-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xs font-bold text-slate-100 truncate">
                      {obj.title}
                    </h3>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 ml-1" />
                    )}
                  </div>

                  <p className="text-[11px] text-slate-300 mt-1 line-clamp-2 leading-relaxed font-sans">
                    {obj.description}
                  </p>

                  <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-[#06090e] text-cyan-400 border border-slate-800 uppercase font-bold">
                      {obj.category}
                    </span>
                    <span className="text-slate-400 flex items-center space-x-1">
                      <Target className="w-3 h-3 text-slate-500" />
                      <span>{obj.primary_target_ids.length} Associated Targets</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
