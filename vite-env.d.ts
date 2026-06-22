/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default HA base URL, e.g. http://192.168.1.50:8123 */
  readonly VITE_HA_URL?: string;
  /** Default long-lived access token (optional — prefer entering in onboarding) */
  readonly VITE_HA_TOKEN?: string;
  /** Default HA port */
  readonly VITE_HA_PORT?: string;
  /** Villa GPS for sun tracking */
  readonly VITE_LAT?: string;
  readonly VITE_LNG?: string;
  /** Deploy target used by scripts/deploy.mjs */
  readonly VITE_DEPLOY_HOST?: string;
  readonly VITE_DEPLOY_USER?: string;
  readonly VITE_DEPLOY_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
