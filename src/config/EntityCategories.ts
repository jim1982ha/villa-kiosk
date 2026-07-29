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
import { OPENING_DEVICE_CLASSES } from "./BinarySensorClasses";

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

/**
 * Fixed background gradient per category for the in-scene state badges (see
 * babylon/badgeIcons.ts) — every device in a category shares this squircle
 * background regardless of its live state; only an outline ring (state) and
 * the glyph (device type / device_class) vary. One colour per category, well
 * distinct from its neighbours.
 */
export const CATEGORY_COLORS: Record<Category, { top: string; bottom: string }> = {
  network:        { top: "#7FE0B4", bottom: "#2E9C6E" }, // mint -> emerald
  others:         { top: "#EDF1F5", bottom: "#AEBBC9" }, // pale silver -> blue-grey
  comfort:        { top: "#F5966A", bottom: "#DD5C34" }, // peach -> coral
  access_control: { top: "#CB93EE", bottom: "#9450C9" }, // lilac -> violet
  light:          { top: "#FFDA82", bottom: "#F0A93A" }, // gold -> amber
  energy:         { top: "#7FCBF7", bottom: "#2E8FD6" }, // sky -> electric blue
};

/** The category's gradient as a CSS value — the ONE source of the app's
 *  gradient icon squares in the DOM (top-bar category chips, the legend, the
 *  bottom-bar tile icons). The 3D badges bake the same top→bottom gradient via
 *  badgeImageDataUrl, so every gradient icon in the app comes from this same
 *  CATEGORY_COLORS pair. An optional #rrggbb override (a per-entity badge
 *  colour) derives a matching gradient from that single colour. */
export function categoryGradient(category: Category, override?: string): string {
  const c = override ? { top: override, bottom: override } : CATEGORY_COLORS[category];
  return `linear-gradient(135deg, ${c.top}, ${c.bottom})`;
}

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

/**
 * What a generic `switch.*` / `input_boolean.*` is actually FOR, inferred from
 * its name — as [pattern, category, badge glyph key]. ONE table so the colour
 * (this module) and the icon (babylon/badgeIconKeys) always agree; they used to
 * be decided separately and drifted (a "pool light" switch drew a lightbulb on
 * an "others"-grey badge). Ordered: first match wins, most specific first.
 * Only consulted when nothing more reliable (a user-set category, a
 * device_class) applies.
 */
export const SWITCH_PURPOSE_HINTS: ReadonlyArray<readonly [RegExp, Category, string]> = [
  [/motion|presence|occupan|detect/i, "access_control", "activity"],
  [/\block|unlock|door|gate/i,        "access_control", "lock"],
  [/light|lamp|\bled\b|spot/i,        "light",          "lightbulb"],
  [/fan|vmc|extract|vent/i,           "comfort",        "fan"],
  [/pump|filtr|filter|jet|jacuzzi|spa|pool/i, "energy",  "droplets"],
  [/heat|boiler|water_?heater|thermo/i, "comfort",      "thermometer"],
  [/camera|cctv/i,                    "access_control", "cctv"],
  [/speaker|music|audio|sonos/i,      "others",         "music"],
  [/plug|socket|outlet/i,             "energy",         "plug"],
];

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
    // Motion/presence detectors AND door/window/garage contacts both belong
    // with access control — a plain contact sensor (e.g. "door_network_
    // contact") used to match neither test here and fall all the way through
    // to the pale, near-colourless "others" default, which also made its
    // UNAVAILABLE dim (EntityVisuals' badge alpha) nearly invisible: an
    // already-pale badge going 50% pale reads as "no change at all". Reuses
    // OPENING_DEVICE_CLASSES — the SAME set the door/window pose-swap gate
    // (EntityVisuals) already trusts to mean "this is a physical opening" —
    // instead of a second, possibly-drifting list of device_classes.
    if (ACCESS_BINARY_DC.has(dc) || OPENING_DEVICE_CLASSES.has(dc)
        || /(^|[._])(motion|presence|occupancy|pir|door|window|gate)([._]|$)/.test(id)) {
      return "access_control";
    }
  }

  // `switch`/`input_boolean` is HA's generic RELAY domain — a pool pump, a lamp
  // relay and a gate release are all bare `switch.*` with no device_class, so
  // the type default alone buckets every one of them into "others" (grey). The
  // purpose is normally evident from the name, so fall back to the SHARED hint
  // table — the same one that picks the glyph (see badgeIconKeys.iconKeyFor),
  // so a switch can never end up with a lightbulb icon on a grey "others"
  // badge: one table decides both.
  if (type === "switch" || type === "input_boolean") {
    for (const [re, category] of SWITCH_PURPOSE_HINTS) {
      if (re.test(id)) return category;
    }
  }

  return DEFAULT_CATEGORY_BY_TYPE[type] ?? "others";
}

/** True when a `switch.*` (or `input_boolean.*`) entity is really a
 *  relay-controlled door lock modelled as a plain switch — e.g. a doorbell/
 *  intercom door-strike relay — rather than HA's native `lock` domain. Reuses
 *  SWITCH_PURPOSE_HINTS (the SAME table that already buckets such a switch
 *  into "access_control" with the "lock" badge glyph) so this stays a single
 *  source of truth instead of a second, possibly-drifting pattern — and,
 *  crucially, is villa-agnostic: any switch whose id/name reads as a door/
 *  gate relay is picked up automatically, with no per-entity config. */
export function isLockLikeSwitch(entityId: string): boolean {
  const id = entityId.toLowerCase();
  for (const [re, , glyph] of SWITCH_PURPOSE_HINTS) {
    if (re.test(id)) return glyph === "lock";
  }
  return false;
}

/** Best-effort "is this lock-like switch currently secured" from its raw on/
 *  off state. HA has no standard way to know a relay's polarity, so this
 *  assumes the overwhelmingly common convention for electric door strikes and
 *  maglocks: energised/ON = released (unlocked), de-energised/OFF = secured
 *  (locked) — "fail-secure" wiring. Treat anything but a live "on" as locked,
 *  same as an unavailable lock reads as its last-known-safe state elsewhere. */
export function isLockSwitchSecured(state: string): boolean {
  return state !== "on";
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
