// src/utils/deviceActivity.ts
// One place that turns a live HA entity into "on"/"off"/"alert"/"info" —
// used everywhere a device needs a coloured badge/ring: the 3D map badge
// (babylon/EntityVisuals.ts, which additionally overlays its own
// linkActiveIds signal for a linked entity), the panel header icon
// (Dashboard.tsx) and the device-group list (SummaryGroupPanel.tsx).
// Exhaustive over EntityType: every domain must resolve its OWN "on" from
// its own state vocabulary — camera and assist_satellite are never
// literally "on". Does NOT handle "unavailable"/"unknown" — callers check
// that first (see isUnavailable), since it outranks this classification
// everywhere it's used.

import type { HassEntity } from "@/types/ha.types";
import { isUnavailable } from "./stateColors";
import type { EntityType } from "@/types/scene.types";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { TRANSITIONAL_STATES } from "@/utils/stateColors";

export type DeviceActivity = "on" | "off" | "alert" | "info";

/** The five-way live-state reading a badge is painted from: this module's own
 *  four, plus "unavailable", which outranks all of them. */
export type BadgeKind = DeviceActivity | "unavailable";

// Maps that 5-way classification onto the 4-row surface table VESTA-DESIGN.md
// §0 defines (config/EntityCategories.categorySurface, consumed by
// badgeIcons.ts's baked squircle): "on" is that table's "active"; "info" (a
// plain reading with no on/off concept — e.g. a temperature sensor) reads as
// "off", neutral, since nothing is actively happening.
export const SURFACE_STATE: Record<BadgeKind, DeviceSurfaceState> = {
  on: "active", alert: "alert", info: "off", off: "off", unavailable: "unavailable",
};

/**
 * What a badge for this entity should be painted as — the ONE definition, for
 * the 3D map badge and for every DOM list that draws the same squircle.
 *
 * ── Why this is shared (2.206.0) ─────────────────────────────────────────
 * The map and the device-list panels drew the same badge from two different
 * rules. Both called classifyDeviceActivity, but only the map then applied
 * the LINKED-ENTITY override: an entity whose `linkedEntityId` is on rings as
 * "alert", which is how a pump's power sensor shows that its pump is running.
 * The panel had no equivalent, so tapping a group of four pump-power sensors
 * showed four identical grey rows for badges that were red on the map two
 * pixels earlier — reported with exactly that pair of screenshots.
 *
 * `linkedOn` is passed in rather than resolved here because the two callers
 * hold that fact differently: the map keeps a live set fed by state events
 * (EntityVisuals.linkActiveIds), a panel reads the linked entity out of the
 * store it already has. The RULE is what has to be shared, not the plumbing.
 */
export function badgeKindFor(type: EntityType, s: HassEntity, linkedOn: boolean): BadgeKind {
  if (isUnavailable(s)) return "unavailable";
  // Outranks the entity's own state vocabulary on purpose — see linkedEntityId.
  if (linkedOn) return "alert";
  return classifyDeviceActivity(type, s);
}

/**
 * The badge's two independent readings: what its FACE says, and what its RING
 * says.
 *
 * ── Why they were one, and why that was wrong (2.214.0) ───────────────────
 * `linkedEntityId` has always been documented as driving a device's RING, but
 * it was applied by forcing the whole badge to "alert" — so an armed camera
 * went red edge to edge and its purple camera pictogram went with it. Two
 * unrelated facts ("this camera is recording" and "its detection is armed")
 * were competing for one set of pixels, and the glyph — the thing that says
 * what the device even is — lost.
 *
 * They are separate now. The FACE is the device's own state and nothing else,
 * so a camera stays its category colour whether armed or not. The RING carries
 * the linked signal, which is what a ring is for.
 *
 * `unavailable` is the exception and stays whole-badge: a device Home
 * Assistant has lost contact with has no trustworthy state to paint a face
 * from, so claiming one — in any colour — would assert something never
 * observed. It takes the amber dashed ring AND the muted face together.
 */
export function badgeFaceAndRing(
  type: EntityType, s: HassEntity, linkedOn: boolean,
): { face: DeviceSurfaceState; ring: DeviceSurfaceState } {
  const own = badgeKindFor(type, s, false);
  if (own === "unavailable") return { face: "unavailable", ring: "unavailable" };
  const face = SURFACE_STATE[own];
  return { face, ring: linkedOn ? "alert" : face };
}

/* ⚠️ `badgeSurfaceFor` WAS DELETED HERE (2026-08-28), and how it survived is
 * the point. It resolved `badgeKindFor` straight to the surface row "for the
 * callers that only ever want the painted state" — there were none, and there
 * never had been. It stayed invisible to /dry-audit's unused-export probe
 * because `Dashboard.tsx` carried a comment crediting "the ONE shared rule
 * (deviceActivity.badgeSurfaceFor)" beside code that calls `badgeFaceAndRing`,
 * and the probe counted that prose as a consumer. A wrong sentence kept a dead
 * function alive by hiding it from the tool that looks for dead functions.
 * Both are fixed; the probe now strips comments. Git has the body. */

// A known-bad enum/status reading — the value stays shown and the badge
// rings red/alerts, so a real change is never silently swallowed. An
// unrecognised value (e.g. a weather "sunny") is neither: shown as "info",
// un-ringed.
const SENSOR_ALERT_STATES = new Set([
  "disconnected", "offline", "error", "fault", "faulted", "failed", "fail",
  "unreachable", "down", "disabled", "problem", "alarm", "tripped",
]);

export function classifyDeviceActivity(type: EntityType, s: HassEntity): DeviceActivity {
  switch (type) {
    // Locked is the normal, secure state — quiet, no signal. Only an
    // unlocked door demands attention (alert, not a plain "on").
    //
    // "Not locked" is NOT the same question as "unlocked", though, and
    // conflating them made the badge flash a red alert for the second or two
    // a motorised lock spends reporting "locking" — an alarm raised by the
    // door securing itself. A lock in motion is quiet: it is on its way to a
    // rest state and the map already shows the movement through its pose
    // variant (see meshVariants, which shares TRANSITIONAL_STATES with the
    // status palette). "jammed" still alerts — it is a real fault.
    case "lock":
      if (s.state === "locked") return "off";
      return TRANSITIONAL_STATES.has(s.state) ? "off" : "alert";
    case "binary_sensor": return s.state === "on" ? "alert" : "off";
    case "climate":       return s.state === "off" ? "off" : "on";
    case "cover": {
      const pos = s.attributes.current_position as number | undefined;
      if (pos != null) return pos > 0 ? "on" : "off";
      return s.state === "closed" ? "off" : "on";
    }
    case "media_player":  return s.state === "playing" || s.state === "buffering" ? "on" : "off";
    // A camera reporting "idle" is CONNECTED and capturing — idle is Home
    // Assistant's word for "streaming on demand rather than continuously", not
    // for "off". Treating it as off left every working camera drawn in the
    // resting grey, so the map never showed its cameras as live. A camera that
    // is genuinely down is `unavailable`, which callers resolve before this.
    case "camera":
      return s.state === "idle" || s.state === "recording" || s.state === "streaming"
        ? "on" : "off";
    case "assist_satellite": return s.state === "idle" ? "off" : "on"; // listening/processing/responding
    case "sensor":
      return SENSOR_ALERT_STATES.has(s.state.trim().toLowerCase()) ? "alert" : "info";
    default:              return s.state === "on" ? "on" : "off"; // light/fan/switch/input_boolean
  }
}
