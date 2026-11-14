/**
 * Browser storage for per-workstation state (display preferences, crew notes). Everything here also
 * works without storage: a private window or blocked site data simply starts empty each time.
 */
import { useEffect, useState } from 'react';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const CONTRAST_KEY = 'marga.highContrast';

/** High-contrast display: swaps the colour tokens (styles/index.css) on the root element. */
export function useHighContrast(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readStored(CONTRAST_KEY, false));
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.dataset.contrast = 'high';
    else delete root.dataset.contrast;
    writeStored(CONTRAST_KEY, on);
  }, [on]);
  return [on, setOn];
}
