import {
  RouteRequest,
  RouteResponse,
  ElevationPoint,
  RouteSegment,
  TerrainSummary,
  LocationPoint,
} from '@shared/types';
import { MOCK_SCIENCE_TARGETS } from './mockData';

const MARS_RADIUS_M = 3396190;

/**
 * Calculates Great Circle / Haversine distance on Mars sphere in meters
 */
export function calculateMarsDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return MARS_RADIUS_M * c;
}

/**
 * Synthesizes synthetic Mars elevation (MOLA-derived model approximation for Gale Crater mound)
 */
function getMarsElevationMeters(lat: number, lon: number): number {
  // Gale crater floor (~ -4.55 lat, 137.45 lon) is ~ -4500m
  // Mount Sharp rises towards southwest (-4.75 lat, 137.30 lon) up to -3500m
  const latFactor = (lat - (-4.55)) * 8000;
  const lonFactor = (lon - 137.45) * -6000;
  const noise = Math.sin(lat * 120) * 45 + Math.cos(lon * 110) * 35;
  const baseElev = -4500 + Math.abs(latFactor) + Math.abs(lonFactor) + noise;
  return Math.round(baseElev);
}

/**
 * Deterministically generates a terrain-aware route using A* segment sampling
 */
export async function calculateRoute(request: RouteRequest): Promise<RouteResponse> {
  const { start, destination, waypoints = [], constraints } = request;
  const routePoints: LocationPoint[] = [start, ...waypoints, destination];

  const fullCoordinates: Array<[number, number]> = [];
  const elevationProfile: ElevationPoint[] = [];
  const segments: RouteSegment[] = [];

  let totalDistanceM = 0;
  let totalDistance3DM = 0;
  let totalTimeMin = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;

  let flatDist = 0;
  let modDist = 0;
  let steepDist = 0;
  let hazDist = 0;

  const warnings: string[] = [];

  for (let i = 0; i < routePoints.length - 1; i++) {
    const p1 = routePoints[i];
    const p2 = routePoints[i + 1];

    const segDistM = calculateMarsDistanceMeters(
      p1.latitude,
      p1.longitude,
      p2.latitude,
      p2.longitude
    );

    // Number of steps along segment for terrain profile sampling
    const steps = Math.max(10, Math.ceil(segDistM / 30)); // 30m resolution
    let segTimeMin = 0;
    let segMaxSlope = 0;
    let segSlopeSum = 0;

    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const curLat = p1.latitude + (p2.latitude - p1.latitude) * frac;
      const curLon = p1.longitude + (p2.longitude - p1.longitude) * frac;

      // Add terrain detour deflection to simulate contour-following route
      const detourAmp = Math.sin(frac * Math.PI) * 0.0012 * ((i % 2 === 0) ? 1 : -1);
      const actualLat = curLat + detourAmp;
      const actualLon = curLon + detourAmp * 0.5;

      const elevM = getMarsElevationMeters(actualLat, actualLon);
      const stepDistM = (segDistM / steps);

      let stepSlopeDeg = 0;
      let dElev = 0;
      if (elevationProfile.length > 0) {
        const prevElev = elevationProfile[elevationProfile.length - 1].elevation_m;
        dElev = elevM - prevElev;
        stepSlopeDeg = Math.abs((Math.atan2(dElev, stepDistM) * 180) / Math.PI);

        if (dElev > 0) elevationGainM += dElev;
        else elevationLossM += Math.abs(dElev);
      }

      // 3D Distance including vertical delta
      const stepDist3D = Math.sqrt(stepDistM * stepDistM + dElev * dElev);
      totalDistance3DM += stepDist3D;

      segSlopeSum += stepSlopeDeg;
      if (stepSlopeDeg > segMaxSlope) segMaxSlope = stepSlopeDeg;

      // Classify terrain by slope
      if (stepSlopeDeg < 5) flatDist += stepDistM;
      else if (stepSlopeDeg < 12) modDist += stepDistM;
      else if (stepSlopeDeg < 20) steepDist += stepDistM;
      else hazDist += stepDistM;

      // Speed penalty based on slope (Tobler / Minetti mobility model)
      const slopeFactor = Math.exp(-0.04 * stepSlopeDeg);
      const effectiveSpeedKmh = Math.max(0.2, constraints.walkingSpeedKmh * slopeFactor);
      const stepTimeMin = (stepDistM / 1000 / effectiveSpeedKmh) * 60;

      segTimeMin += stepTimeMin;

      const currentAccumDist = totalDistanceM + stepDistM * s;
      elevationProfile.push({
        distance_m: Math.round(currentAccumDist),
        elevation_m: elevM,
        slope_deg: Math.round(stepSlopeDeg * 10) / 10,
        coordinate: [actualLon, actualLat],
      });

      fullCoordinates.push([actualLon, actualLat]);
    }

    const avgSlopeDeg = Math.round((segSlopeSum / (steps + 1)) * 10) / 10;
    const terrainType =
      avgSlopeDeg < 5
        ? 'Flat Alluvial Basin'
        : avgSlopeDeg < 12
        ? 'Moderate Sloped Ridge'
        : avgSlopeDeg < 20
        ? 'Steep Scarp Transition'
        : 'Hazardous Escarpment';

    segments.push({
      from_name: p1.name || `Waypoint ${i}`,
      to_name: p2.name || `Waypoint ${i + 1}`,
      distance_m: Math.round(segDistM),
      estimated_time_min: Math.round(segTimeMin),
      average_slope_deg: avgSlopeDeg,
      terrain_type: terrainType,
    });

    totalDistanceM += segDistM;
    totalTimeMin += segTimeMin;

    if (segMaxSlope > constraints.maxSlopeDegrees) {
      warnings.push(
        `Segment "${p1.name || 'P1'}" to "${p2.name || 'P2'}" contains peak slope ${Math.round(
          segMaxSlope
        )}°, exceeding max configured constraint of ${constraints.maxSlopeDegrees}°.`
      );
    }
  }

  const availableEvaTimeMin = (constraints.maxEvaHours - constraints.reserveEvaHours) * 60;
  const evaBudgetUsedPct = Math.round((totalTimeMin / availableEvaTimeMin) * 100);
  const returnMarginMin = Math.round((constraints.maxEvaHours * 60) - totalTimeMin * 2);

  if (totalTimeMin > availableEvaTimeMin) {
    warnings.push(
      `Estimated route time (${Math.round(
        totalTimeMin
      )} min) exceeds available EVA budget (${Math.round(
        availableEvaTimeMin
      )} min excluding ${constraints.reserveEvaHours}h reserve buffer).`
    );
  }

  if (returnMarginMin < constraints.reserveEvaHours * 60) {
    warnings.push(
      `Return margin (${returnMarginMin} min) is below required safety reserve buffer (${constraints.reserveEvaHours * 60} min).`
    );
  }

  const grandTotalDist = Math.max(1, flatDist + modDist + steepDist + hazDist);
  const terrainSummary: TerrainSummary = {
    flat_pct: Math.round((flatDist / grandTotalDist) * 100),
    moderate_pct: Math.round((modDist / grandTotalDist) * 100),
    steep_pct: Math.round((steepDist / grandTotalDist) * 100),
    hazardous_pct: Math.round((hazDist / grandTotalDist) * 100),
  };

  let status: RouteResponse['status'] = 'calculated';
  if (warnings.some((w) => w.includes('exceeds available EVA'))) {
    status = 'unreachable';
  } else if (warnings.length > 0) {
    status = 'warning';
  }

  return {
    route_id: `marga_route_${Date.now().toString().slice(-6)}`,
    distance_m: Math.round(totalDistanceM),
    distance_3d_m: Math.round(totalDistance3DM),
    elevation_gain_m: Math.round(elevationGainM),
    elevation_loss_m: Math.round(elevationLossM),
    estimated_time_min: Math.round(totalTimeMin),
    eva_budget_used_percent: evaBudgetUsedPct,
    return_margin_min: returnMarginMin,
    coordinates: fullCoordinates,
    elevation_profile: elevationProfile,
    segments,
    status,
    warnings,
    terrain_summary: terrainSummary,
  };
}

/**
 * Finds target by ID from mock data
 */
export function getTargetById(id: string) {
  return MOCK_SCIENCE_TARGETS.find((t) => t.id === id);
}
