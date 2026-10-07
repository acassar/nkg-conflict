/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL d'un fichier .pmtiles (fond Protomaps). Absent = fond de secours MapLibre. */
  readonly VITE_PMTILES_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
