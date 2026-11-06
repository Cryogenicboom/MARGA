import React, { useState, useEffect } from 'react';
import {
  ScienceTarget,
  ScientificObjective,
  MissionConstraints,
  RouteResponse,
  LocationPoint,
} from '@shared/types';
import {
  MOCK_SCIENCE_TARGETS,
  MOCK_SCIENTIFIC_OBJECTIVES,
  GALE_CRATER_METADATA,
} from './services/mockData';
import { calculateRoute } from './services/routeService';
import { Header } from './components/Header';
import { MissionSelectionPanel } from './components/MissionSelectionPanel';
import { TargetSelectionPanel } from './components/TargetSelectionPanel';
import { MissionConstraintsPanel } from './components/MissionConstraintsPanel';
import { RouteDetailsPanel } from './components/RouteDetailsPanel';
import { SolTimelineSlider } from './components/SolTimelineSlider';
import { DataProvenanceFooter } from './components/DataProvenanceFooter';
import { MarsMap } from './map/MarsMap';
import { Target, Layers, Sliders, Navigation } from 'lucide-react';

type ActiveTab = 'objectives' | 'targets' | 'constraints' | 'route';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('targets');
  const [targets] = useState<ScienceTarget[]>(MOCK_SCIENCE_TARGETS);
  const [currentSol, setCurrentSol] = useState<number>(3200);

  const [selectedTarget, setSelectedTarget] = useState<ScienceTarget | null>(
    MOCK_SCIENCE_TARGETS[1] // Default: Yellowknife Bay
  );
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);

  // Default Start: Bradbury Landing
  const [startPoint, setStartPoint] = useState<LocationPoint>({
    latitude: MOCK_SCIENCE_TARGETS[0].latitude,
    longitude: MOCK_SCIENCE_TARGETS[0].longitude,
    name: MOCK_SCIENCE_TARGETS[0].name,
  });

  // Default Destination: Yellowknife Bay
  const [destinationPoint, setDestinationPoint] = useState<LocationPoint | null>({
    latitude: MOCK_SCIENCE_TARGETS[1].latitude,
    longitude: MOCK_SCIENCE_TARGETS[1].longitude,
    name: MOCK_SCIENCE_TARGETS[1].name,
  });

  // Mission constraints
  const [constraints, setConstraints] = useState<MissionConstraints>({
    walkingSpeedKmh: 1.2,
    maxSlopeDegrees: 15,
    maxEvaHours: 8.0,
    reserveEvaHours: 1.5,
    maxDistanceMeters: 10000,
  });

  const [currentRoute, setCurrentRoute] = useState<RouteResponse | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);

  // Filter targets based on active Sol Timeline
  const visibleTargets = targets.filter(
    (t) => (t.sol_discovered ?? 0) <= currentSol
  );

  // Handle objective selection
  const handleSelectObjective = (obj: ScientificObjective | null) => {
    setSelectedObjectiveId(obj ? obj.id : null);
    if (obj && obj.primary_target_ids.length > 0) {
      const targetMatch = targets.find((t) => t.id === obj.primary_target_ids[0]);
      if (targetMatch) {
        setSelectedTarget(targetMatch);
        setDestinationPoint({
          latitude: targetMatch.latitude,
          longitude: targetMatch.longitude,
          name: targetMatch.name,
        });
      }
    }
  };

  // Handle setting target as destination
  const handleSetAsDestination = (target: ScienceTarget) => {
    setSelectedTarget(target);
    setDestinationPoint({
      latitude: target.latitude,
      longitude: target.longitude,
      name: target.name,
    });
  };

  // Run route calculation
  const handleComputeRoute = async () => {
    if (!destinationPoint) return;
    setIsCalculating(true);
    try {
      const res = await calculateRoute({
        start: startPoint,
        destination: destinationPoint,
        constraints,
      });
      setCurrentRoute(res);
      setActiveTab('route');
    } catch (err) {
      console.error('Route computation failed:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  // Trigger initial route calculation on load
  useEffect(() => {
    handleComputeRoute();
  }, []);

  const handleReset = () => {
    setSelectedTarget(MOCK_SCIENCE_TARGETS[1]);
    setStartPoint({
      latitude: MOCK_SCIENCE_TARGETS[0].latitude,
      longitude: MOCK_SCIENCE_TARGETS[0].longitude,
      name: MOCK_SCIENCE_TARGETS[0].name,
    });
    setDestinationPoint({
      latitude: MOCK_SCIENCE_TARGETS[1].latitude,
      longitude: MOCK_SCIENCE_TARGETS[1].longitude,
      name: MOCK_SCIENCE_TARGETS[1].name,
    });
    setCurrentRoute(null);
    setSelectedObjectiveId(null);
    setCurrentSol(3200);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#06090e] font-sans antialiased text-slate-100">
      {/* NASA Mission Control Header */}
      <Header
        regionName={GALE_CRATER_METADATA.name}
        onReset={handleReset}
        targetCount={visibleTargets.length}
        hasRoute={!!currentRoute}
      />

      {/* Main Mission Control Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Control Panel */}
        <aside className="w-80 lg:w-96 bg-[#0b0e14]/95 border-r border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl backdrop-blur">
          {/* Section Navigation Tabs */}
          <div className="grid grid-cols-4 bg-[#06090e] border-b border-slate-800 p-1.5 font-mono text-[11px]">
            <button
              onClick={() => setActiveTab('objectives')}
              className={`py-2 px-1 rounded flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
                activeTab === 'objectives'
                  ? 'bg-[#101622] text-[#38bdf8] font-bold border border-[#105bd8]/40 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>GOALS</span>
            </button>

            <button
              onClick={() => setActiveTab('targets')}
              className={`py-2 px-1 rounded flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
                activeTab === 'targets'
                  ? 'bg-[#101622] text-amber-300 font-bold border border-amber-500/40 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Target className="w-4 h-4" />
              <span>TARGETS</span>
            </button>

            <button
              onClick={() => setActiveTab('constraints')}
              className={`py-2 px-1 rounded flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer ${
                activeTab === 'constraints'
                  ? 'bg-[#101622] text-emerald-400 font-bold border border-emerald-500/40 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>PARAMS</span>
            </button>

            <button
              onClick={() => setActiveTab('route')}
              className={`py-2 px-1 rounded flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer relative ${
                activeTab === 'route'
                  ? 'bg-[#101622] text-cyan-300 font-bold border border-cyan-500/40 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Navigation className="w-4 h-4" />
              <span>ROUTE</span>
              {currentRoute && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              )}
            </button>
          </div>

          {/* Active Control Panel View */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'objectives' && (
              <MissionSelectionPanel
                objectives={MOCK_SCIENTIFIC_OBJECTIVES}
                selectedObjectiveId={selectedObjectiveId}
                onSelectObjective={handleSelectObjective}
              />
            )}

            {activeTab === 'targets' && (
              <TargetSelectionPanel
                targets={visibleTargets}
                selectedTarget={selectedTarget}
                onSelectTarget={(t) => setSelectedTarget(t)}
                destinationPoint={
                  destinationPoint
                    ? visibleTargets.find((t) => t.name === destinationPoint.name) || null
                    : null
                }
                onSetAsDestination={handleSetAsDestination}
              />
            )}

            {activeTab === 'constraints' && (
              <MissionConstraintsPanel
                constraints={constraints}
                onChangeConstraints={(c) => setConstraints(c)}
              />
            )}

            {activeTab === 'route' && (
              <RouteDetailsPanel
                route={currentRoute}
                onCalculateRoute={handleComputeRoute}
                isCalculating={isCalculating}
              />
            )}
          </div>
        </aside>

        {/* Central Spatial Map Display */}
        <main className="flex-1 relative overflow-hidden bg-[#06090e] flex flex-col">
          <div className="flex-1 relative">
            <MarsMap
              targets={visibleTargets}
              selectedTarget={selectedTarget}
              onSelectTarget={(t) => {
                setSelectedTarget(t);
                if (t) handleSetAsDestination(t);
              }}
              startPoint={startPoint}
              destinationPoint={destinationPoint}
              onSetStartPoint={(pt) => setStartPoint(pt)}
              onSetDestinationPoint={(pt) => setDestinationPoint(pt)}
              currentRoute={currentRoute}
              onCursorMove={(c) => setCursorCoords(c)}
            />
          </div>

          {/* NASA Sol Timeline Controller */}
          <SolTimelineSlider
            currentSol={currentSol}
            onSolChange={(s) => setCurrentSol(s)}
            minSol={0}
            maxSol={3200}
          />
        </main>
      </div>

      {/* NASA Horizon Telemetry Footer */}
      <DataProvenanceFooter
        cursorCoords={cursorCoords}
        startName={startPoint.name || 'Start Location'}
        destName={destinationPoint?.name || 'Destination Target'}
      />
    </div>
  );
};
