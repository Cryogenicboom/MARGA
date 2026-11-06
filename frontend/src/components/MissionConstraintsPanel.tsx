import React from 'react';
import { MissionConstraints } from '@shared/types';
import { Gauge, ShieldAlert, Clock, Mountain } from 'lucide-react';

interface MissionConstraintsPanelProps {
  constraints: MissionConstraints;
  onChangeConstraints: (constraints: MissionConstraints) => void;
}

export const MissionConstraintsPanel: React.FC<MissionConstraintsPanelProps> = ({
  constraints,
  onChangeConstraints,
}) => {
  const updateField = (field: keyof MissionConstraints, value: number) => {
    onChangeConstraints({
      ...constraints,
      [field]: value,
    });
  };

  return (
    <div className="space-y-4 font-sans">
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            03
          </span>
          <h2 className="font-display font-bold text-sm tracking-wider text-slate-100 uppercase">
            MOBILITY & SAFETY CONSTRAINTS
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Configure astronaut mobility limits, traversal slope thresholds, and EVA time budget safety buffers.
        </p>
      </div>

      <div className="space-y-4 bg-[#0d121d] border border-slate-800 p-4 rounded-xl font-mono">
        {/* Walking Speed Constraint */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center space-x-2 text-slate-300">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>Base Walking Speed:</span>
            </span>
            <span className="font-bold text-cyan-300">{constraints.walkingSpeedKmh} km/h</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="3.0"
            step="0.1"
            value={constraints.walkingSpeedKmh}
            onChange={(e) => updateField('walkingSpeedKmh', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-[#06090e] rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0.5 km/h (Conservative)</span>
            <span>3.0 km/h (Nominal)</span>
          </div>
        </div>

        {/* Max Slope Constraint */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center space-x-2 text-slate-300">
              <Mountain className="w-4 h-4 text-amber-400" />
              <span>Max Safe Traversal Slope:</span>
            </span>
            <span className="font-bold text-amber-300">{constraints.maxSlopeDegrees}°</span>
          </div>
          <input
            type="range"
            min="5"
            max="25"
            step="1"
            value={constraints.maxSlopeDegrees}
            onChange={(e) => updateField('maxSlopeDegrees', parseInt(e.target.value))}
            className="w-full h-1.5 bg-[#06090e] rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>5° (Basin Floor)</span>
            <span>25° (Scarp Transition)</span>
          </div>
        </div>

        {/* Max EVA Hours */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center space-x-2 text-slate-300">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Total EVA Time Budget:</span>
            </span>
            <span className="font-bold text-emerald-300">{constraints.maxEvaHours} Hours</span>
          </div>
          <input
            type="range"
            min="2.0"
            max="12.0"
            step="0.5"
            value={constraints.maxEvaHours}
            onChange={(e) => updateField('maxEvaHours', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-[#06090e] rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>

        {/* Reserve EVA Buffer */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center space-x-2 text-slate-300">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Safety Reserve Buffer:</span>
            </span>
            <span className="font-bold text-rose-300">{constraints.reserveEvaHours} Hours</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="4.0"
            step="0.5"
            value={constraints.reserveEvaHours}
            onChange={(e) => updateField('reserveEvaHours', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-[#06090e] rounded-lg appearance-none cursor-pointer accent-rose-400"
          />
          <div className="flex justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
            <span>Available Excursion Window:</span>
            <span className="text-slate-200 font-bold">
              {(constraints.maxEvaHours - constraints.reserveEvaHours).toFixed(1)} h
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
