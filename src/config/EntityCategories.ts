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
 *
 * Every alternative is anchored against start/end/"."/"_" (not bare `\b` —
 * "_" is a word character, so `\bdoor\b` still matches inside "outdoor_
 * light"). Unanchored substrings used to cross-match: "door"/"gate" matched
 * inside "outdoor"/"aggregate" (reverted), and "light" matched inside
 * `switch.outdoor_swimming_pool_light_patio_top` and won by table order even
 * though the same id also reads as pool equipment — the switch is grouped
 * under Pool everywhere else in the app, so its badge disagreed with itself.
 * The SYSTEM a switch belongs to (pool, heating, camera, speaker, outlet) is
 * checked before the generic FIXTURE-type hints (light, fan) that describe
 * only what a system switch happens to control, so "pool_light" reads as
 * pool/energy and a plain "outdoor_light" (no system keyword) still reads as
 * light.
 */
export const SWITCH_PURPOSE_HINTS: ReadonlyArray<readonly [RegExp, Category, string]> = [
  [/(?:^|[._])(?:motion|presence|occupan\w*|detect\w*)(?:[._]|$)/i, "access_control", "activity"],
  [/(?:^|[._])(?:lock|unlock|door|gate)(?:[._]|$)/i, "access_control", "lock"],
  [/(?:^|[._])(?:pump|filtr\w*|filter|jet|jacuzzi|spa|pool)(?:[._]|$)/i, "energy", "droplets"],
  [/(?:^|[._])(?:heat\w*|boiler\w*|water_?heater|thermo\w*)(?:[._]|$)/i, "comfort", "thermometer"],
  [/(?:^|[._])(?:camera|cctv)(?:[._]|$)/i, "access_control", "cctv"],
  [/(?:^|[._])(?:speaker|music|audio|sonos)(?:[._]|$)/i, "others", "music"],
  [/(?:^|[._])(?:plug|socket|outlet)(?:[._]|$)/i, "energy", "plug"],
  [/(?:^|[._])(?:light|lamp|led|spot)(?:[._]|$)/i, "light", "lightbulb"],
  [/(?:^|[._])(?:fan|vmc|extract\w*|vent\w*)(?:[._]|$)/i, "comfort", "fan"],
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
    // Mirrors iconKeyFor's SWITCH_ICON_KEY check: an explicit device_class
    // (from the entity itself or a "Show as" registry override) is a firmer
    // signal than a name guess, so it's checked first here too — otherwise
    // the badge colour and glyph could disagree again for the same entity.
    if (dc === "outlet") return "energy";
    for (const [re, category] of SWITCH_PURPOSE_HINTS) {
      if (re.test(id)) return category;
    }
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
