/**
 * Curiosity rover views: 360-degree Navcam panoramas at rover stops, built by
 * `python -m marga_gis.msl build` from NASA's raw Navcam frames into public/rover/.
 */
import { calculateMarsDistanceMeters } from './routeService';

export interface RoverFrame {
  imageid: string;
  sol: number;
  date_taken: string | null;
  url: string;
  page: string;
  instrument: string;
  mast_az: string | null;
  mast_el: string | null;
  gain: number;
}

export interface HorizonCheck {
  verdict: 'aligned' | 'offset' | 'inconclusive';
  reason: string;
  azimuth_offset_deg?: number;
  residual_deg?: number;
  median_residual_all_shifts_deg?: number;
  columns?: number;
  dem_horizon_relief_deg?: number;
  offset_meaning?: string;
  dem: string;
  skyline_columns: number;
  dem_azimuths_resolved: number;
}

export interface RoverView {
  id: string;
  rmc: string;
  site: number;
  drive: number;
  lat: number;
  lon: number;
  elev_geoid_m: number;
  traverse_index: number;
  rover_arrived_sol: number;
  sols: number[];
  rover_yaw_deg: number;
  image: string;
  image_bytes: number;
  grid: { width: number; height: number; el_top_deg: number; el_bottom_deg: number; azimuth: string };
  coverage: { horizon_band_azimuth_fraction: number; frames: number };
  targets: Array<{ id: string; name: string; distance_m: number }>;
  frames: RoverFrame[];
  checks: {
    attitude_vs_waypoint_yaw_deg: number;
    seams: { overlap_px: number; median_abs_diff_dn: number | null };
    horizon: HorizonCheck;
  };
  credit: string;
}

export interface RoverViewsDataset {
  title: string;
  source: { agency: string; api: string; locations: string; retrieved_at: string | null };
  method: string;
  limitations: string[];
  targets: Array<{ target_id: string; target: string; stop: string | null; distance_m?: number; neighbours?: string[]; reason?: string }>;
  built_at: string;
  views: RoverView[];
}

export const ROVER_BASE = `${import.meta.env.BASE_URL}rover/`;

export async function loadRoverViews(): Promise<RoverViewsDataset> {
  const res = await fetch(ROVER_BASE + 'views.json');
  if (!res.ok) throw new Error(`Rover views: HTTP ${res.status}`);
  return (await res.json()) as RoverViewsDataset;
}

export function nearestView(views: RoverView[], lat: number, lon: number, radiusM = Infinity) {
  let best: { view: RoverView; distance_m: number } | null = null;
  for (const v of views) {
    const d = calculateMarsDistanceMeters(lat, lon, v.lat, v.lon);
    if (d <= radiusM && (!best || d < best.distance_m)) best = { view: v, distance_m: d };
  }
  return best;
}

export function solLabel(sols: number[]): string {
  if (!sols.length) return '';
  return sols.length === 1 ? `sol ${sols[0]}` : `sols ${sols[0]}–${sols[sols.length - 1]}`;
}
