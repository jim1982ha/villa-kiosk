import type { EntityDomain } from "./ha.types";

/** The kind of control panel a tapped mesh should open. */
export type EntityType = EntityDomain;

/** Grouping used by the map's category filter (HUD left column) and the
 *  Config Editor's "Category" column. Default assignment per device type —
 *  and per-entity exceptions — live in `config/EntityCategories.ts`. */
export type Category = "comfort" | "light" | "network" | "energy" | "access_control" | "others";

export interface EntityMapping {
  entityId: string;
  type: EntityType;
  label: string; // Human-readable name for UI panels
  room: string; // Room for grouping / teleport context
  category?: Category; // Map filter grouping; falls back to categoryForEntity() when unset
  /** Hide this device from the 3D view entirely: no badge/label, no blue
   *  highlight, not tappable — the mesh stays as plain geometry. For devices
   *  modelled ahead of their Home Assistant integration (e.g. ceiling fans not
   *  yet controllable). Toggled per-device in Advanced Settings. */
  disabled?: boolean;
  /** The device's CONTROL entity — no domain or type restriction (a switch,
   *  a light, an input_boolean…), configurable on every entity type. Drives
   *  exactly one visual: the badge rings red (the same alert outline any
   *  active device gets) while this entity's state is "on". On a camera
   *  SPECIFICALLY it's also a long-press target — long-pressing the badge
   *  toggles it, since a camera's tap already IS its panel (the fullscreen
   *  feed), leaving long-press free. Every other type keeps long-press
   *  opening its detail panel, even with this set.
   *
   *  Deliberately paired with, and kept SEPARATE from, motionEntityId below:
   *  this one is what the USER toggles (arm/disarm), that one is what HOME
   *  ASSISTANT reports (detection fired). Collapsing them into one field
   *  (briefly done in v2.35.56) meant a single entity had to be both
   *  user-writable and sensor-read-only at once — see that field's note. */
  linkedEntityId?: string;
  /** For type "camera": the HA motion/occupancy binary_sensor that goes "on"
   *  when this camera actually DETECTS something. Read-only — this is a
   *  sensor reporting reality, never something the UI toggles. Drives the
   *  simulated detection beam on the map (CameraBeams), falling back to
   *  glowing the camera's own room when its SweetHome placement carries no
   *  facing rotation (see applyMotionRouting). Not inferred from naming
   *  (camera integrations name these too inconsistently) — set once per
   *  camera in the Config Editor.
   *
   *  Strictly separate from linkedEntityId above, and the two drive
   *  DIFFERENT visuals on purpose: ring = "detection is armed" (user
   *  controls it), beam/glow = "detection just fired" (HA reports it). One
   *  field could never express both, which is exactly why the merged
   *  version had to be split back apart. */
  motionEntityId?: string;
  /** For type "light": a per-fixture override, -1..1 (Advanced Settings shows
   *  it as a -100%..+100% slider), applied ON TOP of the entity's live HA
   *  brightness and the global "Light effect strength" setting — 0 = no
   *  change, -1 = fully off, +1 = double. Lets one light be tuned brighter or
   *  dimmer than its HA dimmer level alone would produce (e.g. a fixture
   *  whose room reads darker than the others) without affecting every other
   *  light (see EntityVisuals' effectiveFrac). */
  lightIntensityRatio?: number;
  /** Per-entity badge background colour (#rrggbb) set from the device panel's
   *  icon. Overrides the category's preset gradient for THIS device's map badge
   *  only (see babylon/badgeIcons.badgeImageDataUrl). Unset = category default.
   *  Persisted with entityMap (local storage) and in the config export bundle. */
  badgeColor?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TeleportPoint {
  name: string;
  floor: 1 | 2;
  /** FIRST-PERSON teleport destination (a standing pose). The bird's-eye
   *  framing is NOT stored: it's derived per room from the floor plan's own
   *  footprint on arrival — see SceneManager.computeRoomOverviewPose. There
   *  used to be a hand-saved `overviewPose` here as well, which froze one
   *  eyeballed zoom into config and, being usually too wide, also left the
   *  room's badges grouped when you arrived. */
  position: Vec3;
  target: Vec3;
  thumbnail?: string;
}

/**
 * Transform applied to raw SweetHome 3D coordinates (centimetres, Y-down plan)
 * to obtain Babylon world coordinates (metres). Kept in config so the model can
 * be re-aligned without touching code if the GLB export axes differ.
 */
export interface ModelTransform {
  scale: number; // cm -> m, default 0.01
  centreX: number; // SweetHome plan centre X (cm)
  centreZ: number; // SweetHome plan centre Y (cm)
  flipX: boolean;
  flipZ: boolean;
}
