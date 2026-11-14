import React, { useState, useEffect } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

interface SolTimelineSliderProps {
  currentSol: number;
  onSolChange: (sol: number) => void;
  minSol?: number;
  maxSol?: number;
  /** e.g. "6 of 8 targets" */
  caption?: string;
}

/** Filters targets by the sol (Martian day) Curiosity first reached them; Play steps through the mission. */
export const SolTimelineSlider: React.FC<SolTimelineSliderProps> = ({
  currentSol,
  onSolChange,
  minSol = 0,
  maxSol = 3200,
  caption,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    if (!isPlaying) return;
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      onSolChange(currentSol >= maxSol ? minSol : Math.min(maxSol, currentSol + 50));
    }, 300);
    return () => clearInterval(interval);
  }, [isPlaying, currentSol, maxSol, minSol, onSolChange]);

  const btn = 'rounded p-1 text-muted hover:bg-raised hover:text-fg cursor-pointer';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          className={btn}
          aria-label={isPlaying ? 'Pause' : 'Play through the mission'}
          title={isPlaying ? 'Pause' : 'Play through the mission'}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => onSolChange(minSol)} className={btn} aria-label={`Back to sol ${minSol}`} title={`Back to sol ${minSol}`}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <input
          type="range"
          min={minSol}
          max={maxSol}
          step={25}
          value={currentSol}
          onChange={(e) => onSolChange(parseInt(e.target.value))}
          aria-label="Sol"
          className="min-w-0 flex-1"
        />
        <span className="num w-16 shrink-0 text-right">Sol {currentSol}</span>
      </div>
      <p className="text-[11px] text-faint">
        Targets Curiosity had reached by this sol{caption ? `: ${caption}` : ''}.
      </p>
    </div>
  );
};
