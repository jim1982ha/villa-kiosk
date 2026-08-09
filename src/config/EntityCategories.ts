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

import type { ComponentType } from "react";
import { Armchair, Lightbulb, Wifi, Zap, ShieldCheck, Puzzle } from "lucide-react";
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

/** Icon per category — the HUD's filter row (tooltip-only, no text labels)
 *  and the category device-list modal (long-press a filter icon) both use
 *  this one mapping, so a category can't read as one glyph in the top bar
 *  and a different one in the modal it opens. */
export const CATEGORY_ICONS: Record<Category, ComponentType<{ size?: number | string }>> = {
  comfort: Armchair,
  light: Lightbulb,
  network: Wifi,
  energy: Zap,
  access_control: ShieldCheck,
  // Puzzle (not a dots/lines glyph) — reads as its own distinct shape rather
  // than being confused with the ⋮ overflow-menu button on small screens.
  others: Puzzle,
};

// VESTA design rule (see VESTA-DESIGN.md §0): "Neutral by default. Colour
// only when a device is active or alerting." A villa at rest used to look
// like a villa in alarm — every badge and bottom-bar tile carried a
// saturated gradient at ALL times. Category hue now only appears once a
// device is actually doing something; off/idle and unavailable both render
// neutral. This replaces the old always-on CATEGORY_COLORS gradient, not the
// category concept — the six categories stay, each keeps a hue.

const CATEGORY_VAR: Record<Category, string> = {
  comfort: "--cat-comfort",
  light: "--cat-light",
  network: "--cat-network",
  energy: "--cat-energy",
  access_control: "--cat-access-control",
  others: "--cat-others",
};

// Matches the LIGHT theme's --cat-* values (styles.css) — used only until the
// stylesheet has actually painted (categoryColor reads the live custom
// property first) or in a non-DOM context, same "static fallback, live where
// possible" pattern as babylon/colors.ts.
const FALLBACK_CATEGORY_COLOR: Record<Category, string> = {
  comfort: "#B4643C", light: "#C08A2E", network: "#2F6B4F",
  energy: "#2E6E8F", access_control: "#6B5AA6", others: "#6E7B72",
};
const FALLBACK_DANGER = "#B24232";
const FALLBACK_WARNING = "#B8801F";
const FALLBACK_NEUTRAL_GLYPH = "#5A5F5B";
const FALLBACK_HAIRLINE = "rgba(23, 25, 26, 0.10)";
// --bg-modal's light-theme value: the app's one OPAQUE floating surface (see
// its own comment in styles.css). Every fill below composites onto this
// rather than being a translucent tint in its own right — see surfaceBase().
const FALLBACK_SURFACE = "#FFFDF9";

function cssVar(name: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** The OPAQUE surface every badge fill is composited onto.
 *
 *  This must never be a translucent token. A badge is drawn in two places
 *  with very different backdrops: as a DOM chip on a panel, and — via
 *  babylon/badgeIcons.ts — baked into a canvas texture that floats over the
 *  live 3D villa. The first release of this design used --bg-input (5% black
 *  in light theme) as the resting fill, which reads fine on a panel and is
 *  effectively INVISIBLE over the 3D scene: a device at rest had no badge at
 *  all, just a faint glyph on whatever was behind it. Compositing onto an
 *  opaque base keeps the "neutral by default" intent while guaranteeing the
 *  badge is a real, readable object on any backdrop. */
function surfaceBase(): string {
  return cssVar("--bg-modal") || FALLBACK_SURFACE;
}

/** Composite `hex` at `alpha` over `base`, returning an OPAQUE colour — the
 *  same result an rgba() tint would produce on that backdrop, but resolved
 *  here so it survives being painted onto a transparent canvas. */
function tintOver(hex: string, alpha: number, base: string): string {
  const fg = parseHex(hex);
  const bg = parseHex(base);
  if (!fg || !bg) return hex;
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  const [r, g, b] = [mix(fg[0], bg[0]), mix(fg[1], bg[1]), mix(fg[2], bg[2])];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** One flat hue per category, read live from the CSS token (--cat-*) so the
 *  DOM chips/legend/bottom bar and the canvas-baked 3D badges (which can't
 *  consume a CSS var directly — see babylon/badgeIcons.ts) share exactly one
 *  source of truth instead of a hand-duplicated hex table. */
export function categoryColor(category: Category): string {
  return cssVar(CATEGORY_VAR[category]) || FALLBACK_CATEGORY_COLOR[category];
}

// The brand guidelines' badge table states the active/alerting fill as the
// hue "@ 14%". Applied here as a composite onto the opaque panel colour
// rather than as a literal rgba(), which is the same result on that backdrop
// but survives being painted onto a transparent canvas — see surfaceBase().
const TINT_ALPHA = 0.14;

export type DeviceSurfaceState = "off" | "active" | "alert" | "unavailable";
export interface CategorySurface {
  fill: string;
  glyph: string;
  ring: string | null;
  /** Unavailable only — the guidelines call for a DASHED ring there. */
  ringDashed?: boolean;
  /** Draw the ring heavier than usual — the unavailable state, which has to
   *  read as "something is wrong here" at a glance across a room. */
  ringBold?: boolean;
  /** Idle only — a 1px hairline rather than the 1.5px state ring. */
  ringHairline?: boolean;
}

/** The ONE place that turns a category + live device state into a fill/glyph/
 *  ring triple — the 2D chips, the legend, the bottom bar and the baked 3D
 *  badges (badgeIcons.ts) all call this rather than each encoding the §0
 *  table themselves. Values are resolved to literal colours (not `var(...)`
 *  strings) via a live getComputedStyle read so the SAME function works both
 *  as an inline DOM style and as a canvas fillStyle/strokeStyle, which can't
 *  consume a CSS custom property. `override` is a per-entity #rrggbb badge
 *  colour (EntityMapping.badgeColor) substituting for the category's hue. */
export function categorySurface(category: Category, state: DeviceSurfaceState, override?: string): CategorySurface {
  // Every `fill` below is OPAQUE — a state tint composited onto the app's
  // solid panel colour, never a bare rgba(). See surfaceBase() for the bug
  // that made this non-negotiable.
  const base = surfaceBase();
  switch (state) {
    case "active": {
      const hue = override ?? categoryColor(category);
      return { fill: tintOver(hue, TINT_ALPHA, base), glyph: hue, ring: hue };
    }
    case "alert": {
      const danger = cssVar("--status-danger") || FALLBACK_DANGER;
      return { fill: tintOver(danger, TINT_ALPHA, base), glyph: danger, ring: danger };
    }
    case "unavailable": {
      const warning = cssVar("--status-warning") || FALLBACK_WARNING;
      // ONE dashed ring, drawn heavy, in the unavailable amber — the colour
      // the Map colours legend documents for "Home Assistant has lost contact"
      // (utils/stateColors STATUS_COLOR). It was briefly the danger red, which
      // made a device that is merely unreachable look like a confirmed alarm
      // and put a second answer next to the legend's.
      return { fill: base, glyph: warning, ring: warning, ringDashed: true, ringBold: true };
    }
    case "off":
    default:
      return {
        fill: base,
        glyph: cssVar("--text-secondary") || FALLBACK_NEUTRAL_GLYPH,
        // The brand guidelines' badge table gives even the IDLE state a ring:
        // a 1px hairline. It is what keeps a resting badge reading as a
        // deliberate object rather than a shape that happens to sit on the
        // render — the whole point of "neutral by default" is that the quiet
        // state still looks designed.
        ring: cssVar("--hairline") || FALLBACK_HAIRLINE,
        ringHairline: true,
      };
  }
}

/** Default category by device TYPE. Anything not listed here (and not caught by
 *  a device_class rule below) falls into "others". */
const DEFAULT_CATEGORY_BY_TYPE: Partial<Record<EntityType, Category>> = {
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
const CATEGORY_EXCEPTIONS: Partial<Record<string, Category>> = {
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
function categoryForEntity(entityId: string, type: EntityType, deviceClass?: string): Category {
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
