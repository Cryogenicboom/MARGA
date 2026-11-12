import React from 'react';
import type { ScienceTarget, TargetConfidence } from '@shared/types';
import { EmptyNote, KeyValues, SubHeading } from './Section';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { NOT_PROVIDED, fmtLatLon, fmtMetres } from './format';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../map/mapStyles';

const CONFIDENCE: Record<TargetConfidence, { tone: StatusTone; label: string }> = {
  high: { tone: 'neutral', label: 'Confidence: high' },
  medium: { tone: 'neutral', label: 'Confidence: medium' },
  low: { tone: 'warn', label: 'Confidence: low' },
  unverified: { tone: 'warn', label: 'Unverified' },
};

interface TargetInspectorProps {
  target: ScienceTarget | null;
  isDestination: boolean;
  isStart: boolean;
  onSetDestination: (t: ScienceTarget) => void;
  onSetStart: (t: ScienceTarget) => void;
}

/** The selected science target, as recorded in the target catalogue. */
export const TargetInspector: React.FC<TargetInspectorProps> = ({
  target,
  isDestination,
  isStart,
  onSetDestination,
  onSetStart,
}) => {
  if (!target) return <EmptyNote>Select a target on the map or in the Targets list.</EmptyNote>;
  const conf = CONFIDENCE[target.confidence];
  const btn =
    'rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent';

  return (
    <div>
      <h3 className="text-[14px] font-semibold leading-snug">{target.name}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS[target.category] }} />
          {CATEGORY_LABELS[target.category]}
        </span>
        <StatusBadge tone={conf.tone}>{conf.label}</StatusBadge>
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" className={btn} disabled={isDestination} onClick={() => onSetDestination(target)}>
          {isDestination ? 'Destination' : 'Set as destination'}
        </button>
        <button type="button" className={btn} disabled={isStart} onClick={() => onSetStart(target)}>
          {isStart ? 'Start' : 'Set as start'}
        </button>
      </div>

      <SubHeading>Location</SubHeading>
      <KeyValues
        rows={[
          ['Coordinates', fmtLatLon(target.latitude, target.longitude)],
          ['Catalogue elevation', fmtMetres(target.elevation_m)],
          ['Reached by Curiosity', target.sol_discovered == null ? NOT_PROVIDED : `Sol ${target.sol_discovered}`],
        ]}
      />

      <SubHeading>Source</SubHeading>
      <KeyValues
        rows={[
          ['Mission / source', target.source || NOT_PROVIDED],
          ['Instrument', target.instrument || NOT_PROVIDED],
          ['Product reference', target.product_id || NOT_PROVIDED],
        ]}
      />

      <SubHeading>Catalogue description</SubHeading>
      <p>{target.description}</p>
      <SubHeading>Scientific significance (catalogue)</SubHeading>
      <p className="text-muted">{target.scientific_significance}</p>
      <SubHeading>Data limitations</SubHeading>
      <p className="text-muted">{target.data_limitations}</p>
      <p className="mt-3 text-[11px] text-faint">
        Text and references come from the MARGA target catalogue. Product references have not been checked against the
        NASA archive.
      </p>
    </div>
  );
};
