// src/config/EntityCategories.ts
//
// Default category assignment for the map's category filter (HUD left
// column) and the Config Editor's "Category" column. Edit the two tables
// below to change the villa-wide defaults — no other code needs to change.
// Both are re-applied every time the model/entities are (re)indexed, so
// editing this file takes effect on the next app load / GLB refresh.
//
// A per-entity value the user set in the Config Editor ALWAYS wins over
// these defaults (see `EntityMapping.category` in scene.types.ts) — this
// file only supplies the starting point for entities that don't have an
// explicit category yet.

import type { Category, EntityType } from "@/types/scene.types";

/** Fixed display order for the HUD filter buttons and Config Editor dropdown. */
export const CATEGORY_ORDER: Category[] = [
  "comfort", "light", "network", "energy", "access_control", "others",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  comfort: "Comfort",
  light: "Light",
  network: "Network",
  energy: "Energy",
  access_control: "Access Control",
  others: "Others",
};

/** Default category by device TYPE. Anything not listed here falls into
 *  "others". */
export const DEFAULT_CATEGORY_BY_TYPE: Partial<Record<EntityType, Category>> = {
  light: "light",
  camera: "network",
  climate: "comfort",
  cover: "comfort",
  fan: "comfort",
  sensor: "energy",
};

/** Per-entity_id exceptions, checked BEFORE the type default above — for
 *  specific devices that shouldn't follow their domain's default. Example:
 *    "lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism": "access_control",
 *    "sensor.front_gate_motion": "access_control",
 */
export const CATEGORY_EXCEPTIONS: Partial<Record<string, Category>> = {
};

/** Resolve the DEFAULT category for an entity: exception > type default >
 *  "others". Used to seed a newly-detected/bound/marked entity's category;
 *  once the user edits it in the Config Editor, their choice is stored on
 *  the EntityMapping and this function is no longer consulted for it. */
export function categoryForEntity(entityId: string, type: EntityType): Category {
  return CATEGORY_EXCEPTIONS[entityId] ?? DEFAULT_CATEGORY_BY_TYPE[type] ?? "others";
}
