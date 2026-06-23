// src/config/AppConfig.ts
// Config schema + defaults + load/save (localStorage). All runtime-editable.

import type { EntityMapping, ModelTransform, SceneMarker, TeleportPoint } from "@/types/scene.types";
import { ENTITY_MAP } from "./EntityMap";
import { TELEPORT_POINTS } from "./TeleportPoints";
import { DEFAULT_THRESHOLDS, type Threshold } from "./ThresholdConfig";

const CONFIG_KEY = "villa-kiosk:config:v2";

/** Model transform matching the coordinates baked into TeleportPoints.ts. */
export const DEFAULT_MODEL_TRANSFORM: ModelTransform = {
  scale: 0.01,
  centreX: 1206,
  centreZ: 614,
  flipX: false,
  flipZ: false,
};

export interface AppConfig {
  haUrl: string;
  haToken: string;
  haPort: number;
  /**
   * Dashboard title shown in the HUD, onboarding and document title. Left empty
   * by default so it auto-resolves to the Home Assistant instance name
   * (`location_name` from HA's config); falls back to "Villa Kiosk".
   */
  siteTitle: string;
  latitude: number;
  longitude: number;
  theme: "dark" | "light";
  currentFloor: 1 | 2;
  /** entity_id -> metadata (panel type, label, room). Editable at runtime. */
  entityMap: Record<string, EntityMapping>;
  /**
   * GLB mesh name -> entity_id. THE turnkey binding layer: lets any model
   * (whose meshes are NOT named after entity IDs) be wired to HA entities by
   * tapping objects in the scene. Takes priority over name-based matching.
   */
  meshBindings: Record<string, string>;
  /** Floating control markers for devices that aren't separate meshes (3Dash-style). */
  markers: SceneMarker[];
  teleportPoints: TeleportPoint[];
  alertThresholds: Record<string, Threshold>;
  modelTransform: ModelTransform;
  /** Standing eye height in metres (default 1.7). Configurable in Settings. */
  eyeHeight: number;
  /** Walk-speed multiplier (1.0 = default). Configurable in Settings. */
  walkSpeed: number;
  /** Enable camera collision with walls. */
  wallCollisions: boolean;
  /** Rain/weather particle effects (off by default — can look noisy). */
  weatherEffects: boolean;
  /** Room polygons parsed from an uploaded .sh3d (auto room names, any villa). */
  sh3dRooms?: { name: string; points: { x: number; y: number }[] }[];
  /** Entity plan positions parsed from an uploaded .sh3d (for the transform fit). */
  sh3dEntities?: { entityId: string; x: number; y: number }[];
  /**
   * Manual override for room calibration when auto-detection comes out reversed.
   * The app first auto-fits the plan→model transform; these flips are applied on
   * top of the result, mirroring room detection about the model centre. Use them
   * if the detected room is left-right (flipX) or front-back (flipZ) reversed
   * versus the real villa.
   */
  calibrationFlipX: boolean;
  calibrationFlipZ: boolean;
  renderOnDemand: boolean;
  /** Show floating state labels above each bound device in the 3D scene. */
  showEntityLabels: boolean;
  /** Draw a blue highlight outline around all interactive (bound) objects. */
  highlightInteractive: boolean;
  onboarded: boolean;
}

const env = import.meta.env;

export const DEFAULT_CONFIG: AppConfig = {
  haUrl: env.VITE_HA_URL ?? "",
  haToken: env.VITE_HA_TOKEN ?? "",
  haPort: env.VITE_HA_PORT ? Number(env.VITE_HA_PORT) : 8123,
  siteTitle: "",
  latitude: env.VITE_LAT ? Number(env.VITE_LAT) : -8.3405,
  longitude: env.VITE_LNG ? Number(env.VITE_LNG) : 115.092,
  theme: "dark",
  currentFloor: 1,
  entityMap: ENTITY_MAP,
  meshBindings: {},
  markers: [],
  teleportPoints: TELEPORT_POINTS,
  alertThresholds: DEFAULT_THRESHOLDS,
  modelTransform: DEFAULT_MODEL_TRANSFORM,
  eyeHeight: 1.7,
  walkSpeed: 1,
  wallCollisions: true,
  weatherEffects: false,
  calibrationFlipX: false,
  calibrationFlipZ: false,
  renderOnDemand: true,
  showEntityLabels: false,
  highlightInteractive: false,
  onboarded: false,
};

/** Load config, deep-merging stored values over defaults (forward-compatible). */
export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const stored = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      entityMap: { ...DEFAULT_CONFIG.entityMap, ...(stored.entityMap ?? {}) },
      meshBindings: { ...DEFAULT_CONFIG.meshBindings, ...(stored.meshBindings ?? {}) },
      alertThresholds: { ...DEFAULT_CONFIG.alertThresholds, ...(stored.alertThresholds ?? {}) },
      modelTransform: { ...DEFAULT_CONFIG.modelTransform, ...(stored.modelTransform ?? {}) },
      markers: stored.markers ?? DEFAULT_CONFIG.markers,
      teleportPoints: stored.teleportPoints?.length ? stored.teleportPoints : DEFAULT_CONFIG.teleportPoints,
    };
  } catch (err) {
    console.warn("[AppConfig] failed to load, using defaults", err);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error("[AppConfig] failed to save", err);
  }
}

export function resetConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

/** Normalise a base URL the user typed (strip trailing slash, ensure scheme). */
export function normaliseHaUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

/** Fallback title when neither a configured title nor the HA instance name exist. */
export const DEFAULT_SITE_TITLE = "Villa Kiosk";

/**
 * Resolve the title to display: an explicit override wins, otherwise the Home
 * Assistant instance name (auto-derived on connect), otherwise the generic
 * default. Keeps the app brand-free and instance-aware.
 */
export function resolveSiteTitle(config: Pick<AppConfig, "siteTitle">, haName?: string): string {
  return config.siteTitle.trim() || haName?.trim() || DEFAULT_SITE_TITLE;
}
