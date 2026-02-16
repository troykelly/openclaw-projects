/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time override for the API base URL (optional). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
