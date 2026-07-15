// src/config/EntityCategories.ts
//
// Default category assignment for the map's category filter (HUD left
// column) and the Config Editor's "Category" column. Edit the tables/rules
// below to change the villa-wide defaults — no other code needs to change.
//
// A per-entity value the user set in the Config Editor ALWAYS wins over these
// defaults — but a category that merely equals the LEGACY auto-default is
// treated as "never customised" (see effectiveCategory), so re-organising the
// defaults here re-buckets already-detected devices too, while a genuine user
// choice is preserved.

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

/** Default category by device TYPE. Anything not listed here (and not caught by
 *  a device_class rule below) falls into "others". */
export const DEFAULT_CATEGORY_BY_TYPE: Partial<Record<EntityType, Category>> = {
  light: "light",
  camera: "access_control",
  lock: "access_control",
  climate: "comfort",
  cover: "comfort",
  fan: "comfort",
  sensor: "energy",
};

/** The PREVIOUS type defaults. Used only to recognise an auto-assigned (i.e.
 *  never user-picked) category so a defaults re-org re-buckets it. Keep in sync
 *  with whatever DEFAULT_CATEGORY_BY_TYPE + the `?? "others"` fallback used to
 *  produce before the reorg. */
const LEGACY_DEFAULT_CATEGORY_BY_TYPE: Partial<Record<EntityType, Category>> = {
  light: "light", camera: "network", climate: "comfort",
  cover: "comfort", fan: "comfort", sensor: "energy",
};
function legacyDefaultCategory(type: EntityType): Category {
  return LEGACY_DEFAULT_CATEGORY_BY_TYPE[type] ?? "others";
}

/** Per-entity_id exceptions, checked BEFORE everything below — for specific
 *  devices that shouldn't follow their domain's default. */
export const CATEGORY_EXCEPTIONS: Partial<Record<string, Category>> = {
};

// device_class sets that redirect a generic domain to a specific category.
const COMFORT_SENSOR_DC = new Set(["temperature", "humidity"]);
const ACCESS_BINARY_DC = new Set(["motion", "presence", "occupancy", "moving"]);

/** Resolve the DEFAULT category for an entity: exception > device_class rule >
 *  entity_id hint > type default > "others". `deviceClass` (from the live HA
 *  state) makes the sensor/binary_sensor splits precise; when it isn't known
 *  yet the entity_id hints cover the common cases. */
export function categoryForEntity(entityId: string, type: EntityType, deviceClass?: string): Category {
  const exception = CATEGORY_EXCEPTIONS[entityId];
  if (exception) return exception;

  const dc = (deviceClass ?? "").toLowerCase();
  const id = entityId.toLowerCase();

  if (type === "sensor") {
    // Temperature / humidity readings live with the comfort controls.
    if (COMFORT_SENSOR_DC.has(dc) || /(^|[._])(temperature|temp|humidity|humid)([._]|$)/.test(id)) return "comfort";
    // Enum (text-state) sensors — connectivity, status, mode … — read as network.
    if (dc === "enum") return "network";
  } else if (type === "binary_sensor") {
    // Motion / presence detectors belong with access control.
    if (ACCESS_BINARY_DC.has(dc) || /(^|[._])(motion|presence|occupancy|pir)([._]|$)/.test(id)) return "access_control";
  }

  return DEFAULT_CATEGORY_BY_TYPE[type] ?? "others";
}

/** The category to actually USE for an entity: a stored value the user picked
 *  wins, but a stored value that merely equals the legacy auto-default is
 *  ignored so the current defaults (above) apply — including retroactively to
 *  already-detected devices whose category was auto-pinned. */
export function effectiveCategory(
  entityId: string,
  type: EntityType,
  storedCategory?: Category,
  deviceClass?: string,
): Category {
  if (storedCategory && storedCategory !== legacyDefaultCategory(type)) return storedCategory;
  return categoryForEntity(entityId, type, deviceClass);
}
