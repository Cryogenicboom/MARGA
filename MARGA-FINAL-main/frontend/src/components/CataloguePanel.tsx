import React, { useEffect, useState } from 'react';
import type { LocationPoint, ScienceTarget, ScientificObjective } from '@shared/types';
import type { EngineRouteResponse } from '@shared/types/engine';
import { ArrowLeft, Camera, Lock } from 'lucide-react';
import { EmptyNote, SubHeading } from './Section';
import { TargetSelectionPanel } from './TargetSelectionPanel';
import { SolTimelineSlider } from './SolTimelineSlider';
import { TargetInspector } from './TargetInspector';
import { NoteComposer, NoteItem, NotesPanel, type CrewNotesApi } from './NotesPanel';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../map/mapStyles';
import type { GisLayerManifest } from '../map/demLayer';
import { imageryIds } from '../map/gisLayers';
import { MineralsPanel, TargetMineralogy } from './MineralsPanel';
import type { CheminDataset, CheminSample } from '../services/minerals';
import { nearestView, solLabel, type RoverView } from '../services/roverViews';
import { fmtDistance } from './format';

type View = 'objectives' | 'targets' | 'minerals' | 'references' | 'notes';
const VIEWS: Array<[View, string]> = [
  ['objectives', 'Objectives'],
  ['targets', 'Targets'],
  ['minerals', 'Minerals'],
  ['references', 'Sources'],
  ['notes', 'Crew notes'],
];

interface CataloguePanelProps {
  objectives: ScientificObjective[];
  activeObjectiveId: string | null;
  targets: ScienceTarget[];
  /** Targets reached by the chosen sol. */
  visibleTargets: ScienceTarget[];
  currentSol: number;
  maxSol: number;
  onSolChange: (sol: number) => void;
  selectedTarget: ScienceTarget | null;
  onSelectTarget: (t: ScienceTarget) => void;
  /** Bumped when another panel asks to show the selected target's record. */
  focusSeq: number;
  startPoint: LocationPoint;
  destinationPoint: LocationPoint | null;
  destinationTarget: ScienceTarget | null;
  stopTargetIds: string[];
  onSetDestination: (t: ScienceTarget) => void;
  onSetStart: (t: ScienceTarget) => void;
  onAddStop: (t: ScienceTarget) => void;
  crew: CrewNotesApi;
  gis: GisLayerManifest | null;
  route: EngineRouteResponse | null;
  /** CheMin mineralogy (NASA PDS) and the selected sample record. */
  chemin: CheminDataset | null;
  cheminError: string | null;
  selectedSampleId: string | null;
  onSelectSample: (id: string | null) => void;
  /** Bumped when another panel asks to show the selected sample's record. */
  mineralFocusSeq: number;
  onShowSampleOnMap: (s: CheminSample) => void;
  /** Navcam rover views, to offer the nearest one from target and sample records. */
  roverViews: RoverView[];
  onOpenRoverView: (v: RoverView) => void;
}

/** A rover view counts as "at" a place within this distance. */
const VIEW_NEAR_M = 150;

const samePlace = (p: LocationPoint | null, t: ScienceTarget | null) => !!p && !!t && p.latitude === t.latitude && p.longitude === t.longitude;

const ExtLink: React.FC<{ href: string | null | undefined; children: React.ReactNode }> = ({ href, children }) =>
  href && /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );

/** NASA data products and observation references behind the map, the routing and the target records. */
const References: React.FC<{
  targets: ScienceTarget[];
  gis: GisLayerManifest | null;
  route: EngineRouteResponse | null;
  chemin: CheminDataset | null;
  roverCount: number;
}> = ({ targets, gis, route, chemin, roverCount }) => {
  const src = route?.terrain_source;
  const rad = route?.radiation?.full_eva_duration?.reference;
  return (
    <div>
      <p className="text-[11px] text-faint">Sources as recorded with the data. Links open the provider's page and need a network connection.</p>

      <SubHeading>Data products in use</SubHeading>
      <ul className="space-y-1.5 text-[12px]">
        <li>
          <span className="text-fg">Elevation model:</span>{' '}
          {gis?.dataset?.name ?? src?.label ?? 'Not loaded'}
          {(gis?.dataset?.source ?? src?.source) && (
            <>
              {' '}
              <ExtLink href={gis?.dataset?.source ?? src?.source}>request</ExtLink>
            </>
          )}
        </li>
        {imageryIds(gis).map((id) => {
          const e = gis!.imagery![id];
          return (
            <li key={id}>
              <span className="text-fg">{e.title}:</span> {e.catalogue_title ?? e.product_label} ({e.instrument}, {e.resolution_m} m), Mars Trek{' '}
              {e.source.service}
            </li>
          );
        })}
        {Object.entries(gis?.vectors ?? {}).map(([id, e]) => (
          <li key={id}>
            <span className="text-fg">{e.title}:</span> <ExtLink href={e.source}>Mars Trek service</ExtLink>
            {e.copyright && <span className="block text-[11px] text-faint">{e.copyright}</span>}
          </li>
        ))}
        {chemin && (
          <li>
            <span className="text-fg">Mineralogy:</span> {chemin.source.citation}{' '}
            <ExtLink href={chemin.source.archive_page}>PDS Geosciences Node</ExtLink>
            <span className="block text-[11px] text-faint">
              {chemin.samples.length} sampling sites; positions from NASA MSL rover localisation.
            </span>
          </li>
        )}
        {roverCount > 0 && (
          <li>
            <span className="text-fg">Rover views:</span> Curiosity Navcam raw frames (NASA/JPL-Caltech), {roverCount} stops,{' '}
            <ExtLink href="https://mars.nasa.gov/msl/multimedia/raw-images/">MSL raw images</ExtLink>
          </li>
        )}
        {rad && (
          <li>
            <span className="text-fg">Radiation reference:</span> {rad.mission} {rad.instrument}, {rad.measurement_period}.{' '}
            <ExtLink href={rad.source_url}>source</ExtLink>
          </li>
        )}
      </ul>

      <SubHeading>Target observation references</SubHeading>
      <ul className="space-y-1.5 text-[12px]">
        {targets.map((t) => (
          <li key={t.id}>
            <span className="text-fg">{t.name}:</span> {t.source}; {t.instrument}
            {t.product_id && <span className="num block text-[11px] text-muted">{t.product_id}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-faint">Product references have not been checked against the NASA archive.</p>
    </div>
  );
};

/**
 * CATALOGUE tab: the mission information workspace. Pre-mission objectives and the target catalogue
 * (read-only, from NASA mission sources) are kept visibly apart from crew notes and observations.
 */
export const CataloguePanel: React.FC<CataloguePanelProps> = (p) => {
  const [view, setView] = useState<View>('targets');
  const [detail, setDetail] = useState(false);

  useEffect(() => {
    if (p.focusSeq > 0) {
      setView('targets');
      setDetail(true);
    }
  }, [p.focusSeq]);
  useEffect(() => {
    if (p.mineralFocusSeq > 0) setView('minerals');
  }, [p.mineralFocusSeq]);

  const viewNear = (lat: number | null, lon: number | null) =>
    lat === null || lon === null ? null : nearestView(p.roverViews, lat, lon, VIEW_NEAR_M);
  const openSample = (sm: CheminSample) => {
    p.onSelectSample(sm.id);
    setView('minerals');
  };

  const target = p.selectedTarget;
  const targetNotes = target ? p.crew.notes.filter((n) => n.target_id === target.id) : [];

  return (
    <div>
      <div className="mb-3 flex overflow-hidden rounded border border-line text-[12px]" role="tablist" aria-label="Catalogue sections">
        {VIEWS.map(([id, label], i) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => {
              setView(id);
              setDetail(false);
            }}
            className={`flex-1 px-1.5 py-1 cursor-pointer ${i ? 'border-l border-line' : ''} ${
              view === id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {label}
            {id === 'notes' && p.crew.notes.length > 0 && <span className="num text-faint"> {p.crew.notes.length}</span>}
          </button>
        ))}
      </div>

      {view === 'objectives' && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] text-faint">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Pre-mission plan · read-only. Choose the active objective in the planning panel.
          </p>
          <ul className="space-y-3">
            {p.objectives.map((o) => (
              <li key={o.id}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[o.category] }} />
                  <span className="font-medium">{o.title}</span>
                  {o.id === p.activeObjectiveId && <span className="ml-auto text-[11px] text-accent">Active</span>}
                </div>
                <p className="mt-0.5 text-muted">{o.description}</p>
                <p className="mt-0.5 text-[11px] text-faint">
                  {CATEGORY_LABELS[o.category]} · Targets:{' '}
                  {o.primary_target_ids.map((id) => p.targets.find((t) => t.id === id)?.name ?? id).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'targets' &&
        (detail && target ? (
          <div>
            <button
              type="button"
              onClick={() => setDetail(false)}
              className="mb-2 flex items-center gap-1 text-[11px] text-muted hover:text-fg cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> All targets
            </button>
            <TargetInspector
              target={target}
              isDestination={samePlace(p.destinationPoint, target)}
              isStart={samePlace(p.startPoint, target)}
              isStop={p.stopTargetIds.includes(target.id)}
              onSetDestination={p.onSetDestination}
              onSetStart={p.onSetStart}
              onAddStop={p.onAddStop}
            >
              {(() => {
                const v = viewNear(target.latitude, target.longitude);
                return v ? (
                  <button
                    type="button"
                    onClick={() => p.onOpenRoverView(v.view)}
                    className="mt-3 flex items-center gap-1.5 rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer"
                    title="Look around from Curiosity's Navcam at this stop"
                  >
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    Rover view nearby · {solLabel(v.view.sols)} · {fmtDistance(v.distance_m)}
                  </button>
                ) : null;
              })()}
              <TargetMineralogy target={target} dataset={p.chemin} onOpen={openSample} />
              <SubHeading>Crew notes for this target</SubHeading>
              {targetNotes.length ? (
                <ul className="mb-2 space-y-2.5">
                  {targetNotes.map((n) => (
                    <NoteItem key={n.id} note={n} targetName={null} onDelete={p.crew.remove} />
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-[11px] text-faint">None yet.</p>
              )}
              <NoteComposer crew={p.crew} targets={p.targets} fixedTarget={target} destination={p.destinationPoint} defaultKind="observation" />
            </TargetInspector>
          </div>
        ) : (
          <div className="space-y-3">
            <SolTimelineSlider
              currentSol={p.currentSol}
              onSolChange={p.onSolChange}
              minSol={0}
              maxSol={p.maxSol}
              caption={`${p.visibleTargets.length} of ${p.targets.length} targets`}
            />
            {p.visibleTargets.length ? (
              <TargetSelectionPanel
                targets={p.visibleTargets}
                selectedTarget={p.selectedTarget}
                onSelectTarget={p.onSelectTarget}
                destinationPoint={p.destinationTarget}
                onSetAsDestination={p.onSetDestination}
                onInspect={(t) => {
                  p.onSelectTarget(t);
                  setDetail(true);
                }}
              />
            ) : (
              <EmptyNote>No targets reached by this sol.</EmptyNote>
            )}
          </div>
        ))}

      {view === 'minerals' && (
        <MineralsPanel
          dataset={p.chemin}
          error={p.cheminError}
          targets={p.targets}
          selectedId={p.selectedSampleId}
          onSelect={p.onSelectSample}
          onShowOnMap={p.onShowSampleOnMap}
          hasRoverView={(sm) => !!viewNear(sm.lat, sm.lon)}
          onOpenRoverView={(sm) => {
            const v = viewNear(sm.lat, sm.lon);
            if (v) p.onOpenRoverView(v.view);
          }}
        />
      )}

      {view === 'references' && <References targets={p.targets} gis={p.gis} route={p.route} chemin={p.chemin} roverCount={p.roverViews.length} />}

      {view === 'notes' && <NotesPanel crew={p.crew} targets={p.targets} destination={p.destinationPoint} />}
    </div>
  );
};
