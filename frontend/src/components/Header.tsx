import React from 'react';
import { RotateCcw, AlertTriangle, Cpu, Radio, Globe2 } from 'lucide-react';

interface HeaderProps {
  regionName: string;
  onReset: () => void;
  targetCount: number;
  hasRoute: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  regionName,
  onReset,
  targetCount,
  hasRoute,
}) => {
  return (
    <header className="bg-[#0b0e14] border-b border-slate-800 shrink-0 z-30 select-none shadow-xl">
      {/* Top Agency Identifier Bar (NASA Web Design System) */}
      <div className="bg-[#06090e] border-b border-slate-850 px-6 py-1 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-bold tracking-wider text-slate-200">
            <span className="w-2 h-2 rounded-full bg-[#fc3d21]"></span>
            <span>NATIONAL AERONAUTICS AND SPACE ADMINISTRATION</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">MARS EXPLORATION DIRECTORATE</span>
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-slate-400 flex items-center space-x-1">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>TELEMETRY LINK: ACTIVE</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">PDS DATA SYSTEM v4.2</span>
        </div>
      </div>

      {/* Main Mission Control Header */}
      <div className="h-14 px-6 flex items-center justify-between">
        {/* Brand & System Title */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            {/* NASA Meatball Badge Graphic */}
            <div className="w-9 h-9 rounded-full bg-[#0b3d91] border border-[#105bd8]/40 flex items-center justify-center relative overflow-hidden shadow-inner group">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0b3d91] to-[#105bd8] opacity-80"></div>
              <div className="absolute w-12 h-1 bg-[#fc3d21] rotate-45 transform top-4 -left-1"></div>
              <span className="relative font-headline font-black text-xs tracking-tighter text-white z-10">
                NASA
              </span>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-headline font-extrabold text-lg tracking-widest text-white uppercase">
                  MARGA
                </h1>
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-[#105bd8]/20 text-cyan-300 border border-[#105bd8]/40 tracking-wider">
                  MISSION CONTROL
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 -mt-0.5">
                Mars Adaptive Route Guidance Architecture
              </p>
            </div>
          </div>
        </div>

        {/* Center: Selected Region Context */}
        <div className="hidden lg:flex items-center space-x-3 bg-[#0d121d] border border-slate-800 px-4 py-1.5 rounded-lg shadow-inner">
          <Globe2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="text-xs font-mono">
            <span className="text-slate-400">OPERATIONAL SECTOR: </span>
            <span className="text-cyan-300 font-bold tracking-wide">{regionName}</span>
          </div>
          <div className="h-3 w.5 bg-slate-800"></div>
          <div className="text-xs font-mono">
            <span className="text-slate-400">PDS OBSERVATIONS: </span>
            <span className="text-amber-400 font-bold">{targetCount} Verified</span>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-3 font-mono">
          <div className="hidden sm:flex items-center space-x-2 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded-md">
            <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold tracking-wide">DETERMINISTIC ENGINE READY</span>
          </div>

          <button
            onClick={onReset}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 transition-all active:scale-95 shadow"
            title="Reset excursion plan"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>RESET PLAN</span>
          </button>

          {hasRoute && (
            <div className="hidden xl:flex items-center space-x-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>NON-CERTIFIED MOBILITY DATA</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
