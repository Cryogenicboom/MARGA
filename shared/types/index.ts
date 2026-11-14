/**
 * MARGA - Mars Adaptive Route Guidance Architecture
 * Shared Data Contracts & TypeScript Types
 * Defined by Person 1 (Frontend Architect) in collaboration with Person 2 (Core Engine Lead)
 */

export type ScienceCategory =
  | 'mineralogical'
  | 'sedimentary'
  | 'hydration'
  | 'radiation'
  | 'geological';

export type TargetConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface ScienceTarget {
  id: string;
  name: string;
  category: ScienceCategory;
  latitude: number;       // Planetocentric Latitude (-90 to +90)
  longitude: number;      // East Longitude (0 to 360 or -180 to 180, Gale Crater ~ 137.4°E)
  elevation_m: number;    // Elevation in meters relative to Mars MOLA datum
  source: string;         // Mission source e.g. "MSL Curiosity / NASA PDS"
  instrument: string;     // Instrument name e.g. "ChemCam", "APXS", "CRISM"
  product_id?: string;    // NASA Product ID if available
  confidence: TargetConfidence;
  description: string;
  scientific_significance: string;
  data_limitations: string;
  sol_discovered?: number;
}

export interface ScientificObjective {
  id: string;
  title: string;
  category: ScienceCategory;
  description: string;
  primary_target_ids: string[];
  icon: string;
}

export interface MissionConstraints {
  walkingSpeedKmh: number;     // Configurable walking speed (e.g., 1.2 km/h)
  maxSlopeDegrees: number;     // Maximum safe traversal slope (e.g., 15°)
  maxEvaHours: number;         // Total EVA time budget in hours (e.g., 8.0 hrs)
  reserveEvaHours: number;      // Mandatory reserve EVA buffer in hours (e.g., 1.5 hrs)
  maxDistanceMeters: number;   // Maximum one-way traverse radius in meters
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  name?: string;
  elevation_m?: number;
}

export interface RouteRequest {
  route_id?: string;
  start: LocationPoint;
  destination: LocationPoint;
  waypoints?: LocationPoint[];
  target_ids?: string[];
  constraints: MissionConstraints;
}

export interface RouteSegment {
  from_name: string;
  to_name: string;
  distance_m: number;
  estimated_time_min: number;
  average_slope_deg: number;
  terrain_type: string;
}

export interface ElevationPoint {
  distance_m: number;
  elevation_m: number;
  slope_deg: number;
  coordinate: [number, number]; // [longitude, latitude]
}

export interface TerrainSummary {
  flat_pct: number;         // < 5 deg
  moderate_pct: number;     // 5-12 deg
  steep_pct: number;        // 12-20 deg
  hazardous_pct: number;    // > 20 deg or obstacle
}

export type RouteStatus = 'calculated' | 'unreachable' | 'warning' | 'failed';

export interface RouteResponse {
  route_id: string;
  distance_m: number;           // 2D Map Horizontal Distance
  distance_3d_m: number;        // 3D Terrain Surface Distance
  elevation_gain_m: number;     // Total Cumulative Elevation Gain
  elevation_loss_m: number;     // Total Cumulative Elevation Loss
  estimated_time_min: number;
  eva_budget_used_percent: number;
  return_margin_min: number;
  coordinates: Array<[number, number]>; // GeoJSON format: [longitude, latitude]
  elevation_profile: ElevationPoint[];
  segments: RouteSegment[];
  status: RouteStatus;
  warnings: string[];
  terrain_summary: TerrainSummary;
}

export interface MarsRegionMetadata {
  region_id: string;
  name: string;
  center_lat: number;
  center_lon: number;
  bounding_box: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
  };
  datum: string;
  resolution_m_per_pixel: number;
  description: string;
}
