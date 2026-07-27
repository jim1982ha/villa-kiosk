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
  /** THE single "additional entity" for this device — no domain or type
   *  restriction (a light, a switch, a motion/occupancy sensor…), one field,
   *  configurable on every entity type (replaces the old camera-only
   *  motionEntityId, which this superseded). Universally drives one thing:
   *  the badge rings red (the same alert outline any active device gets)
   *  while the linked entity's state is "on" — for type "camera" this is
   *  also what drives the simulated detection beam (EntityVisuals), so
   *  pointing a camera's linkedEntityId at its motion/occupancy sensor keeps
   *  that working exactly as before. On a camera SPECIFICALLY, it's also a
   *  long-press target — long-pressing the badge toggles the linked entity
   *  instead of opening the detail panel (a camera's tap already IS its
   *  panel/feed). Every other type keeps long-press opening its detail panel
   *  as before, even with this set — set once per device in the Config
   *  Editor / Advanced Settings. */
  linkedEntityId?: string;
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

/** A saved bird's-eye camera framing for this room — angle, tilt and zoom,
 *  not just where to pan to. Independent of `position`/`target` (which are
 *  the FIRST-PERSON teleport destination): the overview camera is one shared
 *  rig for the whole villa, so "this room's view" in overview means "orbit
 *  to this exact alpha/beta/radius/target", not a room-scale standing pose. */
export interface OverviewPose {
  alpha: number;
  beta: number;
  radius: number;
  target: Vec3;
}

export interface TeleportPoint {
  name: string;
  floor: 1 | 2;
  position: Vec3;
  target: Vec3;
  thumbnail?: string;
  /** Set by long-press/right-click on this room's card while browsing in
   *  overview mode (see TeleportMenu.setAnchorHere) — restored exactly by
   *  SceneManager.navigateTo when tapping the card again in overview. */
  overviewPose?: OverviewPose;
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
