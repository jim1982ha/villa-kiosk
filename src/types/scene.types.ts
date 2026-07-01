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
  requiresConfirmation?: boolean; // Show confirm dialog before action
  category?: Category; // Map filter grouping; falls back to categoryForEntity() when unset
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TeleportPoint {
  name: string;
  floor: 1 | 2;
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

export interface SceneReadyInfo {
  meshNames: string[];
  floorsDetected: number[];
}

/**
 * A floating, app-created control point (3Dash-style). Lets you control a device
 * that is NOT a separate object in the model — or whose HA entity doesn't exist
 * yet. Dropped at a tapped 3D point and bound to an entity_id (which may be added
 * to HA later). Persisted in config; recreated on every model load.
 */
export interface SceneMarker {
  id: string;
  entityId: string; // may not exist in HA yet
  type: EntityType; // drives icon, visual reaction and control panel
  label?: string;
  position: Vec3;
  floor: number;
}
