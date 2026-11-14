/**
 * Curiosity CheMin mineralogy, built by `python -m marga_gis.msl build` from NASA PDS
 * (MSL CheMin Mineral Abundance RDR, MSL-M-CHEMIN-5-RDR-V1.0) into public/science/chemin_samples.json.
 * Frontend-only types: the shared target schema is unchanged; samples are linked to targets by distance.
 */
import { calculateMarsDistanceMeters } from './routeService';

export type MineralFamily = 'feldspar' | 'pyroxene' | 'olivine' | 'oxide' | 'sulfate' | 'silica' | 'carbonate' | 'other';

export interface MineralRow {
  /** As published in the PDS table. */
  mineral: string;
  label: string;
  family: MineralFamily;
  wt_pct: number;
  /** Estimated 2-sigma analytical error, weight %. */
  err_2sigma: number;
}

export interface StatedFraction {
  wt_pct: number;
  plus_minus: number | null;
  /** The label sentence the value is quoted from. */
  statement: string;
}

export interface CheminAnalysis {
  product_id: string;
  sample: string;
  sample_kind: 'drill' | 'scoop' | null;
  sample_phrase: string | null;
  sol: number;
  rmc: string;
  start_time: string | null;
  release_id: string | null;
  reanalysis: boolean;
  minerals: MineralRow[];
  table_sum_wt_pct: number;
  fractions: { clay?: StatedFraction; amorphous?: StatedFraction };
  description: string;
  supersedes: string[];
  csv_url: string;
  label_url: string;
  csv_sha256: string;
}

export interface CheminSample {
  id: string;
  name: string;
  kind: 'drill' | 'scoop' | null;
  first_sol: number;
  lat: number | null;
  lon: number | null;
  elev_geoid_m: number | null;
  location: { rmc: string; method: string; analysis_sol: number; rover_arrived_sol: number; basis: string } | null;
  in_region: boolean;
  analyses: CheminAnalysis[];
}

export interface CheminDataset {
  title: string;
  source: {
    agency: string;
    dataset_id: string;
    citation: string;
    archive_page: string;
    inventory_url: string;
    file_naming: string;
    retrieved_at: string | null;
    locations: string;
  };
  notes: string[];
  built_at: string;
  samples: CheminSample[];
}

export const CHEMIN_URL = `${import.meta.env.BASE_URL}science/chemin_samples.json`;

export async function loadChemin(): Promise<CheminDataset> {
  const res = await fetch(CHEMIN_URL);
  if (!res.ok) throw new Error(`CheMin data: HTTP ${res.status}`);
  return (await res.json()) as CheminDataset;
}

/** Located samples within `radiusM` of a point, nearest first. */
export function samplesNear(samples: CheminSample[], lat: number, lon: number, radiusM: number) {
  return samples
    .filter((s): s is CheminSample & { lat: number; lon: number } => s.lat !== null && s.lon !== null)
    .map((s) => ({ sample: s, distance_m: calculateMarsDistanceMeters(lat, lon, s.lat, s.lon) }))
    .filter((x) => x.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);
}

export const FAMILY_LABELS: Record<MineralFamily, string> = {
  feldspar: 'Feldspar',
  pyroxene: 'Pyroxene',
  olivine: 'Olivine',
  oxide: 'Fe-Ti oxide',
  sulfate: 'Sulfate',
  silica: 'Silica',
  carbonate: 'Carbonate',
  other: 'Other',
};

/** The mineral family with the largest share of an analysis' crystalline phases. */
export function dominantFamily(a: CheminAnalysis): { family: MineralFamily; wt_pct: number } {
  const sums = new Map<MineralFamily, number>();
  for (const m of a.minerals) sums.set(m.family, (sums.get(m.family) ?? 0) + m.wt_pct);
  let best: { family: MineralFamily; wt_pct: number } = { family: 'other', wt_pct: 0 };
  for (const [family, wt] of sums) if (wt > best.wt_pct) best = { family, wt_pct: wt };
  return best;
}

/** The analysis to show first: the latest one that is not a reanalysis of a stored sample. */
export function primaryAnalysis(s: CheminSample): CheminAnalysis {
  return s.analyses.find((a) => !a.reanalysis) ?? s.analyses[0];
}
