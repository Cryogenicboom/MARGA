import React, { useMemo, useState } from 'react';
import type { ScienceTarget } from '@shared/types';
import { ArrowLeft, Camera, Crosshair } from 'lucide-react';
import { Disclosure, EmptyNote, KeyValues, SubHeading } from './Section';
import { fmtDistance, fmtLatLon, fmtMetres } from './format';
import {
  FAMILY_LABELS,
  primaryAnalysis,
  samplesNear,
  type CheminAnalysis,
  type CheminDataset,
  type CheminSample,
  type StatedFraction,
} from '../services/minerals';
import { calculateMarsDistanceMeters } from '../services/routeService';

const ExtLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
    {children}
  </a>
);

export const KIND_LABEL = { drill: 'Drill sample', scoop: 'Scooped sample' } as const;

/**
 * One CheMin table as published: a bar per crystalline phase (weight % of the crystalline part, which
 * sums to 100 %), with the 2-sigma error as a whisker and the value at the bar tip.
 */
export const MineralBars: React.FC<{ analysis: CheminAnalysis }> = ({ analysis }) => {
  const max = Math.max(10, ...analysis.minerals.map((m) => m.wt_pct + m.err_2sigma));
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div role="table" aria-label={`CheMin mineral abundances, ${analysis.product_id}`}>
      <div role="row" className="mb-1 grid grid-cols-[7.5rem_minmax(0,1fr)_4.75rem] gap-2 text-[10px] uppercase tracking-wider text-faint">
        <span role="columnheader">Mineral</span>
        <span role="columnheader">wt % of crystalline part</span>
        <span role="columnheader" className="text-right">
          wt % ± 2σ
        </span>
      </div>
      <ul className="space-y-[3px]">
        {analysis.minerals.map((m) => (
          <li
            key={m.mineral}
            role="row"
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.75rem] items-center gap-2"
            title={`${m.label}: ${m.wt_pct} ± ${m.err_2sigma} wt % (2σ), ${FAMILY_LABELS[m.family]}`}
          >
            <span role="cell" className="truncate">
              {m.label}
            </span>
            <span role="cell" className="relative h-3" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 w-px bg-line-strong" />
              <span className="absolute left-0 top-[3px] h-[6px] rounded-r bg-accent" style={{ width: pct(m.wt_pct) }} />
              <span
                className="absolute top-1/2 h-px bg-muted"
                style={{ left: pct(Math.max(0, m.wt_pct - m.err_2sigma)), width: `calc(${pct(m.wt_pct + m.err_2sigma)} - ${pct(Math.max(0, m.wt_pct - m.err_2sigma))})` }}
              />
            </span>
            <span role="cell" className="num text-right text-[11.5px]">
              {m.wt_pct.toFixed(1)} <span className="text-faint">± {m.err_2sigma.toFixed(1)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-faint">
        Crystalline phases, summing to {analysis.table_sum_wt_pct} %. Bar: value; line: ±2σ estimated error.
      </p>
    </div>
  );
};

const Fraction: React.FC<{ label: string; f?: StatedFraction }> = ({ label, f }) =>
  f ? (
    <li>
      <span className="text-fg">{label}:</span>{' '}
      <span className="num">
        ~{f.wt_pct}
        {f.plus_minus !== null ? ` ± ${f.plus_minus}` : ''} wt %
      </span>{' '}
      of the whole sample
      <Disclosure label="Label wording" className="mt-0.5">
        <blockquote className="border-l-2 border-line pl-2 text-[11px] text-muted">{f.statement}</blockquote>
      </Disclosure>
    </li>
  ) : null;

const AnalysisBlock: React.FC<{ a: CheminAnalysis }> = ({ a }) => (
  <div>
    <div className="mb-1.5 text-[11px] text-muted">
      Sol <span className="num text-fg">{a.sol}</span>
      {a.sample_phrase && <> · {a.sample_phrase.replace(/^the /, '')}</>}
      {a.reanalysis && <span className="ml-1 rounded border border-line px-1 text-[10px]">Reanalysis of the stored sample</span>}
    </div>
    <MineralBars analysis={a} />
    {(a.fractions.clay || a.fractions.amorphous) && (
      <>
        <div className="mt-2 text-[11px] text-faint">Not in the table, stated in the PDS label</div>
        <ul className="mt-0.5 space-y-1 text-[12px]">
          <Fraction label="Clay minerals" f={a.fractions.clay} />
          <Fraction label="X-ray amorphous material" f={a.fractions.amorphous} />
        </ul>
      </>
    )}
    <Disclosure label="Source of this table" className="mt-2">
      <KeyValues
        rows={[
          ['PDS product', <ExtLink href={a.csv_url}>{a.product_id}</ExtLink>],
          ['Label', <ExtLink href={a.label_url}>PDS3 label</ExtLink>],
          ['Observation start (UTC)', a.start_time ?? '—'],
          ['PDS release', a.release_id ?? '—'],
          ['Rover position (RMC)', a.rmc],
        ]}
      />
      {a.supersedes.length > 0 && <p className="mt-1 text-[11px] text-faint">Supersedes {a.supersedes.join(', ')}.</p>}
      <p className="num mt-1 break-all text-[10px] text-faint">CSV SHA-256 {a.csv_sha256}</p>
      <Disclosure label="Label description (CheMin team)" className="mt-1">
        <p className="text-[11px] text-muted">{a.description}</p>
      </Disclosure>
    </Disclosure>
  </div>
);

interface RecordProps {
  sample: CheminSample;
  dataset: CheminDataset;
  targets: ScienceTarget[];
  onShowOnMap?: (s: CheminSample) => void;
  onOpenRoverView?: (s: CheminSample) => void;
  hasRoverView?: (s: CheminSample) => boolean;
}

/** A CheMin sampling site: where it is, every analysis as published, and the sources. */
export const SampleRecord: React.FC<RecordProps> = ({ sample, dataset, targets, onShowOnMap, onOpenRoverView, hasRoverView }) => {
  const nearest = useMemo(() => {
    if (sample.lat === null || sample.lon === null) return null;
    let best: { t: ScienceTarget; d: number } | null = null;
    for (const t of targets) {
      const d = calculateMarsDistanceMeters(sample.lat, sample.lon, t.latitude, t.longitude);
      if (!best || d < best.d) best = { t, d };
    }
    return best;
  }, [sample, targets]);
  const btn = 'flex items-center gap-1 rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer';
  return (
    <div>
      <h3 className="text-[14px] font-semibold leading-snug">{sample.name}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <span className="rounded border border-line-strong px-1 text-[10px] font-semibold uppercase tracking-wider">NASA PDS</span>
        CheMin X-ray diffraction · {sample.kind ? KIND_LABEL[sample.kind] : 'Sample'} · first analysed sol {sample.first_sol}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onShowOnMap && sample.lat !== null && (
          <button type="button" className={btn} onClick={() => onShowOnMap(sample)}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> Show on map
          </button>
        )}
        {onOpenRoverView && hasRoverView?.(sample) && (
          <button type="button" className={btn} onClick={() => onOpenRoverView(sample)}>
            <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Rover view here
          </button>
        )}
      </div>

      <SubHeading>Location</SubHeading>
      {sample.location && sample.lat !== null && sample.lon !== null ? (
        <>
          <KeyValues
            rows={[
              ['Coordinates', fmtLatLon(sample.lat, sample.lon)],
              ['Rover elevation (geoid)', fmtMetres(sample.elev_geoid_m)],
              ['Nearest catalogue target', nearest ? `${nearest.t.name} · ${fmtDistance(nearest.d)}` : '—'],
            ]}
          />
          <p className="mt-1 text-[11px] text-faint">{sample.location.basis}</p>
        </>
      ) : (
        <EmptyNote>The rover position for this analysis is not in the localisation data.</EmptyNote>
      )}

      {sample.analyses.map((a) => (
        <div key={a.product_id}>
          <SubHeading>
            Mineralogy{sample.analyses.length > 1 ? ` · sol ${a.sol}` : ''}
          </SubHeading>
          <AnalysisBlock a={a} />
        </div>
      ))}

      <SubHeading>Data source</SubHeading>
      <p className="text-[12px]">
        {dataset.source.citation} <ExtLink href={dataset.source.archive_page}>PDS Geosciences Node</ExtLink>
      </p>
      <p className="mt-1 text-[11px] text-faint">
        Positions: {dataset.source.locations}. Retrieved {dataset.source.retrieved_at?.slice(0, 10) ?? '—'}.
      </p>
    </div>
  );
};

/** Short summary line for lists: the three most abundant crystalline phases, and the stated clay fraction. */
export function sampleSummary(s: CheminSample): string {
  const a = primaryAnalysis(s);
  const parts = [a.minerals.slice(0, 3).map((m) => `${m.label} ${Math.round(m.wt_pct)}`).join(', ') + ' wt %'];
  if (a.fractions.clay) parts.push(`clay ~${a.fractions.clay.wt_pct} % of sample`);
  return parts.join(' · ');
}

interface PanelProps {
  dataset: CheminDataset | null;
  error: string | null;
  targets: ScienceTarget[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onShowOnMap: (s: CheminSample) => void;
  onOpenRoverView: (s: CheminSample) => void;
  hasRoverView: (s: CheminSample) => boolean;
}

/** Catalogue → Minerals: every CheMin sampling site along the traverse, then one site's record. */
export const MineralsPanel: React.FC<PanelProps> = ({ dataset, error, targets, selectedId, onSelect, onShowOnMap, onOpenRoverView, hasRoverView }) => {
  const [query, setQuery] = useState('');
  if (error) return <EmptyNote>Mineral data could not be loaded ({error}).</EmptyNote>;
  if (!dataset) return <EmptyNote>Loading mineral data…</EmptyNote>;
  const sample = selectedId ? dataset.samples.find((s) => s.id === selectedId) : null;
  if (sample) {
    return (
      <div>
        <button type="button" onClick={() => onSelect(null)} className="mb-2 flex items-center gap-1 text-[11px] text-muted hover:text-fg cursor-pointer">
          <ArrowLeft className="h-3.5 w-3.5" /> All samples
        </button>
        <SampleRecord sample={sample} dataset={dataset} targets={targets} onShowOnMap={onShowOnMap} onOpenRoverView={onOpenRoverView} hasRoverView={hasRoverView} />
      </div>
    );
  }
  const q = query.trim().toLowerCase();
  const list = dataset.samples.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || primaryAnalysis(s).minerals.some((m) => m.label.toLowerCase().includes(q)),
  );
  return (
    <div>
      <p className="mb-2 text-[11px] text-faint">
        {dataset.samples.length} sampling sites analysed by Curiosity's CheMin instrument, from NASA PDS. Search by site or mineral.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. Rock Hall, hematite, gypsum"
        aria-label="Search samples by site or mineral"
        className="mb-2 w-full rounded border border-line bg-bg px-2 py-1 text-[12px] placeholder:text-faint"
      />
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onSelect(s.id)} className="w-full py-1.5 text-left hover:bg-raised cursor-pointer">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="num ml-auto shrink-0 text-[11px] text-faint">sol {s.first_sol}</span>
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {s.kind ? KIND_LABEL[s.kind] : 'Sample'} · {sampleSummary(s)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>No sample matches “{query}”.</EmptyNote>
      )}
    </div>
  );
};

/** Inside a target's catalogue record: CheMin samples analysed near the target. */
export const TargetMineralogy: React.FC<{
  target: ScienceTarget;
  dataset: CheminDataset | null;
  radiusM?: number;
  onOpen: (s: CheminSample) => void;
}> = ({ target, dataset, radiusM = 300, onOpen }) => {
  if (!dataset) return null;
  const near = samplesNear(dataset.samples, target.latitude, target.longitude, radiusM);
  return (
    <div>
      <SubHeading>Mineralogy (CheMin, NASA PDS)</SubHeading>
      {near.length ? (
        <ul className="space-y-1.5">
          {near.map(({ sample, distance_m }) => (
            <li key={sample.id}>
              <button type="button" onClick={() => onOpen(sample)} className="w-full text-left hover:text-accent cursor-pointer">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium underline-offset-2 hover:underline">{sample.name}</span>
                  <span className="num ml-auto shrink-0 text-[11px] text-faint">
                    {fmtDistance(distance_m)} · sol {sample.first_sol}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-muted">{sampleSummary(sample)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-faint">No CheMin sample was analysed within {radiusM} m of this target.</p>
      )}
    </div>
  );
};
