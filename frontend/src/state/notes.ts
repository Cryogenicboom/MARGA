/**
 * Crew notes and saved observations. They are astronaut-generated records, stored apart from the
 * NASA catalogue and never mixed into it. They live in this browser (offline) and are exported or
 * imported as JSON, which is the durable mission record: browser storage stays on one machine.
 */
import { useCallback, useEffect, useState } from 'react';
import { readStored, writeStored } from './storage';

export type CrewNoteKind = 'note' | 'observation';

export interface CrewNote {
  id: string;
  kind: CrewNoteKind;
  text: string;
  created_at: string; // ISO 8601, UTC
  author: string | null;
  tag: string | null;
  target_id: string | null;
  /** Where the observation was made: planetocentric latitude / east longitude (IAU_2015:49900). */
  location: { latitude: number; longitude: number; label: string } | null;
}

export interface CrewNotesFile {
  format: 'marga-crew-notes';
  format_version: 1;
  exported_at: string;
  notes: CrewNote[];
}

const KEY = 'marga.crewNotes.v1';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function isNote(x: unknown): x is CrewNote {
  const n = x as CrewNote;
  return !!n && typeof n.id === 'string' && typeof n.text === 'string' && (n.kind === 'note' || n.kind === 'observation') && typeof n.created_at === 'string';
}

export function useCrewNotes() {
  const [notes, setNotes] = useState<CrewNote[]>(() => readStored<CrewNote[]>(KEY, []).filter(isNote));
  const [persisted, setPersisted] = useState(true);
  useEffect(() => setPersisted(writeStored(KEY, notes)), [notes]);

  const add = useCallback((n: Omit<CrewNote, 'id' | 'created_at'>) => {
    setNotes((prev) => [{ ...n, id: newId(), created_at: new Date().toISOString() }, ...prev]);
  }, []);
  const remove = useCallback((id: string) => setNotes((prev) => prev.filter((n) => n.id !== id)), []);

  const exportFile = useCallback((): CrewNotesFile => ({
    format: 'marga-crew-notes',
    format_version: 1,
    exported_at: new Date().toISOString(),
    notes,
  }), [notes]);

  /** Merge notes from an exported file; existing ids are kept, so importing twice adds nothing. Returns the count added. */
  const importFile = useCallback((doc: unknown): number => {
    const d = doc as CrewNotesFile;
    if (!d || d.format !== 'marga-crew-notes' || !Array.isArray(d.notes)) throw new Error('Not a MARGA crew notes file.');
    const ids = new Set(notes.map((n) => n.id));
    const fresh = d.notes.filter(isNote).filter((n) => !ids.has(n.id));
    if (fresh.length) setNotes([...fresh, ...notes].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    return fresh.length;
  }, [notes]);

  return { notes, add, remove, exportFile, importFile, persisted };
}
