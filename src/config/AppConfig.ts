// src/config/AppConfig.ts
// Config schema + defaults + load/save (localStorage). All runtime-editable.

import type { Category, EntityMapping, EntityType, ModelTransform, TeleportPoint } from "@/types/scene.types";
import { ENTITY_MAP } from "./EntityMap";
import { TELEPORT_POINTS } from "./TeleportPoints";
import { DEFAULT_THRESHOLDS, type Threshold } from "./ThresholdConfig";
import type { KioskScene } from "./scenes";

const CONFIG_KEY = "villa-kiosk:config:v2";

/**
 * Bounds for entityIconScale, shared by the HUD stepper and the scene so the
 * control's limits and the renderer's clamp can never disagree.
 *
 * The minimum is deliberately NOT zero. It used to be, and a scale of 0 made
 * every badge vanish — indistinguishable from the villa failing to load, and
 * reachable in one click too many from the "smallest" setting with no label
 * explaining what had happened. Hiding badges is a legitimate thing to want,
 * but it belongs behind an explicit toggle, not the bottom of a size stepper.
 * One step (0.25) is the floor: still tiny, still obviously present.
 */
export const ENTITY_ICON_SCALE_MIN = 0.25;
export const ENTITY_ICON_SCALE_MAX = 3;
/** Clamp a possibly-legacy/persisted value (a stored 0 predates the floor). */
export function clampIconScale(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(ENTITY_ICON_SCALE_MAX, Math.max(ENTITY_ICON_SCALE_MIN, v));
}

/** Model transform matching the coordinates baked into TeleportPoints.ts. */
export const DEFAULT_MODEL_TRANSFORM: ModelTransform = {
  scale: 0.01,
  centreX: 1206,
  centreZ: 614,
  flipX: false,
  flipZ: false,
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
  /** How much EXTRA dimming (beyond the base day/night look) is applied at
   *  night, 0..1. 0 = the mild dim this app always had; 1 = maximum — dim
   *  enough that a lit fixture's own light clearly dominates the room, but
   *  never fully black (SunController floors it so rooms stay legible). */
  nightDimming: number;
  /** Strength of a lit fixture's room illumination, both flavours: the floor
   *  "light pool" decal in BAKED-lighting villas (see babylon/LightPools.ts —
   *  their structure is unlit, so a real light can't brighten it) AND the
   *  real dynamic PointLight's intensity in non-baked villas (it was a
   *  silent no-op there before 2.31.0). 1 = default. */
  lightPoolIntensity: number;
  /** Manually INVERT the automatic day/night look (sun-position/sun.sun
   *  driven): real daytime renders the night look and vice versa. Surfaced
   *  in Settings only for BAKED villas (where day/night is a dramatic
   *  atlas crossfade worth previewing/overriding on demand), but honoured
   *  everywhere. Optional + absent from the presets, so switching quality
   *  never resets it. */
  dayNightInvert?: boolean;
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
  performance: {
    quality: "performance",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.08,
    hemiIntensity: 0.55, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.6,
    ssao: false, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    nightDimming: 0.5, lightPoolIntensity: 1.0,
  },
  // The proven "safe win": subtle contact AO, no IBL.
  balanced: {
    quality: "balanced",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.1,
    hemiIntensity: 0.5, sunIntensity: 1.0, ambientIntensity: 0.6,
    ibl: false, environmentIntensity: 0.65,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.2, ssaoSamples: 8,
    nightDimming: 0.5, lightPoolIntensity: 1.0,
  },
  // Best look out of the box: AO + soft sky/ground IBL + higher-sample AO.
  high: {
    quality: "high",
    toneMapping: "khr_neutral", exposure: 1.15, contrast: 1.12,
    hemiIntensity: 0.45, sunIntensity: 1.05, ambientIntensity: 0.6,
    ibl: true, environmentIntensity: 0.6,
    ssao: true, ssaoRadius: 6, ssaoStrength: 0.25, ssaoSamples: 16,
    nightDimming: 0.5, lightPoolIntensity: 1.0,
  },
};

/** Default look: the best quality preset. */
export const DEFAULT_RENDER: RenderConfig = RENDER_PRESETS.high;

export interface AppConfig {
  /**
   * Dashboard title shown in the HUD and document title. Left empty by default
   * so it auto-resolves to the Home Assistant instance name (`location_name`
   * from HA's config); falls back to "Villa Kiosk".
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
  /**
   * Degrees to rotate every camera's motion beam relative to the `angle` its
   * piece carries in the floor plan. Default 180.
   *
   * This exists because a plan's `angle` is measured against the FURNITURE
   * MODEL's own front axis, and which way a given 3D model faces at angle 0 is
   * a property of how that model was authored — not something derivable from
   * the angle number. So the correction is per-MODEL, and a villa using a
   * different camera model from the catalog needs a different value. Making it
   * configuration rather than a constant is what keeps this replicable across
   * villas without a code change: if every beam points consistently wrong,
   * rotate them all here (the usual answers are 0, 90, 180 or 270) instead of
   * re-aiming every camera in the plan.
   *
   * Applies to the horizontal heading only; the downward tilt comes from each
   * piece's own `pitch` (or cameraBeamPitchDeg below when it has none).
   */
  cameraBeamOffsetDeg?: number;
  /**
   * Downward tilt in degrees for a camera whose plan piece specifies no
   * `pitch`. Default 30.
   *
   * Most catalog camera pieces are placed without a pitch, which left every
   * beam perfectly level — pointing across the room at head height rather than
   * at the floor area the camera actually watches. A per-piece `pitch` set in
   * the plan still wins over this.
   */
  cameraBeamPitchDeg?: number;
  /** Global size multiplier for the in-scene state-icon badges (1 = default).
   *  In the bird's-eye view this is further scaled by the zoom level.
   *  Clamped to [ENTITY_ICON_SCALE_MIN, ENTITY_ICON_SCALE_MAX] by every
   *  consumer — see those constants. */
  entityIconScale: number;
  /** Floating-badge visual style:
   *  - "classic" (default): a category-coloured icon squircle with a small
   *    value pill beneath it.
   *  - "card": a horizontal category-coloured card with the icon and value
   *    side by side (the dashboard-mockup look).
   *  Both carry identical information; purely a look preference. Read by
   *  EntityVisuals.rebuildLabels. */
  badgeStyle?: "classic" | "card";
  /** Show the bottom summary/scene strip (SummaryBar). Default true. */
  showSummaryBar?: boolean;
  /** User-defined kiosk scenes — one-tap snapshots of the villa's controllable
   *  state, captured + applied from the SummaryBar (see config/scenes.ts).
   *  Distinct from HA's own scene.* entities. */
  kioskScenes?: KioskScene[];
  /** Manually-grouped entities that are really one physical device (e.g. a
   *  combo sensor exposing separate `_temperature`/`_humidity` entities).
   *  Only `primaryEntityId` gets a badge/mesh presence on the map; every
   *  `memberEntityIds` entity is folded into that badge's detail view
   *  instead (see components/panels/DeviceGroupPanel). Editable in Advanced
   *  Settings. */
  deviceGroups: DeviceGroup[];
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
  renderOnDemand: true,
  hiddenCategories: [],
  highlightInteractive: false,
  naturalScrolling: true,
  render: DEFAULT_RENDER,
  // 1.5x at the default whole-villa overview packed badges too tightly for the
  // overlap-avoiding declutter to keep more than one per room visible (most
  // devices in a room fall within the same clash radius). 1.0x is the badge's
  // native (unscaled) size — still user-adjustable via the Settings slider.
  entityIconScale: 1.0,
  badgeStyle: "classic",
  showSummaryBar: true,
  kioskScenes: [],
  deviceGroups: [],
};

/** Load config, deep-merging stored values over defaults (forward-compatible). */
/**
 * Drop stale entity-map / mesh-binding entries whose id carries a "__<variant>"
 * pose suffix (see EntityMap.extractVariantSuffix). A real HA entity_id never
 * contains "__" — the app reserves it solely as the variant delimiter — so any
 * such entry is an artifact from BEFORE that convention existed (v2.35.0),
 * when the app auto-detected each pose ("cover.x__closed"/"__half"/"__open")
 * as its OWN separate entity and persisted it here. Those stale keys shadow
 * the correct base entity and leave one pose (typically the un-migrated
 * default) permanently un-toggled. Migrate them away on load, once — the base
 * entity re-auto-detects cleanly from the mesh names on the next model index.
 */
function stripStaleVariantEntities(config: AppConfig): AppConfig {
  const hasVariantSuffix = (id: string) => /__[a-z0-9]+$/i.test(id);
  const entityMap = Object.fromEntries(
    Object.entries(config.entityMap).filter(([id]) => !hasVariantSuffix(id)),
  );
  const meshBindings = Object.fromEntries(
    Object.entries(config.meshBindings).filter(
      ([mesh, id]) => !hasVariantSuffix(mesh) && !hasVariantSuffix(id),
    ),
  );
  return { ...config, entityMap, meshBindings };
}

/** Undo v2.35.56's motionEntityId -> linkedEntityId merge for cameras.
 *
 *  That release briefly collapsed the two fields into one, moving every
 *  camera's configured motion sensor into linkedEntityId. The fields are
 *  separate again (they drive different visuals — ring vs beam — and one is
 *  user-writable while the other is a read-only sensor), so a camera
 *  upgraded through that release has its motion sensor sitting in the wrong
 *  slot: it would ring the badge permanently while motion is detected and
 *  drive no beam at all, plus offer a long-press "toggle" of a binary_sensor
 *  that HA has no service to toggle.
 *
 *  Narrow on purpose — only cameras, only when motionEntityId is still
 *  empty, and only when the value actually looks like a sensor
 *  (binary_sensor domain). A camera deliberately linked to a real switch
 *  keeps it, since that's exactly what linkedEntityId is now for. */
function migrateMotionEntityId(config: AppConfig): AppConfig {
  let changed = false;
  const entityMap = Object.fromEntries(
    Object.entries(config.entityMap).map(([id, map]) => {
      const misplaced = map.linkedEntityId;
      if (
        map.type !== "camera" || map.motionEntityId
        || !misplaced?.startsWith("binary_sensor.")
      ) return [id, map];
      changed = true;
      return [id, { ...map, motionEntityId: misplaced, linkedEntityId: undefined }];
    }),
  );
  return changed ? { ...config, entityMap } : config;
}

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const stored = JSON.parse(raw) as Partial<AppConfig>;
    return migrateMotionEntityId(stripStaleVariantEntities({
      ...DEFAULT_CONFIG,
      ...stored,
      entityMap: { ...DEFAULT_CONFIG.entityMap, ...(stored.entityMap ?? {}) },
      meshBindings: { ...DEFAULT_CONFIG.meshBindings, ...(stored.meshBindings ?? {}) },
      alertThresholds: { ...DEFAULT_CONFIG.alertThresholds, ...(stored.alertThresholds ?? {}) },
      modelTransform: { ...DEFAULT_CONFIG.modelTransform, ...(stored.modelTransform ?? {}) },
      render: { ...DEFAULT_CONFIG.render, ...(stored.render ?? {}) },
      teleportPoints: stored.teleportPoints?.length ? stored.teleportPoints : DEFAULT_CONFIG.teleportPoints,
    }));
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

/**
 * Portable config bundle for Owner backup/restore (Advanced Settings → Export
 * / Import configuration). Deliberately narrower than the full AppConfig:
 *  - covers exactly what the product spec calls "your configuration" — device
 *    ↔ room bindings (entityMap + meshBindings, auto-detected AND manually
 *    bound), room definitions (teleportPoints, incl. each room's saved
 *    overviewPose), device icons (incl. each device's per-badge colour override,
 *    entityMap `badgeColor`), enabled/disabled devices (the entityMap
 *    `disabled` flag) and every option in the First-person/Overview, Render
 *    quality and Device-icon Settings sections. entityMap is exported/imported
 *    as whole mapping objects, so every per-entity field rides along — do NOT
 *    rewrite this to copy individual fields, or new ones (like badgeColor) would
 *    silently stop being backed up.
 *  - excludes the per-device overview default framing (already documented in
 *    SceneManager.saveOverviewDefault as intentionally per-device, not
 *    synced/exported). There are no HA credentials to exclude anymore — the
 *    kiosk reaches HA token-less through the add-on's Supervisor proxy.
 */
export interface ConfigExportBundle {
  version: 1;
  exportedAt: string;
  entityMap: Record<string, EntityMapping>;
  meshBindings: Record<string, string>;
  teleportPoints: TeleportPoint[];
  entityIconScale: number;
  deviceGroups: DeviceGroup[];
  eyeHeight: number;
  walkSpeed: number;
  naturalScrolling: boolean;
  highlightInteractive: boolean;
  badgeStyle?: "classic" | "card";
  showSummaryBar?: boolean;
  kioskScenes?: KioskScene[];
  render: RenderConfig;
}

export function buildConfigExport(config: AppConfig): ConfigExportBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entityMap: config.entityMap,
    meshBindings: config.meshBindings,
    teleportPoints: config.teleportPoints,
    entityIconScale: config.entityIconScale,
    deviceGroups: config.deviceGroups,
    eyeHeight: config.eyeHeight,
    walkSpeed: config.walkSpeed,
    naturalScrolling: config.naturalScrolling,
    highlightInteractive: config.highlightInteractive,
    badgeStyle: config.badgeStyle,
    showSummaryBar: config.showSummaryBar,
    kioskScenes: config.kioskScenes,
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
  if (typeof b.entityIconScale === "number") patch.entityIconScale = b.entityIconScale;
  if (Array.isArray(b.deviceGroups)) patch.deviceGroups = b.deviceGroups as ConfigExportBundle["deviceGroups"];
  if (typeof b.eyeHeight === "number") patch.eyeHeight = b.eyeHeight;
  if (typeof b.walkSpeed === "number") patch.walkSpeed = b.walkSpeed;
  if (typeof b.naturalScrolling === "boolean") patch.naturalScrolling = b.naturalScrolling;
  if (typeof b.highlightInteractive === "boolean") patch.highlightInteractive = b.highlightInteractive;
  if (b.badgeStyle === "classic" || b.badgeStyle === "card") patch.badgeStyle = b.badgeStyle;
  if (typeof b.showSummaryBar === "boolean") patch.showSummaryBar = b.showSummaryBar;
  if (Array.isArray(b.kioskScenes)) patch.kioskScenes = b.kioskScenes as ConfigExportBundle["kioskScenes"];
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
