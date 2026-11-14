/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Python engine service (engine/marga_engine/api.py). Unset = in-browser engine only. */
  readonly VITE_ENGINE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
