// src/config/AppConfig.ts
// Config schema + defaults + load/save (localStorage). All runtime-editable.

import type { Category, EntityMapping, EntityType, ModelTransform, SceneMarker, TeleportPoint } from "@/types/scene.types";
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

/**
 * Per-category glyph for the in-scene state badges. One icon per entity TYPE
 * (not per entity) — editable in Settings. The badge's RING/FILL colour encodes
 * the live state (on / off / alert / unreachable); the glyph stays the device
 * type so the scene reads at a glance without text clutter. Plain emoji so they
 * render in the Babylon GUI TextBlock on every platform with no icon font.
 */
export const DEFAULT_ENTITY_ICONS: Record<EntityType, string> = {
  light: "💡",
  climate: "🌡️",
  lock: "🔒",
  camera: "📷",
  cover: "🪟",
  fan: "🌀",
  binary_sensor: "🚨",
  sensor: "📈",
  media_player: "🎵",
  switch: "🔌",
  input_boolean: "🔘",
  assist_satellite: "🎙️",
};

/** Tone-mapping operator applied to the whole scene (see RenderConfig). */
export type ToneMappingMode = "none" | "standard" | "aces" | "khr_neutral";

/**
 * Render-quality preset. The Settings UI exposes just this (plus a couple of
 * heavy opt-in toggles) instead of ~15 individual dials — picking a preset
 * materialises a full RenderConfig (see RENDER_PRESETS). "high" is the default:
 * the app assumes the user wants the best look out of the box.
 */
export type QualityPreset = "performance" | "balanced" | "high";

/**
 * Render-quality / look knobs. Every effect is independently toggle-able and
 * tunable so the look can be iterated at runtime (Settings → Render quality)
 * without a rebuild. Mirrors the optional flags in the Blender GLB pipeline
 * (sources/blender_pipeline.py) so the same dials exist offline and online.
 */
export interface RenderConfig {
  /** Quality preset the config was materialised from (drives the Settings UI). */
  quality: QualityPreset;
  /** Filmic tone-mapping operator. "khr_neutral" = Khronos PBR Neutral (best
   *  default: tames blown highlights without ACES's desaturation). */
  toneMapping: ToneMappingMode;
  /** Camera exposure (image processing). 1.0 = neutral. */
  exposure: number;
  /** Image-processing contrast. 1.0 = neutral; >1 deepens the mid-tones. */
  contrast: number;
  /** Hemispheric (flat fill) light intensity. Lower = more directional contrast. */
  hemiIntensity: number;
  /** Multiplier on the day/night directional sun intensity (the key light). */
  sunIntensity: number;
  /** Multiplier on the day/night ambient fill colour. */
  ambientIntensity: number;
  /** Image-based lighting from a procedural sky/ground gradient cube. */
  ibl: boolean;
  /** IBL contribution (scene.environmentIntensity). */
  environmentIntensity: number;
  /** Screen-space ambient occlusion (corner/contact darkening). */
  ssao: boolean;
  ssaoRadius: number;
  ssaoStrength: number;
  /** SSAO sample count — perf/quality trade-off (4/8/16/32). */
  ssaoSamples: number;
  /** Cast directional shadows from the sun (heaviest effect). */
  shadows: boolean;
  /** Shadow map resolution (512/1024/2048). */
  shadowMapSize: number;
  /** Shadow strength 0..1 (0 = invisible, 1 = black). */
  shadowDarkness: number;
  /** Soft-shadow blur kernel size. */
  shadowBlur: number;
  /** Soft bloom around anything emissive (lit fixtures, active lock/switch
   *  tints, alert pulses) — makes an "on" state read as glowing, not just a
   *  brighter flat colour. Cheap relative to SSAO/shadows. */
  glow: boolean;
  /** GlowLayer.intensity — how strongly emissive things bloom. */
  glowIntensity: number;
  /** How much EXTRA dimming (beyond the base day/night look) is applied at
   *  night, 0..1. 0 = the mild dim this app always had; 1 = maximum — dim
   *  enough that a lit fixture's own light clearly dominates the room, but
   *  never fully black (SunController floors it so rooms stay legible). */
  nightDimming: number;
}

/**
 * Concrete RenderConfig for each preset. These are the ONLY render looks the UI
 * offers now (item: "simplify to a preset + a few toggles"). `shadows` is a
 * separate user toggle layered on top, so every preset ships shadows off and the
 * UI preserves the user's shadow choice when they switch presets.
 *
 * Day/night warmth of the fill light + IBL is handled live in SunController, so
 * these values are the *base* look; the night pass dims/warms them automatically.
 */
export const RENDER_PRESETS: Record<QualityPreset, RenderConfig> = {
  // Fastest path for weak wall tablets: no AO, no IBL, gentle tone mapping.
  // Glow stays on (it's a single small blurred render target, cheap next to
  // SSAO/shadows) since it's core to how an "on" device reads.
  performance: {
    quality: "performance",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.08,
    hemiIntensity: 0.55, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.6,
    ssao: false, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    shadows: false, shadowMapSize: 1024, shadowDarkness: 0.35, shadowBlur: 32,
    glow: true, glowIntensity: 0.7, nightDimming: 0.7,
  },
  // The proven "safe win": subtle contact AO, no IBL/shadows.
  balanced: {
    quality: "balanced",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.1,
    hemiIntensity: 0.5, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.65,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    shadows: false, shadowMapSize: 1024, shadowDarkness: 0.35, shadowBlur: 32,
    glow: true, glowIntensity: 0.8, nightDimming: 0.7,
  },
  // Best look out of the box: AO + soft sky/ground IBL + higher-sample AO.
  high: {
    quality: "high",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.12,
    hemiIntensity: 0.45, sunIntensity: 1.05, ambientIntensity: 0.6,
    ibl: true, environmentIntensity: 0.6,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.25, ssaoSamples: 16,
    shadows: false, shadowMapSize: 2048, shadowDarkness: 0.4, shadowBlur: 32,
    glow: true, glowIntensity: 0.9, nightDimming: 0.7,
  },
};

/** Default look: best quality the app can show without the heaviest extra (shadows). */
export const DEFAULT_RENDER: RenderConfig = RENDER_PRESETS.high;

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
  theme: "dark" | "light" | "auto";
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
  /** Entity plan positions parsed from an uploaded .sh3d (for the transform fit).
   *  `angle` (degrees, plan rotation) drives the camera motion-beam direction. */
  sh3dEntities?: { entityId: string; x: number; y: number; angle: number }[];
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
  /** Categories currently hidden from the map's state-label overlay (HUD left
   *  column category filter). Empty = every category shown. See
   *  config/EntityCategories.ts for the category set + default assignment. */
  hiddenCategories: Category[];
  /** Draw a blue highlight outline around all interactive (bound) objects. */
  highlightInteractive: boolean;
  /**
   * Natural scrolling: drag up → content moves up (map follows your finger).
   * When false (Traditional): drag up → content moves down, wheel zoom is
   * inverted. Matches the macOS/iOS "Natural Scrolling" system setting.
   */
  naturalScrolling: boolean;
  /** Render-quality / look settings (tone mapping, AO, shadows, IBL, lights). */
  render: RenderConfig;
  /**
   * Extra substrings that mark a material/mesh as glass, merged into the built-in
   * keyword list. For custom imported windows whose glass material has no obvious
   * keyword (find the name in the `[ModelLoader] pane-like meshes` console log).
   * Case-insensitive substring match; takes effect on the next model load.
   */
  extraGlassHints?: string[];
  /**
   * Repaint the bare grey terrain slab (the plinth SweetHome 3D exports outside the
   * grass room) with a procedural grass texture. Default on; set false to disable.
   */
  grassGround?: boolean;
  /**
   * Explicit material/mesh substrings to grass, overriding auto-detection. Use when
   * the grey terrain shares a material with something it shouldn't (auto-detect then
   * either misses it or over-paints): tap the grey area to read its material name
   * from the `[PickHandler] tapped mesh … material` console log, and name it here.
   * Case-insensitive substring match; takes effect on the next model load.
   */
  grassGroundHints?: string[];
  /** Per-category state-badge glyphs (see DEFAULT_ENTITY_ICONS). Editable in Settings. */
  entityIcons: Record<EntityType, string>;
  /** Global size multiplier for the in-scene state-icon badges (1 = default).
   *  In the bird's-eye view this is further scaled by the zoom level. */
  entityIconScale: number;
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
  theme: "auto",
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
  hiddenCategories: [],
  highlightInteractive: false,
  naturalScrolling: true,
  render: DEFAULT_RENDER,
  entityIcons: { ...DEFAULT_ENTITY_ICONS },
  // 1.5x at the default whole-villa overview packed badges too tightly for the
  // overlap-avoiding declutter to keep more than one per room visible (most
  // devices in a room fall within the same clash radius). 1.0x is the badge's
  // native (unscaled) size — still user-adjustable via the Settings slider.
  entityIconScale: 1.0,
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
      render: { ...DEFAULT_CONFIG.render, ...(stored.render ?? {}) },
      entityIcons: { ...DEFAULT_ENTITY_ICONS, ...(stored.entityIcons ?? {}) },
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
