import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ScienceTarget, ScientificObjective, LocationPoint } from '@shared/types';
import type {
  EngineElevationPoint,
  EngineMissionConstraints,
  EngineRouteRequest,
  EngineRouteResponse,
  RouteMetric,
} from '@shared/types/engine';
import { MOCK_SCIENCE_TARGETS, MOCK_SCIENTIFIC_OBJECTIVES, GALE_CRATER_METADATA } from './services/mockData';
import { calculateRoute } from './services/routeService';
import { Header } from './components/Header';
import { Section } from './components/Section';
import { MissionSelectionPanel } from './components/MissionSelectionPanel';
import { RoutePlanningPanel, type PlannedStop } from './components/RoutePlanningPanel';
import { RouteSummary } from './components/RouteSummary';
import { MapLayerControls } from './components/MapLayerControls';
import { Inspector, type InspectorTab } from './components/Inspector';
import { RouteDetailsPanel } from './components/RouteDetailsPanel';
import { EVAAssessment } from './components/EVAAssessment';
import { ContextPanel } from './components/ContextPanel';
import { CataloguePanel } from './components/CataloguePanel';
import { StatusIcon } from './components/StatusBadge';
import { routeFeasibility } from './components/feasibility';
import { useCrewNotes } from './state/notes';
import { RouteProfile } from './components/RouteProfile';
import { DataProvenanceFooter } from './components/DataProvenanceFooter';
import { useHighContrast } from './state/storage';
import { MarsMap, type CursorInfo, type RoverLook, type TerrainInfo } from './map/MarsMap';
import { RoverView } from './components/RoverView';
import { NearbySurfaceData } from './components/NearbySurfaceData';
import { useSurfaceData } from './state/surfaceData';
import type { CheminSample } from './services/minerals';
import type { RoverView as RoverViewData } from './services/roverViews';
import { DEFAULT_MAP_LAYERS, type MapLayers } from './map/layers';
import type { GisLayerManifest } from './map/demLayer';

const DEFAULT_CONSTRAINTS: EngineMissionConstraints = {
  walkingSpeedKmh: 1.2,
  maxSlopeDegrees: 15,
  maxEvaHours: 8.0,
  reserveEvaHours: 1.5,
  maxDistanceMeters: 10000,
  scienceTimeMinPerStop: 30,
};

/** End of the Sol timeline: the latest sol any catalogue target was reached, rounded up to 100. */
const MAX_SOL =
  Math.ceil(Math.max(3200, ...MOCK_SCIENCE_TARGETS.map((t) => t.sol_discovered ?? 0)) / 100) * 100;

/** Wait this long after the last change to start, destination or constraints before re-routing. */
const AUTO_ROUTE_DELAY_MS = 250;

/** Which engine answers route requests (routeService.ts decides; this only describes its configuration). */
const ENGINE_MODE = import.meta.env.VITE_ENGINE_API_URL?.trim()
  ? 'Engine service configured, in-browser fallback'
  : 'In-browser engine, offline';

const toPoint = (t: ScienceTarget): LocationPoint => ({ latitude: t.latitude, longitude: t.longitude, name: t.name });
const samePlace = (p: LocationPoint | null, t: ScienceTarget | null) =>
  !!p && !!t && p.latitude === t.latitude && p.longitude === t.longitude;

export const App: React.FC = () => {
  const [targets] = useState<ScienceTarget[]>(MOCK_SCIENCE_TARGETS);
  const [currentSol, setCurrentSol] = useState<number>(MAX_SOL);
  const [selectedTarget, setSelectedTarget] = useState<ScienceTarget | null>(MOCK_SCIENCE_TARGETS[1]);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);

  // Default start: Bradbury Landing; default destination: Yellowknife Bay
  const [startPoint, setStartPoint] = useState<LocationPoint>(toPoint(MOCK_SCIENCE_TARGETS[0]));
  const [destinationPoint, setDestinationPoint] = useState<LocationPoint | null>(toPoint(MOCK_SCIENCE_TARGETS[1]));
  const [constraints, setConstraints] = useState<EngineMissionConstraints>(DEFAULT_CONSTRAINTS);
  // Science stops between start and destination (engine request: waypoints), and how the engine
  // chooses the route (engine request: options.metric). Defaults send exactly the earlier request.
  const [stops, setStops] = useState<PlannedStop[]>([]);
  const [routeMetric, setRouteMetric] = useState<RouteMetric>('terrain');
  const stopPoints = useMemo(() => stops.map((s) => s.point), [stops]);

  const [currentRoute, setCurrentRoute] = useState<EngineRouteResponse | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null);

  // Layout and display state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('route');
  const [mapLayers, setMapLayers] = useState<MapLayers>(DEFAULT_MAP_LAYERS);
  const [highlight, setHighlight] = useState<[number, number] | null>(null);
  // Map <-> profile link: the profile point under the map pointer, and a point picked on the profile.
  const [profileIndex, setProfileIndex] = useState<number | null>(null);
  const [mapFocus, setMapFocus] = useState<{ coordinate: [number, number]; seq: number } | null>(null);
  const [terrainInfo, setTerrainInfo] = useState<TerrainInfo | null>(null);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [gis, setGis] = useState<GisLayerManifest | null>(null);
  const [highContrast, setHighContrast] = useHighContrast();
  const crew = useCrewNotes();
  // Bumped to make the Catalogue open the selected target's record.
  const [catalogueFocus, setCatalogueFocus] = useState(0);

  // Curiosity surface data: CheMin mineralogy (Catalogue → Minerals) and Navcam rover views.
  const surface = useSurfaceData();
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [mineralFocus, setMineralFocus] = useState(0);
  const [openViewId, setOpenViewId] = useState<string | null>(null);
  const [roverHeading, setRoverHeading] = useState<{ heading: number; fov: number }>({ heading: 180, fov: 90 });
  const [roverInset, setRoverInset] = useState<[number, number] | null>(null);
  const roverViews = useMemo(() => surface.rover?.views ?? [], [surface.rover]);
  const cheminSamples = useMemo(() => surface.chemin?.samples ?? [], [surface.chemin]);
  const openView = roverViews.find((v) => v.id === openViewId) ?? null;
  const roverLook = useMemo<RoverLook | null>(
    () => (openView ? { view: openView, headingDeg: roverHeading.heading, fovDeg: roverHeading.fov, insetCentre: roverInset } : null),
    [openView, roverHeading, roverInset],
  );
  const handleOpenRoverView = useCallback((v: RoverViewData) => setOpenViewId(v.id), []);
  const handleCloseRoverView = useCallback(() => setOpenViewId(null), []);
  const handleRoverLook = useCallback((heading: number, fov: number) => setRoverHeading({ heading, fov }), []);
  const handleRoverInset = useCallback((c: [number, number] | null) => setRoverInset(c), []);
  const handleSelectSample = useCallback((sm: CheminSample) => {
    setSelectedSampleId(sm.id);
    setInspectorTab('catalogue');
    setRightOpen(true);
    setMineralFocus((n) => n + 1);
  }, []);
  const handleShowSampleOnMap = useCallback((sm: CheminSample) => {
    if (sm.lat === null || sm.lon === null) return;
    const coordinate: [number, number] = [sm.lon, sm.lat];
    setMapFocus((prev) => ({ coordinate, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Targets reached by the chosen sol (memoised so cursor re-renders don't rebuild the map layer)
  const visibleTargets = useMemo(
    () => targets.filter((t) => (t.sol_discovered ?? 0) <= currentSol),
    [targets, currentSol]
  );
  const objective = MOCK_SCIENTIFIC_OBJECTIVES.find((o) => o.id === selectedObjectiveId) ?? null;

  const handleSelectObjective = (obj: ScientificObjective | null) => {
    setSelectedObjectiveId(obj ? obj.id : null);
    if (obj && obj.primary_target_ids.length > 0) {
      const targetMatch = targets.find((t) => t.id === obj.primary_target_ids[0]);
      if (targetMatch) {
        setSelectedTarget(targetMatch);
        setDestinationPoint(toPoint(targetMatch));
      }
    }
  };

  // A target can be the start, a stop or the destination, never two of them at once.
  const withoutStop = (target: ScienceTarget) => setStops((prev) => prev.filter((s) => s.targetId !== target.id));

  const handleSetAsDestination = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setDestinationPoint(toPoint(target));
    withoutStop(target);
  };

  const handleSetAsStart = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setStartPoint(toPoint(target));
    withoutStop(target);
  };

  const handleAddStop = (target: ScienceTarget) =>
    setStops((prev) =>
      prev.some((s) => s.targetId === target.id) || prev.length >= 25 ? prev : [...prev, { point: toPoint(target), targetId: target.id }],
    );
  const handleMoveStop = (index: number, delta: -1 | 1) =>
    setStops((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  const handleRemoveStop = (index: number) => setStops((prev) => prev.filter((_, k) => k !== index));

  const handleInspectTarget = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setInspectorTab('catalogue');
    setRightOpen(true);
    setCatalogueFocus((n) => n + 1);
  };

  // Run the route request. Only the newest request may update the UI, so a slow, stale result can
  // never overwrite a newer one. The response is displayed as the engine returned it.
  const routeRequestSeq = useRef(0);
  const runRoute = useCallback(
    async (showRouteTab = false) => {
      const seq = ++routeRequestSeq.current;
      if (!destinationPoint) {
        setCurrentRoute(null);
        setIsCalculating(false);
        return;
      }
      setIsCalculating(true);
      try {
        const request: EngineRouteRequest = {
          start: startPoint,
          destination: destinationPoint,
          constraints,
          ...(stopPoints.length ? { waypoints: stopPoints } : {}),
          ...(routeMetric !== 'terrain' ? { options: { metric: routeMetric } } : {}),
          ...(objective ? { objective: { id: objective.id, title: objective.title } } : {}),
        };
        const res = (await calculateRoute(request)) as EngineRouteResponse;
        if (seq !== routeRequestSeq.current) return;
        setCurrentRoute(res);
        if (showRouteTab) {
          setInspectorTab('route');
          setRightOpen(true);
        }
      } catch (err) {
        if (seq !== routeRequestSeq.current) return;
        console.error('Route computation failed:', err);
        setCurrentRoute(null);
      } finally {
        if (seq === routeRequestSeq.current) setIsCalculating(false);
      }
    },
    [startPoint, destinationPoint, constraints, objective, stopPoints, routeMetric]
  );

  // Re-plan automatically whenever the start, stops, destination, route choice, constraints or objective change (and on load).
  useEffect(() => {
    const timer = setTimeout(() => {
      void runRoute();
    }, AUTO_ROUTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runRoute]);

  const handleReset = () => {
    setSelectedTarget(MOCK_SCIENCE_TARGETS[1]);
    setStartPoint(toPoint(MOCK_SCIENCE_TARGETS[0]));
    setDestinationPoint(toPoint(MOCK_SCIENCE_TARGETS[1]));
    setConstraints(DEFAULT_CONSTRAINTS);
    setStops([]);
    setRouteMetric('terrain');
    setCurrentRoute(null);
    setSelectedObjectiveId(null);
    setCurrentSol(MAX_SOL);
  };

  const handleProfileHover = useCallback((p: EngineElevationPoint | null) => setHighlight(p ? p.coordinate : null), []);
  const handleProfileSelect = useCallback(
    (p: EngineElevationPoint) => setMapFocus((prev) => ({ coordinate: p.coordinate, seq: (prev?.seq ?? 0) + 1 })),
    [],
  );
  // The map pointer over the route: show that point on the profile and mark it on the map.
  const routeRef = useRef<EngineRouteResponse | null>(null);
  routeRef.current = currentRoute;
  const handleRouteHover = useCallback((index: number | null) => {
    setProfileIndex(index);
    const p = index !== null ? routeRef.current?.elevation_profile?.[index] : null;
    setHighlight(p ? p.coordinate : null);
  }, []);
  const handleTerrainInfo = useCallback((info: TerrainInfo | null, error: string | null) => {
    setTerrainInfo(info);
    setTerrainError(error);
  }, []);

  const handleGisInfo = useCallback((manifest: GisLayerManifest | null) => setGis(manifest), []);

  const destinationTarget = destinationPoint
    ? visibleTargets.find((t) => t.name === destinationPoint.name) || null
    : null;
  const targetAt = (p: LocationPoint | null) => (p ? targets.find((t) => samePlace(p, t)) ?? null : null);
  const planInProgress = !!currentRoute && currentRoute.coordinates.length > 1;
  const stopTargetIds = stops.flatMap((s) => (s.targetId ? [s.targetId] : []));
  const feasibility = routeFeasibility(currentRoute);
  const evaStatus = currentRoute?.eva_assessment?.status;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Header
        regionName={GALE_CRATER_METADATA.name}
        terrain={terrainInfo}
        terrainError={terrainError}
        highContrast={highContrast}
        onToggleHighContrast={() => setHighContrast(!highContrast)}
        onReset={handleReset}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={() => setRightOpen(!rightOpen)}
      />

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-line bg-panel" aria-label="Planning and navigation">
            <Section title="Map layers">
              <MapLayerControls layers={mapLayers} onChange={setMapLayers} maxSlopeDeg={constraints.maxSlopeDegrees} gis={gis} />
            </Section>
            <Section title="Science objectives">
              <MissionSelectionPanel
                objectives={MOCK_SCIENTIFIC_OBJECTIVES}
                targets={targets}
                activeObjectiveId={selectedObjectiveId}
                planInProgress={planInProgress}
                onActivate={handleSelectObjective}
                destinationTargetId={targetAt(destinationPoint)?.id ?? null}
                startTargetId={targetAt(startPoint)?.id ?? null}
                stopTargetIds={stopTargetIds}
                onSetDestination={handleSetAsDestination}
                onAddStop={handleAddStop}
                onInspect={handleInspectTarget}
              />
            </Section>
            <Section title="Route planning">
              <RoutePlanningPanel
                start={startPoint}
                destination={destinationPoint}
                stops={stops}
                selectedTarget={selectedTarget}
                onAddStop={handleAddStop}
                onMoveStop={handleMoveStop}
                onRemoveStop={handleRemoveStop}
                metric={routeMetric}
                onMetricChange={setRouteMetric}
                route={currentRoute}
                isCalculating={isCalculating}
                onRecalculate={() => void runRoute(true)}
                constraints={constraints}
                onChangeConstraints={setConstraints}
              />
            </Section>
            <Section title="Route summary">
              <RouteSummary route={currentRoute} isCalculating={isCalculating} />
            </Section>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <MarsMap
              targets={visibleTargets}
              selectedTarget={selectedTarget}
              onSelectTarget={handleSetAsDestination}
              startPoint={startPoint}
              destinationPoint={destinationPoint}
              stops={stopPoints}
              onSetStartPoint={setStartPoint}
              onSetDestinationPoint={setDestinationPoint}
              route={currentRoute}
              isCalculating={isCalculating}
              maxSlopeDeg={constraints.maxSlopeDegrees}
              layers={mapLayers}
              highlight={highlight}
              onRouteHover={handleRouteHover}
              focus={mapFocus}
              showRouteSummary={!rightOpen}
              onCursorMove={setCursorInfo}
              onTerrainInfo={handleTerrainInfo}
              onGisInfo={handleGisInfo}
              samples={cheminSamples}
              selectedSampleId={selectedSampleId}
              onSelectSample={handleSelectSample}
              roverViews={roverViews}
              onSelectRoverView={handleOpenRoverView}
              roverLook={roverLook}
            />
            {openView && surface.rover && (
              <RoverView
                dataset={surface.rover}
                view={openView}
                onClose={handleCloseRoverView}
                onNavigate={handleOpenRoverView}
                onLook={handleRoverLook}
                onInsetCentre={handleRoverInset}
              />
            )}
          </div>
          <RouteProfile
            route={currentRoute}
            open={profileOpen}
            onToggle={() => setProfileOpen(!profileOpen)}
            onHover={handleProfileHover}
            onSelect={handleProfileSelect}
            externalIndex={profileIndex}
            stopNames={stops.map((s) => s.point.name ?? 'Stop')}
          />
        </main>

        {rightOpen && (
          <aside className="w-[340px] shrink-0 border-l border-line bg-panel" aria-label="Mission operations">
            <Inspector
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              badges={{
                route: feasibility.tone === 'bad' || feasibility.tone === 'warn' ? <StatusIcon tone={feasibility.tone} className={`h-3 w-3 ${feasibility.tone === 'bad' ? 'text-bad' : 'text-warn'}`} /> : null,
                eva: evaStatus === 'exceeded' ? <StatusIcon tone="bad" className="h-3 w-3 text-bad" /> : evaStatus === 'no_slack' ? <StatusIcon tone="warn" className="h-3 w-3 text-warn" /> : null,
              }}
              panels={{
                route: (
                  <>
                    <RouteDetailsPanel
                      route={currentRoute}
                      isCalculating={isCalculating}
                      start={startPoint}
                      destination={destinationPoint}
                      stops={stopPoints}
                    />
                    <NearbySurfaceData
                      route={currentRoute}
                      views={roverViews}
                      samples={cheminSamples}
                      onOpenView={handleOpenRoverView}
                      onOpenSample={handleSelectSample}
                    />
                  </>
                ),
                eva: <EVAAssessment route={currentRoute} />,
                context: <ContextPanel route={currentRoute} terrain={terrainInfo} gis={gis} engineMode={ENGINE_MODE} surface={surface} />,
                catalogue: (
                  <CataloguePanel
                    objectives={MOCK_SCIENTIFIC_OBJECTIVES}
                    activeObjectiveId={selectedObjectiveId}
                    targets={targets}
                    visibleTargets={visibleTargets}
                    currentSol={currentSol}
                    maxSol={MAX_SOL}
                    onSolChange={setCurrentSol}
                    selectedTarget={selectedTarget}
                    onSelectTarget={setSelectedTarget}
                    focusSeq={catalogueFocus}
                    startPoint={startPoint}
                    destinationPoint={destinationPoint}
                    destinationTarget={destinationTarget}
                    stopTargetIds={stopTargetIds}
                    onSetDestination={handleSetAsDestination}
                    onSetStart={handleSetAsStart}
                    onAddStop={handleAddStop}
                    crew={crew}
                    gis={gis}
                    route={currentRoute}
                    chemin={surface.chemin}
                    cheminError={surface.cheminError}
                    selectedSampleId={selectedSampleId}
                    onSelectSample={setSelectedSampleId}
                    mineralFocusSeq={mineralFocus}
                    onShowSampleOnMap={handleShowSampleOnMap}
                    roverViews={roverViews}
                    onOpenRoverView={handleOpenRoverView}
                  />
                ),
              }}
            />
          </aside>
        )}
      </div>

      <DataProvenanceFooter
        cursor={cursorInfo}
        startName={startPoint.name || 'Start'}
        destName={destinationPoint?.name || 'No destination'}
        terrain={terrainInfo}
        engineMode={ENGINE_MODE}
      />
    </div>
  );
};
