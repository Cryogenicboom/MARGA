/** Engine configuration (mirror of marga_engine/config.py). Simulation parameters, not certified limits. */
import type { RouteMetric, UnknownPolicy } from '../types/engine.ts';

export const SLOPE_CLASS_FLAT_MAX = 5.0;
export const SLOPE_CLASS_MODERATE_MAX = 12.0;
export const SLOPE_CLASS_STEEP_MAX = 20.0;

export interface CostWeights {
  slope: number;
  roughness: number;
  uncertainty: number;
  slopeExponent: number;
}

export interface MobilityParams {
  toblerK: number;
  toblerOffset: number;
  minSpeedKmh: number;
}

export interface DoseRateReference {
  rate_msv_per_day: number;
  quantity: 'dose_equivalent';
  unit: 'mSv/day';
  mission: string;
  instrument: string;
  location: string;
  measurement_period: string;
  source_url: string;
  is_historical: boolean;
  user_modified: boolean;
}

export interface EngineConfig {
  weights: CostWeights;
  mobility: MobilityParams;
  doseReference: DoseRateReference;
  metric: RouteMetric;
  unknownPolicy: UnknownPolicy;
  roughnessMaxCellM: number;
  roughnessRefM: number;
  endpointSnapM: number;
  windowPadFraction: number;
  windowPadMinM: number;
  maxSearchCells: number;
  refineCorridorCells: number;
  smoothing: boolean;
  smoothingTolerance: number;
  computeAlternatives: boolean;
  maxProfilePoints: number;
  coarseDemWarningM: number;
}

export const DEFAULT_DOSE_REFERENCE: DoseRateReference = {
  rate_msv_per_day: 0.67,
  quantity: 'dose_equivalent',
  unit: 'mSv/day',
  mission: 'Mars Science Laboratory (Curiosity)',
  instrument: 'RAD (Radiation Assessment Detector)',
  location: 'Gale Crater surface',
  measurement_period: 'August 2012 - June 2013',
  source_url:
    'https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/',
  is_historical: true,
  user_modified: false,
};

export const DEFAULT_CONFIG: EngineConfig = {
  weights: { slope: 4.0, roughness: 1.0, uncertainty: 2.0, slopeExponent: 2.0 },
  mobility: { toblerK: 3.5, toblerOffset: 0.05, minSpeedKmh: 0.05 },
  doseReference: DEFAULT_DOSE_REFERENCE,
  metric: 'terrain',
  unknownPolicy: 'exclude',
  roughnessMaxCellM: 30.0,
  roughnessRefM: 2.0,
  endpointSnapM: 150.0,
  windowPadFraction: 0.35,
  windowPadMinM: 600.0,
  maxSearchCells: 300_000,
  refineCorridorCells: 3,
  smoothing: true,
  smoothingTolerance: 0.0,
  computeAlternatives: true,
  maxProfilePoints: 1500,
  coarseDemWarningM: 100.0,
};

/** Map snake_case overrides (as used by the Python engine and golden tests) onto the config. */
export function withOverrides(base: EngineConfig, o: Record<string, unknown> = {}): EngineConfig {
  const map: Record<string, keyof EngineConfig> = {
    max_search_cells: 'maxSearchCells', endpoint_snap_m: 'endpointSnapM', smoothing: 'smoothing',
    compute_alternatives: 'computeAlternatives', refine_corridor_cells: 'refineCorridorCells',
    window_pad_fraction: 'windowPadFraction', window_pad_min_m: 'windowPadMinM',
    roughness_max_cell_m: 'roughnessMaxCellM', roughness_ref_m: 'roughnessRefM',
    max_profile_points: 'maxProfilePoints', smoothing_tolerance: 'smoothingTolerance',
  };
  const out: EngineConfig = { ...base };
  for (const [k, v] of Object.entries(o)) {
    const key = (map[k] ?? k) as keyof EngineConfig;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}
