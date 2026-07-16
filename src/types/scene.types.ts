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
  /** For type "camera": the HA motion/occupancy binary_sensor that goes "on"
   *  when this camera detects motion. Drives the simulated detection beam
   *  (EntityVisuals). Not inferred from naming (camera integrations name
   *  these too inconsistently) — set once per camera in the Config Editor. */
  motionEntityId?: string;
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
