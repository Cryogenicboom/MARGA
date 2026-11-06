/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CARTO_API_KEY?: string;
  readonly VITE_MAPBOX_API_KEY?: string;
  readonly VITE_NASA_API_KEY?: string;
  readonly VITE_ENGINE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
