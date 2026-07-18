/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Villa GPS for sun tracking */
  readonly VITE_LAT?: string;
  readonly VITE_LNG?: string;
  /** Standalone-mode profile passcodes (4 digits; empty = profile un-gated).
   *  Baked into the client bundle by Vite — a courtesy gate for a trusted
   *  kiosk device. In add-on mode PINs live in the add-on options instead. */
  readonly VITE_GUEST_PIN?: string;
  readonly VITE_OWNER_PIN?: string;
  readonly VITE_OPS_PIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The running app version (package.json, baked in at build time — see vite.config.ts). */
declare const __APP_VERSION__: string;
