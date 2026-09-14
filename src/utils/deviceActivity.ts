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
import type { EntityType } from "@/types/scene.types";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { TRANSITIONAL_STATES, statusKeyFor } from "@/utils/stateColors";

export type DeviceActivity = "on" | "off" | "alert" | "info";

/**
 * Everything a badge is painted from, as ONE argument.
 *
 * ⚠️ IT WAS THREE POSITIONAL PARAMETERS AND A MISSING FOURTH. Whether a
 * binary_sensor's reading is a problem depends on its `device_class` and on
 * the villa's own per-entity override — neither of which the old
 * `(type, entity, linkedOn)` could express, so the badge answered a different
 * question from the panel that opens when you tap it. Adding a fourth optional
 * parameter would have reproduced the defect this repo keeps paying for: an
 * omission that looks exactly like "there is nothing to pass".
 *
 * ⚠️ `alertState` IS REQUIRED AND MAY BE `undefined`. "This entity has no
 * override" is a statement the caller makes; forgetting to look is not.
 * Resolve it with `alertStateFor(device_class, config.alertThresholds[id]?.alertState)`.
 */
export interface DeviceReading {
  type: EntityType;
  entity: HassEntity;
  /** Is the entity this one is LINKED to switched on — the pump behind a
   *  pump-power sensor. Held differently by each caller (the map keeps a live
   *  set, a panel reads the store), so the RULE is shared and not the plumbing. */
  linkedOn: boolean;
  /** The villa's per-entity alert override, already resolved against the
   *  device_class default. `undefined` means "this reading is never a fault". */
  alertState: string | undefined;
}

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
export function badgeKindFor(r: DeviceReading): BadgeKind {
  if (r.entity.state === "unavailable" || r.entity.state === "unknown") return "unavailable";
  // Outranks the entity's own state vocabulary on purpose — see linkedEntityId.
  if (r.linkedOn) return "alert";
  return classifyDeviceActivity(r);
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
  r: DeviceReading,
): { face: DeviceSurfaceState; ring: DeviceSurfaceState } {
  const own = badgeKindFor({ ...r, linkedOn: false });
  if (own === "unavailable") return { face: "unavailable", ring: "unavailable" };
  const face = SURFACE_STATE[own];
  return { face, ring: r.linkedOn ? "alert" : face };
}

/* ⚠️ `badgeSurfaceFor` IS GONE (had zero callers). It resolved `badgeKindFor`
   straight to a surface row for "callers that only ever want the painted
   state", and every one of them had since moved to `badgeFaceAndRing` for the
   ring. Deletion test: complexity did not even move. */

/* ⚠️ `SENSOR_ALERT_STATES` IS GONE, AND ITS DELETION IS THE FIX. It was a
   private set of thirteen words, sitting beside a comment in `stateColors`
   claiming the two lists were "deliberately the same". They were not: the
   status table also carries `jammed` and `triggered`, which this one lacked,
   so a sensor reporting `triggered` drew a red history segment under a badge
   that did not ring. One table now answers, and it is the one the Map-colours
   legend documents. */

export function classifyDeviceActivity({ type, entity: s, alertState }: DeviceReading): DeviceActivity {
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
    // Resolved through the device_class, NOT through a bare `state === "on"`.
    // See alertStateFor: a motion PIR is informational and reads as plain
    // "on", a leak sensor alerts, and `connectivity` alerts when it goes OFF.
    case "binary_sensor":
      if (alertState !== undefined && s.state === alertState) return "alert";
      return s.state === "on" ? "on" : "off";
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
    // The status vocabulary owns which readings are faults — `statusKeyFor`
    // normalises and consults the same table the history bar and the legend
    // read. An unrecognised value (a weather "sunny") is "info": shown,
    // un-ringed, never silently swallowed.
    case "sensor":
      return statusKeyFor(s.state, "sensor") === "alert" ? "alert" : "info";
    default:              return s.state === "on" ? "on" : "off"; // light/fan/switch/input_boolean
  }
}
