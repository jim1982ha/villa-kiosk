// src/utils/deviceActivity.ts
// THE module that owns how a device, and a group of devices, looks: the rule
// below (classifyDeviceActivity / badgeKindFor / badgeFace / badgeMarkOf /
// linkPillOf / meshLookFor), and since 2.496.245 its inputs too — `deviceLook(id, source)`
// and `groupLook(looks)` at the end of this file, which every badge, list row,
// room chip, group card and the "Needs attention" list ask.
//
// One place that turns a live HA entity into "on"/"off"/"alert"/"info" —
// used everywhere a device needs a coloured badge/ring: the 3D map badge
// (babylon/EntityVisuals.ts), the panel header icon (Dashboard.tsx) and the
// device-group list (SummaryGroupPanel.tsx) — all three through deviceLook.
// Exhaustive over EntityType: every domain must resolve its OWN "on" from
// its own state vocabulary — camera and assist_satellite are never
// literally "on". Does NOT handle "unavailable"/"unknown" — callers check
// that first (see isUnavailable), since it outranks this classification
// everywhere it's used.

import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping, EntityType } from "@/types/scene.types";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { alertIsFault, alertStateFor } from "@/config/BinarySensorClasses";
import { deviceTypeOf } from "@/config/EntityMap";
import { TRANSITIONAL_STATES, contactOf, statusKeyFor } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";
import type { SwitchPosition } from "@/utils/entityState";
import { phantomEntity } from "@/utils/phantomEntity";
import { domainOf } from "./entityDomain";
import { shownAsleep } from "@/ha/unavailableByDesign";

export type DeviceActivity = "on" | "off" | "alert" | "info";

/**
 * Everything a badge is painted from, as ONE argument.
 *
 * ⚠️ IT WAS THREE POSITIONAL PARAMETERS AND A MISSING FOURTH. Whether a
 * binary_sensor's reading is a problem depends on its `device_class` — which the old
 * `(type, entity, linkedOn)` could not express, so the badge answered a different
 * question from the panel that opens when you tap it. Adding a fourth optional
 * parameter would have reproduced the defect this repo keeps paying for: an
 * omission that looks exactly like "there is nothing to pass".
 *
 * ⚠️ `alertState` IS REQUIRED AND MAY BE `undefined`. "This entity has no
 * alarm state" is a statement the caller makes; forgetting to look is not.
 * It is resolved by readingOf (below) from a LookSource — no caller builds a
 * DeviceReading by hand any more.
 */
export interface DeviceReading {
  type: EntityType;
  entity: HassEntity;
  /** Does this device have a LINKED entity at all (EntityMapping.linkedEntityId) — its badge then carries the
   *  bottom-right pill (linkPillOf). */
  linked: boolean;
  /** Is the entity this one is LINKED to switched on — the pump behind a
   *  pump-power sensor. Held differently by each caller (the map keeps a live
   *  set, a panel reads the store), so the RULE is shared and not the plumbing.
   *  The bottom-right pill says it (owner, 2026-10-22) — never the face. */
  linkedOn: boolean;
  /** The LINKED entity's own reading (its own link never followed: one step, never a loop), or null — no linked
   *  entity, or one never reported. Its problem is the badge's BOTTOM-RIGHT pill, judged by the same badgeMarkOf
   *  (owner, 2026-10-22: "one corner per device" — a lock's door sensor reading Open put a red "!" in the lock's own
   *  top-right corner, and made the lock "alert"; it is the sensor's, and the sensor lists itself in "Needs
   *  attention"). */
  link: DeviceReading | null;
  /** The state that is a fault for this reading's device_class (alertStateFor). `undefined` means "this reading is
   *  never a fault". */
  alertState: string | undefined;
  /** On the villa's critical list (LookSource.config.isCritical — the list its "critical devices offline" rule
   *  watches, folded onto the device). Only matters once contact is lost: the mark turns red. */
  critical: boolean;
  /** Hidden in the villa's system (LookSource.config.isHidden — VillaDevices.isHidden): no device, so never red, never
   *  lost (badgeKindFor), and no badge on the map at all (drawsBadge). Required, like alertState: "not hidden" is
   *  said, never forgotten. */
  hidden: boolean;
  /** The device has an open Cockpit fault (LookSource.config.hasFault — attention kind "fault", folded onto the
   *  device): the amber "!" (owner, 2026-10-22: badge proposal 2 — the map showed nothing for it). */
  fault: boolean;
  /** Asleep by design and shown with its last report (ha/unavailableByDesign.shownAsleep): the grey "z". */
  asleep: boolean;
}

/** The five-way live-state reading a badge is painted from: this module's own
 *  four, plus "unavailable", which outranks all of them. */
export type BadgeKind = DeviceActivity | "unavailable";

/**
 * What is wrong with a device, as the badge's CORNER MARK says it — one at most, the first that is true, in this
 * order (owner, 2026-10-22: badge proposal 2, "Corner dot": the square says what the device does, the dot says what is
 * wrong):
 *
 *   critical  a critical device has lost contact   red "?"
 *   alarm     an alarm (an unlocked door, a leak, a low battery, a linked entity alerting)   red "!"
 *   fault     an open Cockpit fault                 amber "!"
 *   lost      contact lost                          grey "?"
 *   asleep    asleep by design, its last report shown   grey "z"
 *   moving    on its way between two rest states (TRANSITIONAL_STATES)   teal "…"
 *
 * No mark: all fine. The colours are one vocabulary with every other surface: red act now, amber check soon, grey no
 * contact, teal moving (EntityCategories.markSurface paints them).
 */
export type BadgeMark = "critical" | "alarm" | "fault" | "lost" | "asleep" | "moving";
export const MARK_ORDER: readonly BadgeMark[] = ["critical", "alarm", "fault", "lost", "asleep", "moving"];

/** The facts a mark is chosen from — each one independent, the ORDER decides (badgeMarkFor). */
export type MarkFacts = Record<BadgeMark, boolean>;

/** The one corner mark: the first true fact in MARK_ORDER, or null. Pure — tests/oracles/badge_mark.mjs. */
export function badgeMarkFor(f: MarkFacts): BadgeMark | null {
  for (const m of MARK_ORDER) if (f[m]) return m;
  return null;
}

/** The BOTTOM-RIGHT pill — everything about the linked entity in one place: its own problem (a BadgeMark, the same
 *  symbols and order as the top-right), else "on" (filled in the badge's colour) or "off" (hollow); null — no linked
 *  entity. */
export type LinkPill = BadgeMark | "on" | "off" | null;

/**
 * What a badge for this entity should be painted as — the ONE definition, for
 * the 3D map badge and for every DOM list that draws the same squircle.
 *
 * ── Why this is shared (2.206.0) ─────────────────────────────────────────
 * The map and the device-list panels drew the same badge from two different
 * rules. Both called classifyDeviceActivity, but only the map then applied
 * the LINKED-ENTITY override, so tapping a group of four pump-power sensors
 * showed four identical grey rows for badges that were coloured on the map two
 * pixels earlier — reported with exactly that pair of screenshots.
 *
 * ⚠️ A LINKED SWITCH ON NO LONGER MAKES THE DEVICE "ON" (owner, 2026-10-22: badge proposal 2). It did since
 * 2.496.240, so a pump-power sensor read "on" — face, room chip and all — whenever its relay ran. The badge's
 * bottom-right pill says that now (linkPillOf); the face and the kind are the device's own.
 * ⚠️ NOR DOES A LINKED ENTITY'S ALARM MAKE IT "ALERT" (owner, 2026-10-22: "one corner per device"): the kind is the
 * device's OWN reading; the linked entity's alarm is the bottom-right pill, and its own line in "Needs attention".
 */
export function badgeKindFor(r: DeviceReading): BadgeKind {
  // ⚠️ HIDDEN IS NO DEVICE, ON EVERY SURFACE (architecture review, 2026-10-21): the Cockpit, its counts and the update
  // pill leave a hidden device out, so nothing may paint it red or lost. The map now draws no badge for it
  // at all (drawsBadge, owner 2026-10-22: badge proposal 2); this quiet kind is what its 3D object (meshLookFor) and a
  // list that still names it read: what it does, never an alarm, never "contact lost".
  if (r.hidden) {
    const k = badgeKindFor({ ...r, hidden: false });
    return k === "alert" || k === "unavailable" ? "off" : k;
  }
  const contact = contactOf(r.entity.state);
  if (contact === "lost") return "unavailable";
  // nothing to say (unknown): quiet, as a device at rest — never "contact lost", never a lock's red
  if (contact === "no-value") return "off";
  return classifyDeviceActivity(r);
}

/**
 * The badge's FACE: what the device DOES, and nothing else — "off" (resting: neutral fill, glyph in its colour),
 * "active" (working: its colour's tint and ring) or "unavailable" (no trustworthy state: the resting look, faded, its
 * glyph grey — EntityCategories.categorySurface).
 *
 * ⚠️ A PROBLEM IS NEVER THE FACE (owner, 2026-10-22: badge proposal 2). An alarm painted the whole square red and lost
 * contact a dashed amber ring, so the face said "problem" and no longer what the device was doing; the corner mark
 * (badgeMarkOf) says the problem now. An alarming device keeps its activity look: an unlocked lock is open ("active"),
 * a leak sensor reading wet is on, a low battery reading is a reading (resting).
 */
export function badgeFace(r: DeviceReading): DeviceSurfaceState {
  const own = badgeKindFor(r);
  if (own === "unavailable") return "unavailable";
  if (own === "on") return "active";
  if (own !== "alert") return "off";
  // what an alarming device is DOING: a lock not locked is open; a binary_sensor reports on or off
  if (r.type === "lock") return "active";
  return r.entity.state === "on" ? "active" : "off";
}

/** The mark of ONE reading — its own facts only (badgeMarkFor over them). The badge's top-right pill is this applied to
 *  the device's reading; its bottom-right pill is this applied to its LINKED entity's (linkPillOf) — one precedence for
 *  both corners. A hidden device has none: it is no device. */
export function badgeMarkOf(r: DeviceReading): BadgeMark | null {
  if (r.hidden) return null;
  const lost = badgeKindFor(r) === "unavailable";
  return badgeMarkFor({
    critical: lost && r.critical,
    alarm: badgeKindFor(r) === "alert",
    fault: r.fault,
    lost,
    asleep: r.asleep,
    moving: TRANSITIONAL_STATES.has(r.entity.state),
  });
}

/** The badge's BOTTOM-RIGHT pill: its linked entity's own problem (badgeMarkOf over the linked reading — the same
 *  function as the top-right), else filled when it is on, hollow when off; none without a linked entity. */
export function linkPillOf(r: DeviceReading): LinkPill {
  if (!r.linked) return null;
  return (r.link ? badgeMarkOf(r.link) : null) ?? (r.linkedOn ? "on" : "off");
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

/**
 * How a device's own 3D MESH shows its reading — derived from the SAME
 * classification the badge is painted from, never from a second reading of
 * the state.
 *
 * ⚠️ THE MESH HAD ITS OWN COPY AND ONLY THE BADGE WAS FIXED (to 2.496.95).
 * EntityVisuals.applyToMesh tested the raw state itself: a lock was green when
 * `locked` and red otherwise, so it flashed red for the second a motorised
 * lock reports `locking` — the exact alarm the badge's TRANSITIONAL_STATES rule
 * had removed; a binary_sensor pulsed red on `on` whatever its device_class, so
 * every motion PIR pulsed like a leak while a `connectivity` sensor that went
 * OFF — its real alert — never did; a media_player glowed on `on` but not on
 * `buffering`. Now the mesh asks classifyDeviceActivity, as the badge does.
 *
 *   * `tint` — a lock's whole-mesh colour: secure, alert, or unavailable;
 *   * `pulse` — an alerting sensor's red pulse;
 *   * `glow` — an active switch/player's soft glow;
 *   * `dark` — no emissive at all (the baked marker glow must not show);
 *   * `none` — nothing to paint here (lights: BulbSet; covers: their pose).
 */
export type MeshLook =
  | { kind: "none" }
  | { kind: "dark" }
  | { kind: "glow"; on: boolean }
  | { kind: "pulse"; on: boolean; unavailable: boolean }
  | { kind: "tint"; tone: "secure" | "alert" | "unavailable" };

export function meshLookFor(r: DeviceReading): MeshLook {
  const kind = badgeKindFor(r);
  switch (r.type) {
    case "light":
    case "cover":
      return { kind: "none" };
    case "lock":
      return { kind: "tint", tone: kind === "unavailable" ? "unavailable" : kind === "alert" ? "alert" : "secure" };
    case "binary_sensor":
      return { kind: "pulse", on: kind === "alert", unavailable: kind === "unavailable" };
    case "switch":
    case "media_player":
      return { kind: "glow", on: kind === "on" };
    case "fan":
    case "sensor":
    case "climate":
      return { kind: "dark" };
    default:
      return { kind: "none" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LOOK OF A DEVICE, AND OF A GROUP OF DEVICES (2.496.245)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ THE RULE ABOVE WAS SHARED; ITS INPUTS WERE NOT. Every caller assembled its
// own DeviceReading, and `linkedOn` was resolved three ways: the map through
// devicePower (a linked lock UNLOCKED, a cover OPEN is on), the panel header
// through its optimistic switch, the device lists through a raw
// `state === "on"` — so a pump-power sensor whose linked lock was unlocked
// rang on the map and sat plain grey in the list one tap away. The alert
// override was looked up three times with three copies of the same call.
// `deviceLook` resolves BOTH itself, from a LookSource: the one thing a caller
// still supplies is where it keeps state (the map: a live cache fed by state
// events; a panel: the React store).
//
// ⚠️ TWO MEANINGS OF "ON", BOTH OWNED HERE, NEVER MERGED (devicePower.ts):
//   ACTIVITY  `active` — the device is doing something: what the badge face,
//             its ring and a room chip's ring say. An idle camera is active
//             (connected, capturing); a paused TV is not.
//   POWER     `power` / a group's `onCount` — the device is switched on: what
//             the "N on" counts say. Only switchable domains have one; a
//             sensor, a camera, a weather station are "none", never "on".
// A summary names which one it counts, by the field it reads.
//
// Pure: tests/oracles/device_look_source.mjs, tests/oracles/group_look.mjs.

/** Domains a person can SWITCH, whose "on" is what a count of "N on" counts:
 *  power switches, locks (unlocked), covers (open), climate (running),
 *  speakers. ⚠️ NOT SENSORS (owner, 2.496.238): a motion sensor "on" is
 *  someone passing, not something left on — under Access Control it read as
 *  "2 on" beside one unlocked door, and flickered every few seconds. */
const ON_OFF_DOMAINS: ReadonlySet<string> = new Set([
  "light", "switch", "fan", "input_boolean", "media_player", "lock", "cover", "climate",
]);

/** POWER: whether this device has an on/off at all. */
export function hasOnOff(entityId: string): boolean {
  return ON_OFF_DOMAINS.has(domainOf(entityId));
}

/** POWER: whether this device is switched on right now (devicePower's
 *  position). Unknown or unavailable is not on; a device without an on/off is
 *  never on. A locked lock is not on; a playing, paused or idle TV is. */
export function isSwitchedOn(entity: HassEntity | undefined, entityId: string): boolean {
  return hasOnOff(entityId) && devicePower(entity, entityId).position === "on";
}

/** A device's POWER as a summary counts it: devicePower's position, or "none"
 *  for a device that has no switch (hasOnOff). */
export type PowerState = SwitchPosition | "none";

/**
 * Where a caller keeps what a look is made of. Implemented ONCE for the React
 * store (storeLookSource, below) and once for the map's live cache
 * (EntityVisuals.lookSource) — every other caller takes one of the two.
 */
export interface LookSource {
  /** The entity's live state as this caller holds it; undefined = never
   *  reported (painted as unavailable, the phantom convention). */
  state(entityId: string): HassEntity | undefined;
  /** What the caller DRAWS this device as (the map: the mesh's resolved
   *  mapping; a list: the entity map, else the id's domain). */
  typeOf(entityId: string): EntityType;
  /** The entity map (for `linkedEntityId`) — resolved here, never by a caller. `isCritical`: is this device
   *  on the villa's critical list, folded onto its device (deviceGroups
   *  `devices.isCritical` — the predicate the Cockpit's red reads). Absent:
   *  nothing is critical (the Cockpit's own tiles, which say it themselves). */
  config: {
    entityMap: Record<string, EntityMapping>;
    isCritical?: (entityId: string) => boolean;
    /** Hidden in the villa's system (VillaDevices.isHidden, deviceGroups.hiddenIn). REQUIRED: a caller that forgot it
     *  painted a hidden device red where every other surface had dropped it. */
    isHidden: (entityId: string) => boolean;
    /** The device has an amber Cockpit issue, a fault or late maintenance (attention.deviceIssues, onto the device too):
     *  its amber "!" (owner, 2026-10-22: badge proposal 2). Absent: no fault is drawn (the Cockpit's own counts, which
     *  list the faults themselves). */
    hasFault?: (entityId: string) => boolean;
  };
  /** A linked switch the person has just thrown and Home Assistant has not yet
   *  confirmed: true/false while it is pending, undefined otherwise. Only the
   *  device panel's header passes it (useOptimisticToggle) — the header sits
   *  directly above that switch and a ring lagging its own switch looks broken;
   *  the map stays on confirmed state. */
  pendingPower?(entityId: string): boolean | undefined;
}

/** Everything a device looks like, from one place. */
export interface DeviceLook {
  type: EntityType;
  /** The badge FACE: what the device does (badgeFace) — never a problem colour. */
  face: DeviceSurfaceState;
  /** The badge's corner mark: what is wrong, one at most (badgeMarkOf). */
  mark: BadgeMark | null;
  /** The badge's bottom-right pill: its linked entity — its problem, else on/off (linkPillOf). */
  linkPill: LinkPill;
  /** badgeKindFor — the device's own five-way reading (a linked entity is never folded in since 2026-10-22: its
   *  problem reaches a summary through `linkPill`, see groupLook). */
  kind: BadgeKind;
  /** The device's own reading — what its mesh shows (the same as `kind` since 2026-10-22). */
  own: BadgeKind;
  /** ACTIVITY: doing something (kind "on"). An idle camera is active. */
  active: boolean;
  /** Its OWN reading is an alarm (the red "!" — a linked entity's alarm is the linked entity's line): what "Needs
   *  attention" lists. */
  alert: boolean;
  /** Home Assistant has lost it (or never reported it). */
  unavailable: boolean;
  /** A CRITICAL device that has lost contact (on the villa's critical list AND `unavailable`): red, never grey — its
   *  badge's mark, its room chip's number, its list row and its window's pill. */
  critical: boolean;
  /** It has an open Cockpit fault (LookSource.config.hasFault) — its room chip's number is amber for it. */
  fault: boolean;
  /** Hidden in the villa's system: the map draws no badge for it (drawsBadge). */
  hidden: boolean;
  /** POWER: its switch's position, "none" when it has no switch. */
  power: PowerState;
  /** Whether the entity it is LINKED to is on (devicePower: an unlocked lock,
   *  an open cover). */
  linkedOn: boolean;
}

/** The one DeviceReading for this device, its linked entity
 *  resolved from the source — what the mesh rule (meshLookFor) reads too. */
export function readingOf(entityId: string, source: LookSource): DeviceReading {
  const linkedId = source.config.entityMap[entityId]?.linkedEntityId;
  let linkedOn = false;
  let link: DeviceReading | null = null;
  if (linkedId) {
    const pending = source.pendingPower?.(linkedId);
    linkedOn = pending !== undefined
      ? pending
      : devicePower(source.state(linkedId), linkedId).position === "on";
    // the linked entity's OWN reading, by the one rule — its own link not followed (one step, never a loop). Never
    // reported: no reading, so its pill is a plain hollow one, not a "?" for an entity the map has not heard from yet.
    if (source.state(linkedId)) {
      const own = ownReadingOf(linkedId, source);
      // ⚠️ A DETECTION IS NO ALARM OF THE DEVICE IT IS LINKED TO (owner, 2026-10-22: a camera's motion sensor became
      // its linked entity). Its own badge reads someone passing as red (2026-10-21); on the camera's bottom-right pill
      // it is the camera doing its job — filled while motion is on, its other problems (lost, a fault…) kept. The same
      // line "Needs attention" draws (alertIsFault).
      link = alertIsFault(linkedId, own.entity.attributes.device_class as string | undefined)
        ? own : { ...own, alertState: undefined };
    }
  }
  return { ...ownReadingOf(entityId, source), linked: !!linkedId, linkedOn, link };
}

/** One entity's reading on its own facts, its link not followed. */
function ownReadingOf(entityId: string, source: LookSource): DeviceReading {
  const own = source.state(entityId);
  const entity = own ?? phantomEntity(entityId);
  return {
    type: source.typeOf(entityId),
    entity,
    linked: false,
    linkedOn: false,
    link: null,
    alertState: alertStateFor(entity.attributes.device_class as string | undefined),
    critical: source.config.isCritical?.(entityId) ?? false,
    hidden: source.config.isHidden(entityId),
    fault: source.config.hasFault?.(entityId) ?? false,
    asleep: shownAsleep(own),
  };
}

/** How this device looks — face, top-right mark, bottom-right pill, kind, ACTIVITY and POWER. */
export function deviceLook(entityId: string, source: LookSource): DeviceLook {
  const r = readingOf(entityId, source);
  const kind = badgeKindFor(r);
  const own = kind;
  const switchable = hasOnOff(entityId);
  return {
    type: r.type, face: badgeFace(r), mark: badgeMarkOf(r), linkPill: linkPillOf(r), kind, own,
    active: kind === "on",
    alert: own === "alert",
    unavailable: own === "unavailable",
    critical: r.critical && own === "unavailable",
    fault: r.fault && !r.hidden,
    hidden: r.hidden,
    power: switchable ? devicePower(source.state(entityId), entityId).position : "none",
    linkedOn: r.linkedOn,
  };
}

/**
 * Does the MAP draw a badge for this device at all? Not for one hidden in the villa's system (owner, 2026-10-22:
 * badge proposal 2 — it was drawn quiet): it is no device anywhere else, so its badge named something
 * no list had. Its 3D object stays as it is. And with no badge it is in no room chip's count either, as it is in no
 * list's (EntityVisuals.badgeEligible asks this).
 */
export function drawsBadge(entityId: string, source: LookSource): boolean {
  return !source.config.isHidden(entityId);
}

/**
 * The device whose badge `entityId` wears: the device it is the LINKED entity of (EntityMapping.linkedEntityId — a
 * pump's relay, a camera's detection switch), else itself. A linked entity placed on the map on its own draws the SAME
 * badge as its device — its pictogram, category and badge colour — its face from its own on/off, so the owner sees
 * what it controls (owner, 2026-10-22: badge proposal 2). The first device in the entity map that names it, when
 * several do (the order every link index here reads).
 */
export function badgeOwnerOf(entityId: string, entityMap: Readonly<Record<string, EntityMapping>>): string {
  for (const [id, m] of Object.entries(entityMap)) if (m.linkedEntityId === entityId && id !== entityId) return id;
  return entityId;
}

/** The React store's adapter: `entities` is HAStateStore's, `config` the
 *  live AppConfig. A device's type is its entity-map type, else its domain.
 *
 *  Two optional facts only the device panel's header holds: `drawnAs`, the
 *  type of the mapping the panel was opened with (a mesh binding may draw a
 *  device as something its entity map does not say), and `pendingPower`
 *  (see LookSource). */
export function storeLookSource(
  entities: Record<string, HassEntity>,
  config: LookSource["config"],
  opts: { drawnAs?: { entityId: string; type: EntityType }; pendingPower?: LookSource["pendingPower"] } = {},
): LookSource {
  const { drawnAs, pendingPower } = opts;
  return {
    state: (id) => entities[id],
    typeOf: (id) => deviceTypeOf(id, drawnAs?.entityId === id ? drawnAs : null, config.entityMap[id]),
    config,
    pendingPower,
  };
}

/** The map's adapter: EntityVisuals' live cache (every entity's last state,
 *  fed by state events — including entities with no badge of their own, like
 *  a linked switch) and the mapping each mesh resolved to. `config` is read
 *  through a getter because the map's config object is replaced on every edit. */
export function mapLookSource(
  cache: ReadonlyMap<string, HassEntity>,
  mapping: ReadonlyMap<string, { type: EntityType }>,
  config: () => LookSource["config"],
): LookSource {
  return {
    state: (id) => cache.get(id),
    typeOf: (id) => deviceTypeOf(id, mapping.get(id), config().entityMap[id]),
    get config() { return config(); },
  };
}

/** What a summary of several devices — a room chip, a group card, a Cockpit
 *  tile, a device list's header — shows. */
export interface GroupLook {
  /** Red ring: needs attention — a member alerting, or a CRITICAL member that
   *  lost contact (DeviceLook.critical). Never for "on" (owner, 2026-10-01: red
   *  is the Map-colours legend's "Needs attention"). */
  ringRed: boolean;
  /** The neutral "a member is on" ring (ACTIVITY), only when nothing is red. */
  ringOn: boolean;
  /** A member is on, whatever else is true — a ROOM CHIP's border, which no
   *  longer carries "needs attention" (that moved to its count, see
   *  summaryLook.roomHealth), so it must not lose "on" to a red it never draws. */
  anyOn: boolean;
  /** A member is unavailable — dimming is its own signal, never a ring. */
  unavailable: boolean;
  /** A member has an open Cockpit fault (DeviceLook.fault): a room's number is amber for it (summaryLook.roomHealth). */
  fault: boolean;
  /** POWER: how many are switched on ("N on"). */
  onCount: number;
  /** ACTIVITY: how many are doing something. */
  activeCount: number;
  /** How many Home Assistant has lost. */
  offline: number;
}

/**
 * The look of a group, from its members' looks. A member `null` / undefined is
 * one Home Assistant has not reported to this caller (the map's cache): it
 * rings nothing and counts nothing.
 *
 * The ring means two things, by what the summary draws:
 *   SHOWING ITS DEVICES  each cell carries its own mark, so the summary's may
 *     say only what is true of the WHOLE set: red iff every member's own mark
 *     is red (a card that went red because ONE of two cameras was armed
 *     claimed the pair was), and no "on" ring at all.
 *   DRAWING A COUNT      nothing inside says anything, so: red if ANY member's
 *     kind alerts; else the neutral "on" ring if any member is active.
 */
export function groupLook(
  members: readonly (DeviceLook | null | undefined)[],
  opts: { showingDevices: boolean },
): GroupLook {
  let anyAlert = false, everyRingAlert = members.length > 0, anyActive = false, unavailable = false, fault = false;
  let onCount = 0, activeCount = 0, offline = 0;
  for (const m of members) {
    if (!m) { everyRingAlert = false; continue; }
    // ⚠️ THE WORST OF BOTH CORNERS (owner, 2026-10-22: "one corner per device"): a linked entity's problem is the
    // badge's bottom-right pill, no longer folded into the device's own kind — but the room it sits in still says it
    // (a pump's relay lost: the room's number grey), as it did when the linked alarm rang the device itself.
    const link = m.linkPill;
    const linkRed = link === "alarm" || link === "critical";
    // a critical device that lost contact needs attention, as the Cockpit says (owner, 2026-10-19)
    if (m.kind === "alert" || m.critical || linkRed) anyAlert = true;
    if (m.kind === "on") anyActive = true;
    // a cell "rings red" when one of its pills is red: an alarm, or a critical device silent
    if (m.mark !== "alarm" && m.mark !== "critical" && !linkRed) everyRingAlert = false;
    if (m.kind === "unavailable" || link === "lost") unavailable = true;
    if (m.fault || link === "fault") fault = true;
    if (m.power === "on") onCount++;
    if (m.active) activeCount++;
    if (m.unavailable) offline++;
  }
  const ringRed = opts.showingDevices ? everyRingAlert : anyAlert;
  return {
    ringRed,
    ringOn: !opts.showingDevices && !ringRed && anyActive,
    anyOn: anyActive,
    unavailable, fault, onCount, activeCount, offline,
  };
}
