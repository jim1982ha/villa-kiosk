// src/config/AppConfig.ts
// Config schema + defaults + load/save (localStorage). All runtime-editable.

import type { Category, EntityMapping, EntityType, ModelTransform, TeleportPoint } from "@/types/scene.types";
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

/**
 * binary_sensor is a catch-all HA domain — a water-leak sensor and a PIR
 * motion sensor are both "binary_sensor", so one per-type glyph can't tell
 * them apart. HA distinguishes them via the entity's `device_class` state
 * attribute (the same signal SensorPanel's wording uses, see
 * config/BinarySensorClasses.ts); this table gives each class its own badge
 * glyph. Resolution order for a binary_sensor badge: the user's per-class
 * override (config.binarySensorIcons) → this default → the generic
 * binary_sensor entry in entityIcons for entities with no device_class.
 */
export const DEFAULT_BINARY_SENSOR_ICONS: Record<string, string> = {
  moisture: "💧",
  motion: "🚶",
  moving: "🏃",
  occupancy: "👁️",
  presence: "🏠",
  door: "🚪",
  garage_door: "🚪",
  window: "🪟",
  opening: "🚪",
  lock: "🔓",
  smoke: "🔥",
  gas: "💨",
  carbon_monoxide: "💨",
  vibration: "📳",
  sound: "🔊",
  light: "🔆",
  battery: "🪫",
  battery_charging: "🔋",
  connectivity: "📶",
  plug: "🔌",
  power: "⚡",
  running: "▶️",
  safety: "⚠️",
  problem: "⚠️",
  tamper: "⚠️",
  heat: "🌡️",
  cold: "❄️",
  update: "🔄",
};

/**
 * `sensor` is HA's other catch-all domain — a Shelly power meter, a
 * temperature probe and a humidity probe are all "sensor", so (like
 * binary_sensor above) one per-type glyph can't tell them apart. Keyed by
 * the entity's `device_class` state attribute, same resolution order as
 * DEFAULT_BINARY_SENSOR_ICONS: config.sensorIcons override → this default →
 * the generic sensor entry in entityIcons for a class not listed here.
 */
export const DEFAULT_SENSOR_ICONS: Record<string, string> = {
  temperature: "🌡️",
  humidity: "💧",
  power: "⚡",
  energy: "🔋",
  current: "⚡",
  voltage: "⚡",
  battery: "🪫",
  illuminance: "☀️",
  pressure: "📊",
  gas: "💨",
  carbon_dioxide: "💨",
  volatile_organic_compounds: "💨",
  pm25: "💨",
  signal_strength: "📶",
  timestamp: "🕐",
  duration: "⏱️",
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
  /** Soft bloom around anything emissive (lit fixtures, active lock/switch
   *  tints, alert pulses) — makes an "on" state read as glowing, not just a
   *  brighter flat colour. Cheap relative to SSAO. */
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
 * offers now (item: "simplify to a preset + a few toggles").
 *
 * Day/night warmth of the fill light + IBL is handled live in SunController, so
 * these values are the *base* look; the night pass dims/warms them automatically.
 */
export const RENDER_PRESETS: Record<QualityPreset, RenderConfig> = {
  // Fastest path for weak wall tablets: no AO, no IBL, gentle tone mapping.
  // Glow stays on (it's a single small blurred render target, cheap next to
  // SSAO) since it's core to how an "on" device reads.
  performance: {
    quality: "performance",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.08,
    hemiIntensity: 0.55, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.6,
    ssao: false, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    glow: true, glowIntensity: 0.8, nightDimming: 0.5,
  },
  // The proven "safe win": subtle contact AO, no IBL.
  balanced: {
    quality: "balanced",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.1,
    hemiIntensity: 0.5, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.65,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    glow: true, glowIntensity: 0.8, nightDimming: 0.5,
  },
  // Best look out of the box: AO + soft sky/ground IBL + higher-sample AO.
  high: {
    quality: "high",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.12,
    hemiIntensity: 0.45, sunIntensity: 1.05, ambientIntensity: 0.6,
    ibl: true, environmentIntensity: 0.6,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.25, ssaoSamples: 16,
    glow: true, glowIntensity: 0.8, nightDimming: 0.5,
  },
};

/** Default look: the best quality preset. */
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
  teleportPoints: TeleportPoint[];
  alertThresholds: Record<string, Threshold>;
  modelTransform: ModelTransform;
  /** Standing eye height in metres (default 1.7). Configurable in Settings. */
  eyeHeight: number;
  /** Walk-speed multiplier (1.0 = default). Configurable in Settings. */
  walkSpeed: number;
  /** Rain/weather particle effects (off by default — can look noisy). */
  weatherEffects: boolean;
  /** Room polygons from the pipeline's .rooms.json sidecar (auto room names, any
   *  villa). `floor` is the 1-based storey the room's SweetHome level resolves to
   *  (see sh3dParser.ts) — defaults to 1 for older stored configs. */
  sh3dRooms?: { name: string; points: { x: number; y: number }[]; floor?: number }[];
  /** Entity plan positions from the pipeline's .rooms.json sidecar (for the
   *  transform fit). `angle` (radians, plan yaw) and `pitch` (radians, tilt)
   *  drive the camera motion-beam direction. */
  sh3dEntities?: { entityId: string; x: number; y: number; angle: number; pitch: number }[];
  renderOnDemand: boolean;
  /** Categories currently hidden from the map's state-label overlay (HUD left
   *  column category filter). Empty = every category shown. See
   *  config/EntityCategories.ts for the category set + default assignment. */
  hiddenCategories: Category[];
  /** Device TYPES the active profile must never see or tap (RBAC). Written by
   *  filterConfigForRole, never persisted or user-edited. Filtering entityMap/
   *  meshBindings alone is NOT enough: resolveMeshToMapping's inference
   *  fallback fabricates a mapping from the MESH NAME alone ("camera.gate" is
   *  a valid entity_id), which gave guests camera badges + highlights the
   *  matrix denies. Every resolver call passes this so a denied type resolves
   *  to null — the mesh stays visible, but as plain untappable geometry. */
  deniedTypes?: EntityType[];
  /** Draw a blue highlight outline around all interactive (bound) objects. */
  highlightInteractive: boolean;
  /**
   * Natural scrolling: drag up → content moves up (map follows your finger).
   * When false (Traditional): drag up → content moves down, wheel zoom is
   * inverted. Matches the macOS/iOS "Natural Scrolling" system setting.
   */
  naturalScrolling: boolean;
  /** Render-quality / look settings (tone mapping, AO, IBL, lights). */
  render: RenderConfig;
  /**
   * Extra substrings that mark a material/mesh as glass, merged into the built-in
   * keyword list. For custom imported windows whose glass material has no obvious
   * keyword (find the name in the `[ModelLoader] pane-like meshes` console log).
   * Case-insensitive substring match; takes effect on the next model load.
   */
  extraGlassHints?: string[];
  /** Per-category state-badge glyphs (see DEFAULT_ENTITY_ICONS). Editable in Settings. */
  entityIcons: Record<EntityType, string>;
  /** Per-device_class badge glyphs for binary_sensor entities (see
   *  DEFAULT_BINARY_SENSOR_ICONS). Editable in Settings; a class missing here
   *  falls back to the default table, then to entityIcons.binary_sensor. */
  binarySensorIcons: Record<string, string>;
  /** Per-device_class badge glyphs for sensor entities (see
   *  DEFAULT_SENSOR_ICONS) — lets a power/temperature/humidity sensor each
   *  show a distinct glyph instead of sharing the generic "sensor" one.
   *  Editable in Settings; a class missing here falls back to the default
   *  table, then to entityIcons.sensor. */
  sensorIcons: Record<string, string>;
  /** Global size multiplier for the in-scene state-icon badges (1 = default).
   *  In the bird's-eye view this is further scaled by the zoom level. */
  entityIconScale: number;
  /** Manually-grouped entities that are really one physical device (e.g. a
   *  combo sensor exposing separate `_temperature`/`_humidity` entities).
   *  Only `primaryEntityId` gets a badge/mesh presence on the map; every
   *  `memberEntityIds` entity is folded into that badge's detail view
   *  instead (see components/panels/DeviceGroupPanel). Editable in Advanced
   *  Settings. */
  deviceGroups: DeviceGroup[];
  onboarded: boolean;
}

/** See AppConfig.deviceGroups. */
export interface DeviceGroup {
  /** Stable id for the group — NOT necessarily an entity_id (survives a
   *  primary being remapped). */
  id: string;
  /** The entity whose badge/mesh represents this device on the map. */
  primaryEntityId: string;
  /** Other entities folded into the primary's detail view. Each may or may
   *  not have its own entityMap entry / mesh binding — grouping only affects
   *  which badge is shown and which panel opens, not how they're bound. */
  memberEntityIds: string[];
  /** Optional label override for the detail view's header (defaults to the
   *  primary's own label). */
  label?: string;
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
  teleportPoints: TELEPORT_POINTS,
  alertThresholds: DEFAULT_THRESHOLDS,
  modelTransform: DEFAULT_MODEL_TRANSFORM,
  eyeHeight: 1.7,
  walkSpeed: 1,
  weatherEffects: false,
  renderOnDemand: true,
  hiddenCategories: [],
  highlightInteractive: false,
  naturalScrolling: true,
  render: DEFAULT_RENDER,
  entityIcons: { ...DEFAULT_ENTITY_ICONS },
  binarySensorIcons: { ...DEFAULT_BINARY_SENSOR_ICONS },
  sensorIcons: { ...DEFAULT_SENSOR_ICONS },
  // 1.5x at the default whole-villa overview packed badges too tightly for the
  // overlap-avoiding declutter to keep more than one per room visible (most
  // devices in a room fall within the same clash radius). 1.0x is the badge's
  // native (unscaled) size — still user-adjustable via the Settings slider.
  entityIconScale: 1.0,
  deviceGroups: [],
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
      binarySensorIcons: { ...DEFAULT_BINARY_SENSOR_ICONS, ...(stored.binarySensorIcons ?? {}) },
      sensorIcons: { ...DEFAULT_SENSOR_ICONS, ...(stored.sensorIcons ?? {}) },
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

/**
 * Portable config bundle for Owner backup/restore (Advanced Settings → Export
 * / Import configuration). Deliberately narrower than the full AppConfig:
 *  - covers exactly what the product spec calls "your configuration" — device
 *    ↔ room bindings (entityMap + meshBindings, auto-detected AND manually
 *    bound), room definitions (teleportPoints, incl. each room's saved
 *    overviewPose), device icons, enabled/disabled devices (the entityMap
 *    `disabled` flag) and every option in the First-person/Overview, Render
 *    quality and Device-icon Settings sections.
 *  - excludes haUrl/haToken (a bearer credential — never belongs in a
 *    shareable file) and the per-device overview default framing (already
 *    documented in SceneManager.saveOverviewDefault as intentionally
 *    per-device, not synced/exported).
 */
export interface ConfigExportBundle {
  version: 1;
  exportedAt: string;
  entityMap: Record<string, EntityMapping>;
  meshBindings: Record<string, string>;
  teleportPoints: TeleportPoint[];
  entityIcons: Record<EntityType, string>;
  binarySensorIcons: Record<string, string>;
  sensorIcons: Record<string, string>;
  entityIconScale: number;
  deviceGroups: DeviceGroup[];
  eyeHeight: number;
  walkSpeed: number;
  naturalScrolling: boolean;
  weatherEffects: boolean;
  highlightInteractive: boolean;
  render: RenderConfig;
}

export function buildConfigExport(config: AppConfig): ConfigExportBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entityMap: config.entityMap,
    meshBindings: config.meshBindings,
    teleportPoints: config.teleportPoints,
    entityIcons: config.entityIcons,
    binarySensorIcons: config.binarySensorIcons,
    sensorIcons: config.sensorIcons,
    entityIconScale: config.entityIconScale,
    deviceGroups: config.deviceGroups,
    eyeHeight: config.eyeHeight,
    walkSpeed: config.walkSpeed,
    naturalScrolling: config.naturalScrolling,
    weatherEffects: config.weatherEffects,
    highlightInteractive: config.highlightInteractive,
    render: config.render,
  };
}

/** Validate + narrow an arbitrary parsed JSON value down to the fields this
 *  app version actually knows how to apply — a bundle exported by a future
 *  version can carry fields we don't recognise yet without corrupting config. */
export function parseConfigImport(raw: unknown): Partial<ConfigExportBundle> {
  if (!raw || typeof raw !== "object") throw new Error("Not a valid configuration file.");
  const b = raw as Record<string, unknown>;
  if (typeof b.version !== "number") throw new Error("Not a Villa Kiosk configuration file.");
  const patch: Partial<ConfigExportBundle> = {};
  if (b.entityMap && typeof b.entityMap === "object") patch.entityMap = b.entityMap as ConfigExportBundle["entityMap"];
  if (b.meshBindings && typeof b.meshBindings === "object") patch.meshBindings = b.meshBindings as ConfigExportBundle["meshBindings"];
  if (Array.isArray(b.teleportPoints)) patch.teleportPoints = b.teleportPoints as ConfigExportBundle["teleportPoints"];
  if (b.entityIcons && typeof b.entityIcons === "object") patch.entityIcons = b.entityIcons as ConfigExportBundle["entityIcons"];
  if (b.binarySensorIcons && typeof b.binarySensorIcons === "object") patch.binarySensorIcons = b.binarySensorIcons as ConfigExportBundle["binarySensorIcons"];
  if (b.sensorIcons && typeof b.sensorIcons === "object") patch.sensorIcons = b.sensorIcons as ConfigExportBundle["sensorIcons"];
  if (typeof b.entityIconScale === "number") patch.entityIconScale = b.entityIconScale;
  if (Array.isArray(b.deviceGroups)) patch.deviceGroups = b.deviceGroups as ConfigExportBundle["deviceGroups"];
  if (typeof b.eyeHeight === "number") patch.eyeHeight = b.eyeHeight;
  if (typeof b.walkSpeed === "number") patch.walkSpeed = b.walkSpeed;
  if (typeof b.naturalScrolling === "boolean") patch.naturalScrolling = b.naturalScrolling;
  if (typeof b.weatherEffects === "boolean") patch.weatherEffects = b.weatherEffects;
  if (typeof b.highlightInteractive === "boolean") patch.highlightInteractive = b.highlightInteractive;
  if (b.render && typeof b.render === "object") patch.render = b.render as RenderConfig;
  return patch;
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
