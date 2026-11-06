# MARGA — Architecture & System Design Document

## 1. Overview
MARGA (Mars Adaptive Route Guidance Architecture) is a lightweight, offline-first decision-support application built to assist astronaut excursion planning in the **Gale Crater / Mount Sharp** region of Mars.

This document details the common frontend architecture, OpenLayers spatial map rendering, shared data contracts, and integration bridges established by **Person 1 (Application Architect & Frontend Lead)**.

---

## 2. Team Module Boundaries

```
                         MARGA APPLICATION
                                 │
           ┌─────────────────────┴─────────────────────┐
           │                                           │
      FRONTEND UI                                CORE ENGINE
   (Person 1 Lead)                            (Person 2 Lead)
           │                                           │
   ┌───────┴────────┐                         ┌────────┴────────┐
   │ React + TS UI  │                         │ A* Route Engine │
   │ OpenLayers Map │                         │ Slope / Cost    │
   │ Controls Panel │                         │ EVA Safety      │
   └───────┬────────┘                         └────────┬────────┘
           │                                           │
           └─────────────────────┬─────────────────────┘
                                 │
                        Shared Data Contracts
                       (shared/types/index.ts)
                                 │
           ┌─────────────────────┴─────────────────────┐
           │                                           │
      NASA CATALOGUE                               TEST SUITE
   (Person 3 Lead)                            (Person 4 Lead)
```

### Module Isolation Guidelines
- **Frontend UI (Person 1)** operates independently using shared TypeScript contracts (`shared/types/index.ts`) and mock services (`frontend/src/services/mockData.ts` & `routeService.ts`).
- **Core Engine (Person 2)** implements deterministic A* routing algorithms in Python/TypeScript without depending on React or OpenLayers.
- **Science Data (Person 3)** produces verified NASA GeoJSON catalogues matching `ScienceTarget` schema without touching UI styling.
- **Testing & Validation (Person 4)** maintains test cases and synthetic terrain rasters to validate both engine and frontend.

---

## 3. Frontend Architecture (Person 1)

The frontend is constructed with **React 18**, **TypeScript**, **OpenLayers 9**, and **Tailwind CSS**.

### Key Components

| Component | Path | Responsibility |
| :--- | :--- | :--- |
| `App.tsx` | `frontend/src/App.tsx` | Main application shell, state hub, tab coordinator |
| `Header.tsx` | `frontend/src/components/Header.tsx` | Branding, region info, system status, reset action |
| `MarsMap.tsx` | `frontend/src/map/MarsMap.tsx` | OpenLayers map renderer, EPSG:4326 Equirectangular CRS, vector layers |
| `mapStyles.ts` | `frontend/src/map/mapStyles.ts` | Target category pins, route glow polylines, start/destination markers |
| `MissionSelectionPanel.tsx` | `frontend/src/components/MissionSelectionPanel.tsx` | Select primary scientific goals (Hydration, Mineralogy, Sedimentary, Basement) |
| `TargetSelectionPanel.tsx` | `frontend/src/components/TargetSelectionPanel.tsx` | Filterable science target list, detail drawer, provenance metadata |
| `MissionConstraintsPanel.tsx` | `frontend/src/components/MissionConstraintsPanel.tsx` | Mobility controls: walking speed, max slope limit, EVA budget, safety buffer |
| `RouteDetailsPanel.tsx` | `frontend/src/components/RouteDetailsPanel.tsx` | Distance/time stats, slope breakdown, segment table, warnings, GeoJSON export |
| `DataProvenanceFooter.tsx` | `frontend/src/components/DataProvenanceFooter.tsx` | Real-time map cursor lat/lon, datum display, data provenance disclaimers |

---

## 4. Shared Data Contracts (`shared/types/index.ts`)

### `ScienceTarget`
```typescript
export interface ScienceTarget {
  id: string;
  name: string;
  category: 'mineralogical' | 'sedimentary' | 'hydration' | 'radiation' | 'geological';
  latitude: number;       // Planetocentric Latitude (-90 to +90)
  longitude: number;      // East Longitude (0 to 360, Gale Crater ~ 137.4°E)
  elevation_m: number;    // Elevation in meters relative to Mars MOLA datum
  source: string;         // Mission source e.g. "MSL Curiosity / NASA PDS"
  instrument: string;     // Instrument name e.g. "ChemCam", "APXS", "CRISM"
  product_id?: string;    // NASA Product ID if available
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  description: string;
  scientific_significance: string;
  data_limitations: string;
  sol_discovered?: number;
}
```

### `RouteRequest` & `RouteResponse`
```typescript
export interface RouteRequest {
  route_id?: string;
  start: LocationPoint;
  destination: LocationPoint;
  waypoints?: LocationPoint[];
  constraints: MissionConstraints;
}

export interface RouteResponse {
  route_id: string;
  distance_m: number;
  estimated_time_min: number;
  eva_budget_used_percent: number;
  return_margin_min: number;
  coordinates: Array<[number, number]>; // [longitude, latitude]
  elevation_profile: ElevationPoint[];
  segments: RouteSegment[];
  status: 'calculated' | 'unreachable' | 'warning' | 'failed';
  warnings: string[];
  terrain_summary: TerrainSummary;
}
```

---

## 5. Offline Capabilities & Mock Engine
The frontend includes a fully functional client-side route planner (`frontend/src/services/routeService.ts`) operating deterministically. This guarantees that frontend UI development, visual demonstration, and usability testing can proceed even when Person 2's core engine or external APIs are disconnected.
