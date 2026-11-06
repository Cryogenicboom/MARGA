import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Calendar } from 'lucide-react';

interface SolTimelineSliderProps {
  currentSol: number;
  onSolChange: (sol: number) => void;
  minSol?: number;
  maxSol?: number;
}

export const SolTimelineSlider: React.FC<SolTimelineSliderProps> = ({
  currentSol,
  onSolChange,
  minSol = 0,
  maxSol = 3200,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        onSolChange(currentSol >= maxSol ? minSol : currentSol + 50);
      }, 300);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, currentSol, maxSol, minSol, onSolChange]);

  return (
    <div className="bg-[#0b0e14]/90 backdrop-blur border-t border-slate-800 px-6 py-2 flex items-center justify-between z-20 font-mono select-none">
      {/* Playback Controls */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-1.5 rounded-lg bg-[#105bd8]/20 hover:bg-[#105bd8]/40 border border-[#105bd8]/40 text-cyan-300 transition-all flex items-center space-x-1 cursor-pointer"
          title={isPlaying ? 'Pause Timeline' : 'Play Exploration Path Animation'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          <span className="text-[10px] font-bold uppercase">{isPlaying ? 'PAUSE' : 'PLAY TIMELINE'}</span>
        </button>

        <button
          onClick={() => onSolChange(minSol)}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer"
          title="Reset to Sol 0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sol Slider Scrubber */}
      <div className="flex-1 mx-6 flex items-center space-x-4">
        <div className="flex items-center space-x-1.5 text-xs text-amber-300 shrink-0 font-bold">
          <Calendar className="w-4 h-4 text-amber-400" />
          <span>SOL {currentSol}</span>
        </div>

        <input
          type="range"
          min={minSol}
          max={maxSol}
          step={25}
          value={currentSol}
          onChange={(e) => onSolChange(parseInt(e.target.value))}
          className="w-full h-1.5 bg-[#06090e] rounded-lg appearance-none cursor-pointer accent-amber-400"
        />

        <span className="text-[10px] text-slate-500 shrink-0">SOL {maxSol}</span>
      </div>

      {/* Timeline Context Badge */}
      <div className="hidden lg:flex items-center space-x-2 text-[10px] text-slate-400">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
        <span>NASA MSL CURIOSITY TIMELINE SYNC</span>
      </div>
    </div>
  );
};
