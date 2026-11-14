import { useEffect, useState } from 'react';
import { loadChemin, type CheminDataset } from '../services/minerals';
import { loadRoverViews, type RoverViewsDataset } from '../services/roverViews';

export interface SurfaceData {
  chemin: CheminDataset | null;
  cheminError: string | null;
  rover: RoverViewsDataset | null;
  roverError: string | null;
}

/** Curiosity surface data shipped with the app (public/science, public/rover); each loads on its own. */
export function useSurfaceData(): SurfaceData {
  const [state, setState] = useState<SurfaceData>({ chemin: null, cheminError: null, rover: null, roverError: null });
  useEffect(() => {
    let cancelled = false;
    const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
    loadChemin()
      .then((chemin) => !cancelled && setState((s) => ({ ...s, chemin })))
      .catch((e) => !cancelled && setState((s) => ({ ...s, cheminError: msg(e) })));
    loadRoverViews()
      .then((rover) => !cancelled && setState((s) => ({ ...s, rover })))
      .catch((e) => !cancelled && setState((s) => ({ ...s, roverError: msg(e) })));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
