/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default HA base URL, e.g. http://homeassistant.local:8123 */
  readonly VITE_HA_URL?: string;
  /** Default long-lived access token (optional — prefer entering in onboarding) */
  readonly VITE_HA_TOKEN?: string;
  /** Default HA port */
  readonly VITE_HA_PORT?: string;
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

/** package.json's version, baked in at build time — see vite.config.ts's
 *  `define`. Used to prove which build is actually running (e.g. in
 *  CameraPanel's diagnostic log), so "still broken after the fix shipped"
 *  reports can rule a stale/undeployed build in or out at a glance. */
declare const __APP_VERSION__: string;
