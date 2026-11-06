import React from 'react';
import { RouteResponse } from '@shared/types';
import { Download, AlertTriangle, CheckCircle, Clock, MapPin, Navigation, Mountain, TrendingUp } from 'lucide-react';

interface RouteDetailsPanelProps {
  route: RouteResponse | null;
  onCalculateRoute: () => void;
  isCalculating: boolean;
}

export const RouteDetailsPanel: React.FC<RouteDetailsPanelProps> = ({
  route,
  onCalculateRoute,
  isCalculating,
}) => {
  const downloadRouteJson = () => {
    if (!route) return;
    const jsonStr = JSON.stringify(route, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.route_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate SVG Elevation Chart Path
  const renderElevationSvg = () => {
    if (!route || route.elevation_profile.length < 2) return null;
    const profile = route.elevation_profile;
    const elevations = profile.map((p) => p.elevation_m);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    const rangeElev = Math.max(10, maxElev - minElev);

    const width = 300;
    const height = 70;
    const padding = 10;

    const points = profile.map((pt, idx) => {
      const x = padding + (idx / (profile.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((pt.elevation_m - minElev) / rangeElev) * (height - 2 * padding);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const pathD = `M ${points[0]} L ${points.join(' L ')}`;
    const areaD = `M ${padding},${height - padding} L ${points.join(' L ')} L ${width - padding},${height - padding} Z`;

    return (
      <div className="bg-[#06090e] p-2.5 rounded-xl border border-slate-800 space-y-1">
        <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
          <span className="flex items-center space-x-1 text-cyan-300 font-bold">
            <TrendingUp className="w-3 h-3" />
            <span>MOLA ELEVATION PROFILE</span>
          </span>
          <span>
            MIN: <strong className="text-slate-200">{minElev}m</strong> | MAX: <strong className="text-amber-400">{maxElev}m</strong>
          </span>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16 overflow-visible">
          <defs>
            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Fill Area */}
          <path d={areaD} fill="url(#elevGrad)" />
          {/* Baseline */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" strokeWidth="1" />
          {/* Profile Line */}
          <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-4 font-sans">
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            04
          </span>
          <h2 className="font-display font-bold text-sm tracking-wider text-slate-100 uppercase">
            ROUTE TELEMETRY & DIAGNOSTICS
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Terrain-aware path calculations, elevation profiles, slope analysis, and EVA safety buffers.
        </p>
      </div>

      <button
        onClick={onCalculateRoute}
        disabled={isCalculating}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-[#06090e] font-display font-extrabold uppercase tracking-wider text-xs shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center space-x-2 cursor-pointer"
      >
        <Navigation className="w-4 h-4" />
        <span>{isCalculating ? 'Computing Optimal Traversal...' : 'GENERATE TERRAIN ROUTE'}</span>
      </button>

      {route ? (
        <div className="space-y-4 font-mono">
          {/* Status Banner */}
          <div
            className={`p-3 rounded-xl border flex items-center space-x-3 ${
              route.status === 'calculated'
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                : route.status === 'warning'
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
                : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
            }`}
          >
            {route.status === 'calculated' ? (
              <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
            )}
            <div>
              <div className="font-bold uppercase tracking-wider text-[11px]">
                STATUS: {route.status}
              </div>
              <div className="text-[10px] opacity-80">
                ROUTE ID: {route.route_id} • {route.coordinates.length} Geometry Nodes
              </div>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0d121d] border border-slate-800 p-3 rounded-xl">
              <span className="text-slate-400 text-[10px] block">2D MAP DISTANCE</span>
              <span className="text-cyan-300 text-base font-bold">
                {(route.distance_m / 1000).toFixed(2)} km
              </span>
              <span className="text-[10px] text-slate-500 block">3D TERRAIN: {((route.distance_3d_m || route.distance_m) / 1000).toFixed(2)} km</span>
            </div>

            <div className="bg-[#0d121d] border border-slate-800 p-3 rounded-xl">
              <span className="text-slate-400 text-[10px] block">ESTIMATED TRAVERSAL</span>
              <span className="text-amber-300 text-base font-bold">
                {Math.floor(route.estimated_time_min / 60)}h {route.estimated_time_min % 60}m
              </span>
              <span className="text-[10px] text-slate-500 block">({route.estimated_time_min} mins)</span>
            </div>
          </div>

          {/* Elevation Profile Chart */}
          {renderElevationSvg()}

          {/* EVA Budget Usage Bar */}
          <div className="bg-[#0d121d] border border-slate-800 p-3 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-300 flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>EVA Time Budget Used:</span>
              </span>
              <span className="font-bold text-cyan-300">{route.eva_budget_used_percent}%</span>
            </div>
            <div className="w-full h-2 bg-[#06090e] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  route.eva_budget_used_percent > 90
                    ? 'bg-rose-500'
                    : route.eva_budget_used_percent > 75
                    ? 'bg-amber-500'
                    : 'bg-cyan-400'
                }`}
                style={{ width: `${Math.min(100, route.eva_budget_used_percent)}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Return Safety Buffer:</span>
              <span className="text-emerald-400 font-bold">{route.return_margin_min} mins</span>
            </div>
          </div>

          {/* Warnings list */}
          {route.warnings.length > 0 && (
            <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl space-y-1.5 text-[10px] text-amber-200">
              <div className="font-bold flex items-center space-x-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>SAFETY & SLOPE WARNINGS ({route.warnings.length}):</span>
              </div>
              <ul className="list-disc pl-4 space-y-1">
                {route.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Terrain Summary Breakdown */}
          <div className="bg-[#0d121d] border border-slate-800 p-3 rounded-xl space-y-2">
            <span className="text-slate-300 font-bold text-[11px] flex items-center space-x-1.5">
              <Mountain className="w-3.5 h-3.5 text-amber-400" />
              <span>Slope Breakdown (% Distance)</span>
            </span>
            <div className="grid grid-cols-4 gap-1 text-[10px] text-center">
              <div className="bg-[#06090e] p-1.5 rounded border border-emerald-500/30">
                <span className="text-slate-400 block">FLAT</span>
                <span className="text-emerald-400 font-bold">{route.terrain_summary.flat_pct}%</span>
              </div>
              <div className="bg-[#06090e] p-1.5 rounded border border-cyan-500/30">
                <span className="text-slate-400 block">MOD</span>
                <span className="text-cyan-400 font-bold">{route.terrain_summary.moderate_pct}%</span>
              </div>
              <div className="bg-[#06090e] p-1.5 rounded border border-amber-500/30">
                <span className="text-slate-400 block">STEEP</span>
                <span className="text-amber-400 font-bold">{route.terrain_summary.steep_pct}%</span>
              </div>
              <div className="bg-[#06090e] p-1.5 rounded border border-rose-500/30">
                <span className="text-slate-400 block">HAZARD</span>
                <span className="text-rose-400 font-bold">{route.terrain_summary.hazardous_pct}%</span>
              </div>
            </div>
          </div>

          {/* Segments list */}
          <div className="space-y-1.5">
            <span className="text-slate-400 text-[10px] font-bold block uppercase">
              Traversal Segments ({route.segments.length})
            </span>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {route.segments.map((seg, i) => (
                <div
                  key={i}
                  className="p-2 bg-[#06090e] border border-slate-800 rounded flex justify-between items-center text-[10px]"
                >
                  <div>
                    <span className="text-cyan-300 font-bold">{seg.from_name}</span>
                    <span className="text-slate-500 mx-1">➔</span>
                    <span className="text-amber-300 font-bold">{seg.to_name}</span>
                    <div className="text-slate-400 text-[9px] mt-0.5">{seg.terrain_type}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-200 font-bold block">{seg.distance_m}m</span>
                    <span className="text-slate-400 text-[9px]">{seg.estimated_time_min}m</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={downloadRouteJson}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>EXPORT ROUTE GEOJSON / JSON</span>
          </button>
        </div>
      ) : (
        <div className="p-6 bg-[#0d121d] border border-slate-800 rounded-xl text-center space-y-2 text-slate-500">
          <MapPin className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-xs">No route calculated yet.</p>
          <p className="text-[10px]">Select a Science Target and click Generate Terrain Route.</p>
        </div>
      )}
    </div>
  );
};
