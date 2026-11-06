import React, { useState } from 'react';
import { ScienceTarget, ScienceCategory } from '@shared/types';
import { Search, MapPin, Info, Database } from 'lucide-react';

interface TargetSelectionPanelProps {
  targets: ScienceTarget[];
  selectedTarget: ScienceTarget | null;
  onSelectTarget: (target: ScienceTarget) => void;
  destinationPoint: ScienceTarget | null;
  onSetAsDestination: (target: ScienceTarget) => void;
}

const CATEGORY_BADGES: Record<ScienceCategory, { label: string; class: string }> = {
  mineralogical: { label: 'MINERALOGY', class: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  hydration: { label: 'HYDRATION', class: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' },
  sedimentary: { label: 'SEDIMENTARY', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  radiation: { label: 'RADIATION', class: 'bg-purple-500/10 text-purple-300 border-purple-500/30' },
  geological: { label: 'GEOLOGY', class: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
};

export const TargetSelectionPanel: React.FC<TargetSelectionPanelProps> = ({
  targets,
  selectedTarget,
  onSelectTarget,
  destinationPoint,
  onSetAsDestination,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ScienceCategory | 'all'>('all');
  const [detailTarget, setDetailTarget] = useState<ScienceTarget | null>(null);

  const filteredTargets = targets.filter((target) => {
    const matchesSearch =
      target.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      target.instrument.toLowerCase().includes(searchTerm.toLowerCase()) ||
      target.source.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || target.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4 font-sans">
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
            02
          </span>
          <h2 className="font-display font-bold text-sm tracking-wider text-slate-100 uppercase">
            NASA SCIENCE TARGET CATALOGUE
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Explore verified Gale Crater observations from NASA MSL Curiosity, CRISM & MOLA datasets.
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter targets by name or instrument..."
            className="w-full pl-9 pr-3 py-2 bg-[#06090e] border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-colors"
          />
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5 pt-1 font-mono">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-2.5 py-1 rounded text-[10px] border transition-all ${
              selectedCategory === 'all'
                ? 'bg-slate-700 text-slate-100 border-slate-600 font-bold'
                : 'bg-[#06090e] text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            ALL ({targets.length})
          </button>
          {(['hydration', 'mineralogical', 'sedimentary', 'geological', 'radiation'] as ScienceCategory[]).map(
            (cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded text-[10px] border transition-all uppercase ${
                  selectedCategory === cat
                    ? 'bg-slate-700 text-cyan-300 border-cyan-500/50 font-bold'
                    : 'bg-[#06090e] text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            )
          )}
        </div>
      </div>

      {/* Target List */}
      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
        {filteredTargets.map((target) => {
          const isSelected = selectedTarget?.id === target.id;
          const isDest = destinationPoint?.id === target.id;
          const badge = CATEGORY_BADGES[target.category];

          return (
            <div
              key={target.id}
              className={`p-3 rounded-xl border transition-all ${
                isDest
                  ? 'bg-amber-950/30 border-amber-500/60 ring-1 ring-amber-500/40'
                  : isSelected
                  ? 'bg-[#101622] border-cyan-500/50'
                  : 'bg-[#0d121d] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => {
                    onSelectTarget(target);
                    onSetAsDestination(target);
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-mono border font-bold ${badge.class}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {target.instrument}
                    </span>
                  </div>

                  <h3 className="font-display font-bold text-xs text-slate-100 mt-1.5 hover:text-cyan-300 transition-colors">
                    {target.name}
                  </h3>

                  <div className="flex items-center space-x-3 text-[10px] font-mono text-slate-400 mt-1">
                    <span>LAT: {target.latitude.toFixed(4)}°</span>
                    <span>LON: {target.longitude.toFixed(4)}°</span>
                    <span>ELEV: {target.elevation_m}m</span>
                  </div>
                </div>

                {/* Info & Select Buttons */}
                <div className="flex flex-col items-end space-y-1.5 ml-2">
                  <button
                    onClick={() => setDetailTarget(target)}
                    className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-[#182232] transition-colors"
                    title="View details & data provenance"
                  >
                    <Info className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => onSetAsDestination(target)}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono flex items-center space-x-1 border transition-all ${
                      isDest
                        ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow'
                        : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <MapPin className="w-3 h-3" />
                    <span>{isDest ? 'DEST' : 'SELECT'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Target Details Drawer Modal */}
      {detailTarget && (
        <div className="p-4 rounded-xl bg-[#06090e] border border-cyan-500/50 space-y-3 font-mono text-xs shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-slate-100 uppercase">{detailTarget.name}</span>
            </div>
            <button
              onClick={() => setDetailTarget(null)}
              className="text-slate-400 hover:text-white font-bold"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 text-slate-300 text-[11px] font-sans">
            <p><strong className="text-cyan-300 font-mono">DESCRIPTION:</strong> {detailTarget.description}</p>
            <p><strong className="text-amber-300 font-mono">SCIENTIFIC SIGNIFICANCE:</strong> {detailTarget.scientific_significance}</p>
            <p><strong className="text-rose-400 font-mono">DATA LIMITATIONS:</strong> {detailTarget.data_limitations}</p>
          </div>

          <div className="pt-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-400 font-mono">
            <span>SOURCE: {detailTarget.source}</span>
            <span>CONFIDENCE: <strong className="text-emerald-400 uppercase">{detailTarget.confidence}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
};
