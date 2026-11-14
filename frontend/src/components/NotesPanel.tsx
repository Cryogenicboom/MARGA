import React, { useRef, useState } from 'react';
import type { LocationPoint, ScienceTarget } from '@shared/types';
import { Download, NotebookPen, Trash2, Upload } from 'lucide-react';
import type { CrewNote, CrewNoteKind, useCrewNotes } from '../state/notes';
import { EmptyNote } from './Section';
import { fmtLatLon } from './format';

export type CrewNotesApi = ReturnType<typeof useCrewNotes>;

/** The label every crew record carries, so it is never mistaken for catalogue text. */
export const CrewLabel: React.FC<{ kind: CrewNoteKind }> = ({ kind }) => (
  <span className="inline-flex items-center gap-1 rounded border border-warn/60 px-1 text-[10px] font-semibold uppercase tracking-wider text-warn">
    <NotebookPen className="h-2.5 w-2.5" aria-hidden="true" />
    Crew {kind}
  </span>
);

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

export const NoteItem: React.FC<{ note: CrewNote; targetName?: string | null; onDelete: (id: string) => void }> = ({ note, targetName, onDelete }) => {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="border-l-2 border-warn/70 pl-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
        <CrewLabel kind={note.kind} />
        <span className="num">{when(note.created_at)}</span>
        {note.author && <span>· {note.author}</span>}
        {note.tag && <span className="rounded bg-raised px-1 text-muted">{note.tag}</span>}
        <span className="ml-auto">
          {confirm ? (
            <>
              <button type="button" className="text-bad hover:underline cursor-pointer" onClick={() => onDelete(note.id)}>
                Delete
              </button>
              <button type="button" className="ml-2 hover:text-fg cursor-pointer" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="hover:text-fg cursor-pointer" onClick={() => setConfirm(true)} aria-label="Delete this crew record">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap">{note.text}</p>
      {(targetName || note.location) && (
        <p className="num mt-0.5 text-[11px] text-muted">
          {targetName && <>At {targetName}</>}
          {targetName && note.location && ' · '}
          {note.location && fmtLatLon(note.location.latitude, note.location.longitude)}
        </p>
      )}
    </li>
  );
};

interface ComposerProps {
  crew: CrewNotesApi;
  targets: ScienceTarget[];
  /** Pre-selected target (a target's own record). */
  fixedTarget?: ScienceTarget | null;
  destination: LocationPoint | null;
  defaultKind?: CrewNoteKind;
}

/** Write a crew note or an observation, optionally tied to a target or to the current destination. */
export const NoteComposer: React.FC<ComposerProps> = ({ crew, targets, fixedTarget, destination, defaultKind = 'note' }) => {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<CrewNoteKind>(defaultKind);
  const [tag, setTag] = useState('');
  const [author, setAuthor] = useState(() => {
    try {
      return window.localStorage.getItem('marga.crewAuthor') ?? '';
    } catch {
      return '';
    }
  });
  const [where, setWhere] = useState<string>(fixedTarget ? `target:${fixedTarget.id}` : 'none');

  const save = () => {
    const body = text.trim();
    if (!body) return;
    const target = where.startsWith('target:') ? targets.find((t) => t.id === where.slice(7)) ?? null : null;
    const location =
      target != null
        ? { latitude: target.latitude, longitude: target.longitude, label: target.name }
        : where === 'destination' && destination
        ? { latitude: destination.latitude, longitude: destination.longitude, label: destination.name ?? 'Destination' }
        : null;
    crew.add({ kind, text: body, tag: tag.trim() || null, author: author.trim() || null, target_id: target?.id ?? null, location });
    try {
      window.localStorage.setItem('marga.crewAuthor', author.trim());
    } catch {
      /* storage unavailable: the name is just not remembered */
    }
    setText('');
    setTag('');
  };

  const field = 'min-w-0 rounded border border-line bg-bg px-1.5 py-1 text-[12px] text-fg placeholder:text-faint';
  return (
    <div className="space-y-1.5 rounded border border-line p-2">
      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Record type">
          {(['note', 'observation'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`px-1.5 py-px cursor-pointer ${kind === k ? 'bg-raised text-fg' : 'text-muted hover:text-fg'} ${k === 'observation' ? 'border-l border-line' : ''}`}
            >
              {k === 'note' ? 'Note' : 'Observation'}
            </button>
          ))}
        </div>
        <CrewLabel kind={kind} />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={kind === 'observation' ? 'What was observed, where, with what' : 'Note for the mission record'}
        className={`${field} w-full resize-y`}
        aria-label="Crew note text"
      />
      <div className="grid grid-cols-2 gap-1.5">
        {!fixedTarget && (
          <select value={where} onChange={(e) => setWhere(e.target.value)} className={`${field} col-span-2`} aria-label="Location">
            <option value="none">No location</option>
            {destination && <option value="destination">Current destination ({destination.name})</option>}
            {targets.map((t) => (
              <option key={t.id} value={`target:${t.id}`}>
                Target: {t.name}
              </option>
            ))}
          </select>
        )}
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag (optional)" className={field} aria-label="Tag" />
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Crew member" className={field} aria-label="Crew member" />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={!text.trim()}
        className="w-full rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-fg cursor-pointer disabled:cursor-default disabled:opacity-50"
      >
        Save {kind === 'note' ? 'note' : 'observation'}
      </button>
    </div>
  );
};

/** All crew notes and observations, with export / import of the mission record. */
export const NotesPanel: React.FC<{ crew: CrewNotesApi; targets: ScienceTarget[]; destination: LocationPoint | null }> = ({
  crew,
  targets,
  destination,
}) => {
  const [filter, setFilter] = useState<'all' | CrewNoteKind>('all');
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const shown = crew.notes.filter((n) => filter === 'all' || n.kind === filter);
  const nameOf = (id: string | null) => (id ? targets.find((t) => t.id === id)?.name ?? null : null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(crew.exportFile(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marga-crew-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File) => {
    try {
      const added = crew.importFile(JSON.parse(await file.text()));
      setMessage(`Imported ${added} new record(s).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The file could not be read.');
    }
  };
  const btn = 'flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-fg cursor-pointer';

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-faint">
        Written by the crew, kept apart from the catalogue. Stored in this browser only: export them to keep the mission record.
        {!crew.persisted && <span className="text-warn"> Browser storage is unavailable: records last only until the page closes.</span>}
      </p>
      <NoteComposer crew={crew} targets={targets} destination={destination} />

      <div className="flex items-center gap-1.5">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded border border-line bg-bg px-1 py-0.5 text-[11px]" aria-label="Show">
          <option value="all">All ({crew.notes.length})</option>
          <option value="note">Notes</option>
          <option value="observation">Observations</option>
        </select>
        <span className="ml-auto" />
        <button type="button" className={btn} onClick={exportJson} disabled={!crew.notes.length}>
          <Download className="h-3 w-3" /> Export
        </button>
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3 w-3" /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </div>
      {message && <p className="text-[11px] text-muted">{message}</p>}

      {shown.length ? (
        <ul className="space-y-2.5">
          {shown.map((n) => (
            <NoteItem key={n.id} note={n} targetName={nameOf(n.target_id)} onDelete={crew.remove} />
          ))}
        </ul>
      ) : (
        <EmptyNote>No crew records yet.</EmptyNote>
      )}
    </div>
  );
};
