/// <reference types="vite/client" />

/** Build-time version string injected by vite.config.ts `define`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Build-time override for the API base URL (optional). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
