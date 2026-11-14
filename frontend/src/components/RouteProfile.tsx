import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineElevationPoint, EngineRouteResponse } from '@shared/types/engine';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ROUTE_COLORS, SLOPE_CLASS_COLORS, SLOPE_CLASS_LABELS, slopeClass } from '../map/mapStyles';
import { fmtDeg, fmtDistance, fmtDuration, fmtMetres } from './format';

interface RouteProfileProps {
  route: EngineRouteResponse | null;
  open: boolean;
  onToggle: () => void;
  /** The profile point under the cursor (null when the cursor leaves), for the map marker. */
  onHover: (p: EngineElevationPoint | null) => void;
  /** A click on the profile: centre the map on that point. */
  onSelect?: (p: EngineElevationPoint) => void;
  /** Profile point the map pointer is over (the route under the cursor), drawn as the cursor here. */
  externalIndex?: number | null;
  /** Names of the science stops, in order, to label the leg boundaries. */
  stopNames?: string[];
}

const H = 172;
const M = { l: 66, r: 16, t: 22, b: 34 };
const STRIP = 6;
// Colours follow the theme tokens, so the profile also switches to high contrast.
const C = { grid: 'var(--color-line)', text: 'var(--color-muted)', faint: 'var(--color-faint)', cursor: 'var(--color-fg)' };

function niceStep(range: number, count: number): number {
  const raw = Math.max(range, 1e-9) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

/**
 * Elevation along the planned route, drawn from the engine's elevation_profile as returned:
 * x = distance along the route, y = elevation, the strip = the engine's terrain slope class.
 */
export const RouteProfile: React.FC<RouteProfileProps> = ({ route, open, onToggle, onHover, onSelect, externalIndex = null, stopNames = [] }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pts = (route?.elevation_profile ?? []) as EngineElevationPoint[];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    setHoverIdx(null);
    onHover(null);
  }, [route, onHover]);

  const g = useMemo(() => {
    if (pts.length < 2) return null;
    const plotW = Math.max(40, width - M.l - M.r);
    const plotH = H - M.t - M.b - STRIP - 2;
    const maxD = pts[pts.length - 1].distance_m || 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.elevation_m);
      hi = Math.max(hi, p.elevation_m);
    }
    const pad = Math.max(5, (hi - lo) * 0.1);
    lo -= pad;
    hi += pad;
    const x = (d: number) => M.l + (d / maxD) * plotW;
    const y = (e: number) => M.t + (1 - (e - lo) / (hi - lo)) * plotH;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.distance_m).toFixed(1)} ${y(p.elevation_m).toFixed(1)}`).join('');
    const base = M.t + plotH;
    const area = `${line}L${x(maxD).toFixed(1)} ${base}L${M.l} ${base}Z`;
    const xs = niceStep(maxD, Math.max(2, Math.floor(plotW / 90)));
    const xTicks: number[] = [];
    for (let d = 0; d <= maxD + 1e-6; d += xs) xTicks.push(d);
    const ys = niceStep(hi - lo, 3);
    const yTicks: number[] = [];
    for (let e = Math.ceil(lo / ys) * ys; e <= hi; e += ys) yTicks.push(e);
    const legBreaks = pts.filter((p, i) => i > 0 && p.leg !== undefined && p.leg !== pts[i - 1].leg).map((p) => p.distance_m);
    return { plotW, plotH, maxD, x, y, line, area, base, xTicks, xs, yTicks, legBreaks };
  }, [pts, width]);

  const indexAt = (e: React.MouseEvent<SVGSVGElement>): number | null => {
    if (!g) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - rect.left - M.l) / g.plotW) * g.maxD;
    let a = 0;
    let b = pts.length - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (pts[mid].distance_m < d) a = mid;
      else b = mid;
    }
    return Math.abs(pts[a].distance_m - d) <= Math.abs(pts[b].distance_m - d) ? a : b;
  };
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = indexAt(e);
    if (idx === null) return;
    setHoverIdx(idx);
    onHover(pts[idx]);
  };
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = indexAt(e);
    if (idx !== null) onSelect?.(pts[idx]);
  };
  const handleLeave = () => {
    setHoverIdx(null);
    onHover(null);
  };

  const activeIdx = hoverIdx ?? (externalIndex !== null && externalIndex < pts.length ? externalIndex : null);
  const hp = activeIdx !== null ? pts[activeIdx] : null;
  const kmTicks = g ? g.maxD >= 2000 : false;

  return (
    <div className="shrink-0 border-t border-line bg-panel">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg cursor-pointer"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          Elevation profile
        </button>
        {open && g && (
          <div className="num min-w-0 flex-1 truncate text-right text-[11px] text-muted">
            {hp ? (
              <>
                <span className="text-fg">{fmtDistance(hp.distance_m)}</span> along · elevation{' '}
                <span className="text-fg">{fmtMetres(hp.elevation_m)}</span> · terrain slope{' '}
                <span className="text-fg">{fmtDeg(hp.terrain_slope_deg)}</span> · along-track {fmtDeg(hp.slope_deg)} ·{' '}
                {fmtDuration(hp.time_min)} walking
                {hp.data_quality ? ` · ${hp.data_quality === 'dem' ? 'DEM' : 'interpolated'}` : ''}
                {externalIndex !== null && hoverIdx === null ? ' · from map pointer' : ''}
              </>
            ) : (
              <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
                <span className="text-faint">Strip: terrain slope class</span>
                {(['flat', 'moderate', 'steep', 'hazardous', 'unknown'] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm" style={{ background: SLOPE_CLASS_COLORS[k] }} />
                    {SLOPE_CLASS_LABELS[k].split(',')[0]}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
      {open && (
        <div ref={wrapRef} className="px-1 pb-1">
          {!g ? (
            <p className="px-2 pb-3 text-faint">
              {route ? 'This route has no elevation profile (see the Route tab).' : 'No route yet.'}
            </p>
          ) : (
            <svg
              width={width}
              height={H}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onClick={handleClick}
              role="img"
              aria-label="Elevation profile along the planned route. Hover to see the point on the map; click to centre the map there."
              className="block cursor-crosshair"
            >
              <text x={14} y={M.t + g.plotH / 2} transform={`rotate(-90 14 ${M.t + g.plotH / 2})`} textAnchor="middle" fontSize="11" fill={C.faint}>
                Elevation (m)
              </text>
              <text x={M.l + g.plotW / 2} y={H - 2} textAnchor="middle" fontSize="11" fill={C.faint}>
                Distance along route
              </text>
              <text x={M.l} y={12} textAnchor="start" fontSize="11" fill={C.text}>
                Start
              </text>
              <text x={M.l + g.plotW} y={12} textAnchor="end" fontSize="11" fill={C.text}>
                Destination
              </text>
              {g.yTicks.map((e) => (
                <g key={e}>
                  <line x1={M.l} x2={M.l + g.plotW} y1={g.y(e)} y2={g.y(e)} stroke={C.grid} />
                  <text x={M.l - 6} y={g.y(e) + 4} textAnchor="end" fontSize="11.5" fill={C.text} className="num">
                    {Math.round(e)} m
                  </text>
                </g>
              ))}
              {g.xTicks.map((d) => (
                <text key={d} x={g.x(d)} y={g.base + STRIP + 15} textAnchor="middle" fontSize="11.5" fill={C.text} className="num">
                  {kmTicks ? `${(d / 1000).toFixed(g.xs < 1000 ? 1 : 0)} km` : `${Math.round(d)} m`}
                </text>
              ))}
              <path d={g.area} fill={ROUTE_COLORS.route} fillOpacity={0.1} />
              <path d={g.line} fill="none" stroke={ROUTE_COLORS.route} strokeWidth={2} />
              {pts.slice(0, -1).map((p, i) => {
                const x0 = g.x(p.distance_m);
                const x1 = g.x(pts[i + 1].distance_m);
                const cls = typeof p.terrain_slope_deg === 'number' ? slopeClass(p.terrain_slope_deg) : 'unknown';
                return <rect key={i} x={x0} y={g.base + 2} width={Math.max(0.5, x1 - x0)} height={STRIP} fill={SLOPE_CLASS_COLORS[cls]} />;
              })}
              {g.legBreaks.map((d, i) => (
                <g key={d}>
                  <line x1={g.x(d)} x2={g.x(d)} y1={M.t - 4} y2={g.base} stroke={ROUTE_COLORS.stop} strokeDasharray="3 3" />
                  <text x={g.x(d)} y={12} textAnchor="middle" fontSize="11" fill={ROUTE_COLORS.stop}>
                    <title>{stopNames[i] ?? `Stop ${i + 1}`}</title>
                    Stop {i + 1}
                  </text>
                </g>
              ))}
              {hp && (
                <g pointerEvents="none">
                  <line x1={g.x(hp.distance_m)} x2={g.x(hp.distance_m)} y1={M.t} y2={g.base + STRIP + 2} stroke={C.cursor} strokeWidth={1} />
                  <circle cx={g.x(hp.distance_m)} cy={g.y(hp.elevation_m)} r={4} fill={C.cursor} stroke="var(--color-bg)" strokeWidth={1.5} />
                </g>
              )}
            </svg>
          )}
        </div>
      )}
    </div>
  );
};
