import React from 'react';
import { Database, Compass } from 'lucide-react';

interface DataProvenanceFooterProps {
  cursorCoords: { lat: number; lon: number } | null;
  startName: string;
  destName: string;
}

export const DataProvenanceFooter: React.FC<DataProvenanceFooterProps> = ({
  cursorCoords,
  startName,
  destName,
}) => {
  return (
    <footer className="h-8 bg-[#06090e] border-t border-slate-850 px-6 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none shrink-0 z-30">
      {/* Left: Coordinate Telemetry Viewer */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 text-cyan-400">
          <Compass className="w-3.5 h-3.5" />
          <span>CURSOR:</span>
          {cursorCoords ? (
            <span className="text-slate-100 font-bold tracking-wide">
              {cursorCoords.lat.toFixed(4)}°N, {cursorCoords.lon.toFixed(4)}°E
            </span>
          ) : (
            <span className="text-slate-500">Hover over map surface...</span>
          )}
        </div>

        <div className="hidden lg:flex items-center space-x-2 text-[10px] text-slate-500">
          <span>SPATIAL DATUM: MARS MOLA (EPSG:4326)</span>
        </div>
      </div>

      {/* Center: Excursion Endpoints */}
      <div className="hidden md:flex items-center space-x-3 text-[10px]">
        <span>ORIGIN: <strong className="text-emerald-400">{startName}</strong></span>
        <span className="text-slate-600">➔</span>
        <span>DESTINATION: <strong className="text-amber-400">{destName}</strong></span>
      </div>

      {/* Right: Data Provenance Warning */}
      <div className="flex items-center space-x-2 text-[10px] text-slate-400">
        <Database className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="hidden xl:inline">NASA PDS DATASETS (MSL Curiosity / CRISM / MOLA)</span>
      </div>
    </footer>
  );
};
