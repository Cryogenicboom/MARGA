import React, { useMemo } from 'react';
import type { EngineRouteResponse } from '@shared/types/engine';
import { Camera, Diamond } from 'lucide-react';
import { SubHeading } from './Section';
import { fmtDistance } from './format';
import { calculateMarsDistanceMeters } from '../services/routeService';
import type { CheminSample } from '../services/minerals';
import { solLabel, type RoverView } from '../services/roverViews';
import { sampleSummary } from './MineralsPanel';

const NEAR_ROUTE_M = 150;

function distanceToRoute(coords: Array<[number, number]>, lat: number, lon: number): number {
  let best = Infinity;
  for (const [clon, clat] of coords) {
    const d = calculateMarsDistanceMeters(lat, lon, clat, clon);
    if (d < best) best = d;
  }
  return best;
}

/** Route tab: Curiosity rover views and CheMin samples within 150 m of the planned route. */
export const NearbySurfaceData: React.FC<{
  route: EngineRouteResponse | null;
  views: RoverView[];
  samples: CheminSample[];
  onOpenView: (v: RoverView) => void;
  onOpenSample: (s: CheminSample) => void;
}> = ({ route, views, samples, onOpenView, onOpenSample }) => {
  const near = useMemo(() => {
    const coords = (route?.coordinates ?? []) as Array<[number, number]>;
    if (coords.length < 2) return null;
    return {
      views: views
        .map((v) => ({ v, d: distanceToRoute(coords, v.lat, v.lon) }))
        .filter((x) => x.d <= NEAR_ROUTE_M)
        .sort((a, b) => a.v.traverse_index - b.v.traverse_index),
      samples: samples
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s) => ({ s, d: distanceToRoute(coords, s.lat as number, s.lon as number) }))
        .filter((x) => x.d <= NEAR_ROUTE_M)
        .sort((a, b) => a.s.first_sol - b.s.first_sol),
    };
  }, [route, views, samples]);
  if (!near) return null;
  return (
    <div>
      <SubHeading>Curiosity data along this route</SubHeading>
      {near.views.length === 0 && near.samples.length === 0 ? (
        <p className="text-[11px] text-faint">No rover view or CheMin sample within {NEAR_ROUTE_M} m of the route.</p>
      ) : (
        <ul className="space-y-1">
          {near.views.map(({ v, d }) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpenView(v)} className="flex w-full items-baseline gap-1.5 text-left hover:text-accent cursor-pointer">
                <Camera className="h-3.5 w-3.5 shrink-0 self-center text-muted" aria-hidden="true" />
                <span>Rover view, {solLabel(v.sols)}</span>
                <span className="num ml-auto shrink-0 text-[11px] text-faint">{fmtDistance(d)} off route</span>
              </button>
            </li>
          ))}
          {near.samples.map(({ s, d }) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpenSample(s)} className="w-full text-left hover:text-accent cursor-pointer">
                <span className="flex items-baseline gap-1.5">
                  <Diamond className="h-3.5 w-3.5 shrink-0 self-center text-muted" aria-hidden="true" />
                  <span>{s.name} (CheMin)</span>
                  <span className="num ml-auto shrink-0 text-[11px] text-faint">{fmtDistance(d)} off route</span>
                </span>
                <span className="block truncate pl-5 text-[11px] text-muted">{sampleSummary(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
