import React from 'react';
import type { DoseEstimate, EngineRouteResponse } from '@shared/types/engine';
import { EmptyNote, KeyValues, SubHeading } from './Section';
import { StatusBadge } from './StatusBadge';
import { NOT_PROVIDED, fmtDose, fmtDuration } from './format';
import type { TerrainInfo } from '../map/MarsMap';
import type { GisLayerManifest, ImageryEntry } from '../map/demLayer';
import { compassDirection, imageryIds } from '../map/gisLayers';

interface ContextPanelProps {
  route: EngineRouteResponse | null;
  terrain: TerrainInfo | null;
  gis: GisLayerManifest | null;
  engineMode: string;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : NOT_PROVIDED);
const fmtValue = (v: number, units: string) => (units === 'degree' ? `${v.toFixed(1)}°` : `${v.toFixed(2)} ${units}`);

function registrationText(e: ImageryEntry): string {
  const r = e.registration_summary;
  if (!r) return NOT_PROVIDED;
  if (r.verdict === 'aligned') return `Aligned with the DEM (within ${Math.round(r.offset_m?.total ?? 0)} m)`;
  if (r.verdict === 'offset' && r.offset_m) {
    return `Lies ≈${Math.round(r.offset_m.total)} m ${compassDirection(r.offset_m.north, r.offset_m.east)} of the DEM; shown as delivered`;
  }
  return 'Not determined';
}

/** Provenance of every map layer, from layers.json (built by gis/marga_gis from NASA Mars Trek). */
const MapLayersProvenance: React.FC<{ gis: GisLayerManifest }> = ({ gis }) => {
  const vectors = Object.entries(gis.vectors ?? {});
  return (
    <div className="space-y-2.5">
      {imageryIds(gis).map((id) => {
        const e = gis.imagery![id];
        const firstUrl = e.source.requests?.[0] ?? e.source.tile_url_template;
        return (
          <div key={id}>
            <p className="mb-1 text-fg">{e.title}</p>
            <KeyValues
              rows={[
                ['Product', text(e.catalogue_title)],
                ['Instrument', [e.mission, e.instrument].filter(Boolean).join(', ') || NOT_PROVIDED],
                ['Resolution', `${e.resolution_m} m`],
                ['Coverage', `${(e.coverage_fraction * 100).toFixed(1)}% of the region`],
                ['Registration', registrationText(e)],
                ['Fetched', day(e.fetched_at)],
              ]}
            />
            <p className="mt-1 text-[11px] text-muted">
              Mars Trek {e.source.service}, layer {e.source.layer}
              {e.source.tile_matrix ? `, tile level ${e.source.tile_matrix}` : ''}.{' '}
              {firstUrl && <Link href={firstUrl.replace('{z}', e.source.tile_matrix ?? '{z}')}>Request</Link>}
            </p>
            {e.registration_summary && <p className="mt-0.5 text-[11px] text-faint">{e.registration_summary.basis}.</p>}
          </div>
        );
      })}
      {(['slope', 'roughness'] as const).map((id) => {
        const e = gis.layers[id];
        if (!e) return null;
        return (
          <div key={id}>
            <p className="mb-1 text-fg">{id === 'slope' ? 'Slope' : 'Surface roughness'}</p>
            <KeyValues
              rows={[
                ['Median', fmtValue(e.p50, e.units)],
                ['98th percentile', fmtValue(e.p98, e.units)],
              ]}
            />
            <p className="mt-1 text-[11px] text-muted">{e.method}. Derived from the DEM above.</p>
          </div>
        );
      })}
      {vectors.length > 0 && (
        <div>
          <p className="mb-1 text-fg">Context layers</p>
          <ul className="space-y-1.5 text-[11px] text-muted">
            {vectors.map(([id, e]) => (
              <li key={id}>
                <span className="text-fg">{e.title}</span>: {e.features_in_region} feature
                {e.features_in_region === 1 ? '' : 's'} in the region, fetched {day(e.fetched_at)}.{' '}
                <Link href={e.source}>Service</Link>
                {e.check?.latest_sol_on_line != null && (
                  <span className="block text-warn">
                    Matches Curiosity’s recorded positions to sol {e.check.latest_sol_on_line}; positions after that
                    (to sol {e.check.latest_waypoint_sol}) are not on this line.
                  </span>
                )}
                {e.copyright && <span className="block text-faint">{e.copyright}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[11px] text-faint">
        <p>
          Source: {gis.acquisition?.source ?? 'NASA Mars Trek'}. Coordinates are used unchanged in {gis.crs.code}.
          {gis.acquisition?.package_manifest ? ` Full request log and checksums: ${gis.acquisition.package_manifest}.` : ''}
        </p>
        {gis.acquisition?.notes.map((n, i) => (
          <p key={i} className="mt-0.5">
            {n}
          </p>
        ))}
      </div>
    </div>
  );
};

const text = (v: string | null | undefined) => (v && v.trim() ? v : NOT_PROVIDED);

const Link: React.FC<{ href: string | null | undefined; children: React.ReactNode }> = ({ href, children }) =>
  href && /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );

const List: React.FC<{ items: string[] | undefined }> = ({ items }) =>
  items && items.length ? (
    <ul className="list-disc space-y-1 pl-4 text-muted">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : (
    <EmptyNote>None reported.</EmptyNote>
  );

function doseRows(label: string, d: DoseEstimate | undefined): Array<[string, string]> {
  if (!d) return [[label, NOT_PROVIDED]];
  return [[`${label} (${fmtDuration(d.duration_min)})`, fmtDose(d.dose_equivalent_msv)]];
}

/** Environmental and scientific context: data provenance, historical references, assumptions. */
export const ContextPanel: React.FC<ContextPanelProps> = ({ route, terrain, gis, engineMode }) => {
  const src = route?.terrain_source;
  const rad = route?.radiation;
  const ref = rad?.full_eva_duration?.reference ?? rad?.planned_activity?.reference;
  const synthetic = src ? src.synthetic : terrain?.synthetic;
  const status = src?.status ?? terrain?.status ?? null;

  return (
    <div>
      <SubHeading>Terrain data</SubHeading>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {synthetic ? (
          <StatusBadge tone="warn">Synthetic terrain</StatusBadge>
        ) : status && status !== 'validated' ? (
          <StatusBadge tone="warn">{status.charAt(0).toUpperCase() + status.slice(1)}</StatusBadge>
        ) : status ? (
          <StatusBadge tone="neutral">Validated</StatusBadge>
        ) : null}
      </div>
      {src ? (
        <>
          <p className="mb-1.5">{src.label}</p>
          <KeyValues
            rows={[
              ['Mission', text(src.mission)],
              ['Instrument', text(src.instrument)],
              ['Resolution', src.resolution_m == null ? NOT_PROVIDED : `${src.resolution_m} m`],
              ['Coordinate system', text(src.crs)],
              ['Vertical datum', text(src.vertical_datum)],
              ['Processing', text(src.processing_level)],
              ['Roughness', text(src.roughness)],
            ]}
          />
          {src.source && (
            <p className="mt-1.5 text-[11px]">
              Source: <Link href={src.source}>{src.dataset_id}</Link>
            </p>
          )}
          <div className="mt-1.5">
            <List items={src.limitations} />
          </div>
        </>
      ) : terrain ? (
        <KeyValues
          rows={[
            ['Dataset', terrain.name],
            ['Grid cell size', `${terrain.cellSizeM.toFixed(1)} m`],
          ]}
        />
      ) : (
        <EmptyNote>Terrain model not loaded.</EmptyNote>
      )}

      <SubHeading>Map layers</SubHeading>
      {gis ? <MapLayersProvenance gis={gis} /> : <EmptyNote>GIS layers not loaded.</EmptyNote>}

      <SubHeading>Radiation</SubHeading>
      {rad ? (
        <>
          <div className="mb-1.5">
            <StatusBadge tone="neutral">{ref?.is_historical ? 'Historical reference' : 'Reference rate'}</StatusBadge>
          </div>
          <KeyValues
            rows={[
              ...doseRows('Planned activity', rad.planned_activity),
              ...doseRows('Full EVA duration', rad.full_eva_duration),
              ['Reference rate', ref ? `${ref.rate_msv_per_day} ${ref.unit}` : NOT_PROVIDED],
            ]}
          />
          {ref && (
            <p className="mt-1.5 text-[11px] text-muted">
              {ref.mission}, {ref.instrument}, {ref.location}, measured {ref.measurement_period}.{' '}
              <Link href={ref.source_url}>Source</Link>
              {ref.user_modified ? ' Rate changed by the user.' : ''}
            </p>
          )}
          <p className="mt-1 text-[11px] text-faint">
            Dose equivalent estimated from a historical average rate. It is not a live or forecast measurement.
          </p>
          <div className="mt-1.5">
            <List items={rad.full_eva_duration?.disclaimers ?? rad.planned_activity?.disclaimers} />
          </div>
        </>
      ) : (
        <EmptyNote>{route ? 'The engine did not return a radiation estimate for this route.' : 'No route yet.'}</EmptyNote>
      )}

      <SubHeading>Weather and surface conditions</SubHeading>
      <EmptyNote>
        Not available in this build: no temperature, pressure or dust dataset is loaded. Historical rover measurements
        would not describe current conditions.
      </EmptyNote>

      <SubHeading>Engine</SubHeading>
      <KeyValues
        rows={[
          ['Mode', engineMode],
          ['Version', route?.engine ? `${route.engine.name} ${route.engine.version}` : NOT_PROVIDED],
        ]}
      />
      {route?.engine && (
        <div className="mt-1.5 space-y-1 text-[11px] text-muted">
          <p>Search: {route.engine.algorithm}</p>
          <p>Walking speed: {route.engine.mobility_model}</p>
        </div>
      )}

      {route && (
        <>
          <SubHeading>Assumptions</SubHeading>
          <List items={route.assumptions} />

          {route.mission_summary && (
            <>
              <SubHeading>Terrain advisories</SubHeading>
              <List items={route.mission_summary.terrain_advisories} />
              <SubHeading>Data limitations</SubHeading>
              <List items={route.mission_summary.data_limitations} />
              <SubHeading>Dataset references</SubHeading>
              <List items={route.mission_summary.dataset_references} />
            </>
          )}
        </>
      )}
    </div>
  );
};
