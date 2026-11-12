/**
 * MARGA - Core Engine contract EXTENSIONS (Person 2).
 *
 * Purely additive: every field here is optional on top of shared/types/index.ts, so existing
 * frontend code that only knows RouteRequest / RouteResponse keeps working unchanged. Both the
 * Python engine (engine/marga_engine) and the in-browser port (shared/engine) emit these fields.
 */
import type {
  ElevationPoint,
  LocationPoint,
  MissionConstraints,
  RouteRequest,
  RouteResponse,
  RouteSegment,
  TerrainSummary,
} from './index';

export type RouteMetric = 'terrain' | 'distance' | 'time';
export type UnknownPolicy = 'exclude' | 'penalize';

export interface EngineMissionConstraints extends MissionConstraints {
  /** Working time at each waypoint and at the destination (minutes). Omitted -> 0, flagged. */
  scienceTimeMinPerStop?: number;
  /** Simulation override of the historical Curiosity RAD dose-equivalent rate (mSv/day). */
  radiationRateMsvPerDay?: number;
}

export interface EngineRouteOptions {
  metric?: RouteMetric;                 // default 'terrain'
  unknown_policy?: UnknownPolicy;       // default 'exclude' (no-data ground is never treated as flat)
  compute_alternatives?: boolean;       // default true
  slope_weight?: number;                // w_s, default 4
  roughness_weight?: number;            // w_r, default 1 (only if a roughness layer exists)
  uncertainty_weight?: number;          // w_u, default 2 (penalize policy only)
}

export interface EngineRouteRequest extends RouteRequest {
  /** Where the return leg ends. Default: start. */
  habitat?: LocationPoint;
  /** Scientific objective, echoed in mission_summary (e.g. a ScientificObjective's id and title). */
  objective?: { id: string; title?: string };
  options?: EngineRouteOptions;
  constraints: EngineMissionConstraints;
}

export type DataQuality = 'dem' | 'interpolated';

export interface EngineElevationPoint extends ElevationPoint {
  /** ElevationPoint.slope_deg is the ALONG-TRACK slope; this is the Horn terrain slope (incl. cross-slope). */
  terrain_slope_deg?: number | null;
  time_min?: number;                    // cumulative walking time to this point
  leg?: number;
  data_quality?: DataQuality;
}

export interface EngineRouteSegment extends RouteSegment {
  max_terrain_slope_deg?: number | null;
  elevation_gain_m?: number | null;
  elevation_loss_m?: number | null;
  unknown_length_m?: number | null;
  start_snapped_m?: number | null;
  end_snapped_m?: number | null;
}

export interface EngineTerrainSummary extends TerrainSummary {
  unknown_pct?: number;                 // the five classes add up to exactly 100
}

export type EngineStatusReason =
  | 'invalid_request'
  | 'outside_terrain_coverage'
  | 'start_not_traversable'
  | 'destination_not_traversable'
  | 'no_traversable_path'
  | 'return_no_traversable_path'
  | 'return_start_not_traversable'
  | 'return_destination_not_traversable'
  | 'eva_budget_exceeded'
  | 'engine_error'
  | 'terrain_unavailable'                 // browser engine: the terrain package could not be loaded
  | null;

export interface EvaAssessment {
  eva_duration_min: number;
  reserve_min: number;
  usable_min: number;                   // EVA - reserve
  outbound_min: number;
  science_min: number;
  return_min: number;                   // from a NEW search turnaround -> habitat
  mission_time_min: number;             // outbound + science + return + reserve
  return_margin_min: number;            // M = EVA - mission time
  max_science_time_min: number;
  latest_turnaround_elapsed_min: number;
  budget_used_percent: number;
  status: 'within_budget' | 'no_slack' | 'exceeded';
  science_stops: number;
  science_min_per_stop: number | null;
  walking_speed_model: string;
  return_route_recalculated: boolean;
  notes: string[];
}

export interface DoseReference {
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

export interface DoseEstimate {
  dose_equivalent_msv: number;
  duration_min: number;
  duration_days: number;
  formula: string;
  reference: DoseReference;
  absorbed_dose_ugy: number | null;     // only when an absorbed-dose rate is supplied; never converted
  absorbed_reference: Record<string, unknown> | null;
  disclaimers: string[];
}

export interface RouteSummary {
  metric: RouteMetric;
  distance_m: number | null;
  distance_3d_m: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  estimated_time_min: number | null;
  max_terrain_slope_deg: number | null;
  route_cost: number | null;
  terrain_fractions: Record<'flat' | 'moderate' | 'steep' | 'hazardous' | 'unknown', number>;
  coordinates: Array<[number, number]>;
}

export interface ReturnRoute extends RouteSummary {
  from_name: string;
  to_name: string;
  recalculated: true;
  end_snapped_m: number | null;
}

export interface DirectLineStats {
  from_name: string;
  to_name: string;
  distance_m: number;
  max_terrain_slope_deg: number | null;
  prohibited_length_m: number;
  unknown_length_m: number;
  note: string;
}

export interface RouteAlternatives {
  selected_metric: RouteMetric;
  terrain?: RouteSummary | null;
  distance?: RouteSummary | null;
  time?: RouteSummary | null;
  direct_line: DirectLineStats[];
  notes: string[];
}

export interface TerrainSource {
  dataset_id: string;
  label: string;
  synthetic: boolean;
  mission: string | null;
  instrument: string | null;
  source: string | null;
  crs: string | null;
  vertical_datum: string | null;
  resolution_m: number | null;
  processing_level: string | null;
  status: string;
  limitations: string[];
  roughness: string;
}

export interface EngineInfo {
  name: 'marga_engine';
  version: string;
  algorithm: string;
  metric: RouteMetric;
  deterministic: true;
  cost_model: Record<string, unknown>;
  mobility_model: string;
}

export interface LegSearchInfo {
  leg: number;
  search_cell_m: number;
  guide_factor: number;
  window_cells: number;
  expanded_nodes: number;
  notes: string[];
}

/** Spec FR-11 mission summary. */
export interface MissionSummary {
  site: { site_id: string | null; terrain_dataset: string };
  objective: { id: string; title?: string } | null;
  targets: string[];
  start: string;
  habitat: string;
  route_status: RouteResponse['status'];
  total_distance_m: number;
  estimated_travel_time_min: number;
  estimated_working_time_min: number;
  estimated_return_time_min: number;
  return_margin_min: number;
  terrain_advisories: string[];
  radiation: { dose_equivalent_msv: number; duration_min: number; basis: string };
  dataset_references: string[];
  data_limitations: string[];
}

export interface EngineRouteResponse extends RouteResponse {
  elevation_profile: EngineElevationPoint[];
  segments: EngineRouteSegment[];
  terrain_summary: EngineTerrainSummary;
  status_reason?: EngineStatusReason;
  failed_leg?: number;
  eva_assessment?: EvaAssessment;
  radiation?: { planned_activity: DoseEstimate; full_eva_duration: DoseEstimate };
  return_route?: ReturnRoute;
  alternatives?: RouteAlternatives | null;
  search?: LegSearchInfo[];
  assumptions?: string[];
  mission_summary?: MissionSummary;
  engine?: EngineInfo;
  terrain_source?: TerrainSource;
}

/** POST /api/eva/return and engine/ts assessReturn(): field check from the current position. */
export interface ReturnCheckRequest {
  position: LocationPoint;
  habitat: LocationPoint;
  elapsed_min: number;
  constraints: EngineMissionConstraints;
  options?: EngineRouteOptions;
}
