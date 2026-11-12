import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ScienceTarget, ScientificObjective, LocationPoint } from '@shared/types';
import type {
  EngineElevationPoint,
  EngineMissionConstraints,
  EngineRouteRequest,
  EngineRouteResponse,
} from '@shared/types/engine';
import { MOCK_SCIENCE_TARGETS, MOCK_SCIENTIFIC_OBJECTIVES, GALE_CRATER_METADATA } from './services/mockData';
import { calculateRoute } from './services/routeService';
import { Header } from './components/Header';
import { Section } from './components/Section';
import { MissionSelectionPanel } from './components/MissionSelectionPanel';
import { RouteEndpointsPanel } from './components/RouteEndpointsPanel';
import { TargetSelectionPanel } from './components/TargetSelectionPanel';
import { MissionConstraintsPanel } from './components/MissionConstraintsPanel';
import { MapLayerControls } from './components/MapLayerControls';
import { SolTimelineSlider } from './components/SolTimelineSlider';
import { Inspector, type InspectorTab } from './components/Inspector';
import { RouteProfile } from './components/RouteProfile';
import { DataProvenanceFooter } from './components/DataProvenanceFooter';
import { MarsMap, type BasemapStyle, type CursorInfo, type MapOverlays, type TerrainInfo } from './map/MarsMap';
import type { GisLayerManifest } from './map/demLayer';

const DEFAULT_CONSTRAINTS: EngineMissionConstraints = {
  walkingSpeedKmh: 1.2,
  maxSlopeDegrees: 15,
  maxEvaHours: 8.0,
  reserveEvaHours: 1.5,
  maxDistanceMeters: 10000,
  scienceTimeMinPerStop: 30,
};

const DEFAULT_OVERLAYS: MapOverlays = {
  hazard: true,
  returnRoute: true,
  alternatives: false,
  targets: true,
  slope: false,
  roughness: false,
  vectors: {},
  rasterOpacity: 0.7,
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

  const [currentRoute, setCurrentRoute] = useState<EngineRouteResponse | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null);

  // Layout and display state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('route');
  const [basemap, setBasemap] = useState<BasemapStyle>('relief');
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);
  const [highlight, setHighlight] = useState<[number, number] | null>(null);
  const [terrainInfo, setTerrainInfo] = useState<TerrainInfo | null>(null);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [gis, setGis] = useState<GisLayerManifest | null>(null);

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

  const handleSetAsDestination = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setDestinationPoint(toPoint(target));
  };

  const handleSetAsStart = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setStartPoint(toPoint(target));
  };

  const handleInspectTarget = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setInspectorTab('target');
    setRightOpen(true);
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
    [startPoint, destinationPoint, constraints, objective]
  );

  // Re-plan automatically whenever the start, destination, constraints or objective change (and on load).
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
    setCurrentRoute(null);
    setSelectedObjectiveId(null);
    setCurrentSol(MAX_SOL);
  };

  const handleProfileHover = useCallback((p: EngineElevationPoint | null) => setHighlight(p ? p.coordinate : null), []);
  const handleTerrainInfo = useCallback((info: TerrainInfo | null, error: string | null) => {
    setTerrainInfo(info);
    setTerrainError(error);
  }, []);

  const handleGisInfo = useCallback((manifest: GisLayerManifest | null) => setGis(manifest), []);

  const destinationTarget = destinationPoint
    ? visibleTargets.find((t) => t.name === destinationPoint.name) || null
    : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Header
        regionName={GALE_CRATER_METADATA.name}
        objectiveTitle={objective?.title ?? null}
        terrain={terrainInfo}
        terrainError={terrainError}
        onReset={handleReset}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={() => setRightOpen(!rightOpen)}
      />

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-line bg-panel" aria-label="Mission">
            <Section title="Science objective">
              <MissionSelectionPanel
                objectives={MOCK_SCIENTIFIC_OBJECTIVES}
                selectedObjectiveId={selectedObjectiveId}
                onSelectObjective={handleSelectObjective}
              />
            </Section>
            <Section title="Route">
              <RouteEndpointsPanel
                start={startPoint}
                destination={destinationPoint}
                isCalculating={isCalculating}
                onRecalculate={() => void runRoute(true)}
              />
            </Section>
            <Section
              title="Targets"
              aside={<span className="num text-[11px] text-faint">{visibleTargets.length}/{targets.length}</span>}
            >
              <div className="space-y-3">
                <SolTimelineSlider
                  currentSol={currentSol}
                  onSolChange={setCurrentSol}
                  minSol={0}
                  maxSol={MAX_SOL}
                  caption={`${visibleTargets.length} of ${targets.length} targets`}
                />
                <TargetSelectionPanel
                  targets={visibleTargets}
                  selectedTarget={selectedTarget}
                  onSelectTarget={setSelectedTarget}
                  destinationPoint={destinationTarget}
                  onSetAsDestination={handleSetAsDestination}
                  onInspect={handleInspectTarget}
                />
              </div>
            </Section>
            <Section title="Constraints">
              <MissionConstraintsPanel constraints={constraints} onChangeConstraints={setConstraints} />
            </Section>
            <Section title="Map layers">
              <MapLayerControls
                basemap={basemap}
                onBasemapChange={setBasemap}
                overlays={overlays}
                onOverlaysChange={setOverlays}
                maxSlopeDeg={constraints.maxSlopeDegrees}
                gis={gis}
              />
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
              onSetStartPoint={setStartPoint}
              onSetDestinationPoint={setDestinationPoint}
              route={currentRoute}
              isCalculating={isCalculating}
              maxSlopeDeg={constraints.maxSlopeDegrees}
              basemap={basemap}
              overlays={overlays}
              highlight={highlight}
              showRouteSummary={!rightOpen}
              onCursorMove={setCursorInfo}
              onTerrainInfo={handleTerrainInfo}
              onGisInfo={handleGisInfo}
            />
          </div>
          <RouteProfile
            route={currentRoute}
            open={profileOpen}
            onToggle={() => setProfileOpen(!profileOpen)}
            onHover={handleProfileHover}
          />
        </main>

        {rightOpen && (
          <aside className="w-[340px] shrink-0 border-l border-line bg-panel" aria-label="Inspector">
            <Inspector
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              route={currentRoute}
              isCalculating={isCalculating}
              terrain={terrainInfo}
              gis={gis}
              engineMode={ENGINE_MODE}
              target={selectedTarget}
              targetIsDestination={samePlace(destinationPoint, selectedTarget)}
              targetIsStart={samePlace(startPoint, selectedTarget)}
              onSetDestination={handleSetAsDestination}
              onSetStart={handleSetAsStart}
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
