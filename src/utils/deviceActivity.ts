// src/utils/deviceActivity.ts
// THE module that owns how a device, and a group of devices, looks: the rule
// below (classifyDeviceActivity / badgeKindFor / badgeFaceAndRing /
// meshLookFor), and since 2.496.245 its inputs too — `deviceLook(id, source)`
// and `groupLook(looks)` at the end of this file, which every badge, list row,
// room chip, group card, Cockpit tile and the "Needs attention" list ask.
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
import type { Threshold } from "@/config/ThresholdConfig";
import { alertStateFor } from "@/config/BinarySensorClasses";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { TRANSITIONAL_STATES, UNKNOWN_STATES, statusKeyFor } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";
import type { SwitchPosition } from "@/utils/entityState";
import { phantomEntity } from "@/utils/phantomEntity";
import { domainOf } from "./entityDomain";

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
 * It is resolved by readingOf (below) from a LookSource — no caller builds a
 * DeviceReading by hand any more.
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
 * the LINKED-ENTITY override: an entity whose `linkedEntityId` is on counts as
 * "on" (2.496.240; it was "alert"), which is how a pump's power sensor shows that
 * its pump is running.
 * The panel had no equivalent, so tapping a group of four pump-power sensors
 * showed four identical grey rows for badges that were red on the map two
 * pixels earlier — reported with exactly that pair of screenshots.
 *
 * `linkedOn` is resolved ONCE, by readingOf (below), through devicePower and
 * whichever LookSource the caller holds — the map's live cache or the store.
 * It was "passed in because the callers hold it differently", and they then
 * resolved it three different ways (2.496.245).
 */
export function badgeKindFor(r: DeviceReading): BadgeKind {
  if (UNKNOWN_STATES.has(r.entity.state)) return "unavailable";
  // Outranks the entity's own state vocabulary on purpose — see linkedEntityId.
  // ⚠️ "ON", NEVER "ALERT" (owner, 2026-10-01): a pump's power sensor whose relay
  // runs is a device ON. As "alert" it rang every room chip and count card that
  // holds it red — the Map-colours legend's "Needs attention" — while nothing
  // was wrong (the Swimming Pool chip, its jet pump running).
  if (r.linkedOn) return "on";
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
 *
 * ── The linked ring is the badge's OWN colour, never red (2.496.239) ───────
 * It was "alert" — the --status-danger red the Map colours legend reserves for
 * "Needs attention" (an unlocked door, a leak). A linked switch being on is
 * not a problem, so a power badge whose relay was on wore the alarm colour.
 * Owner: the ring takes the badge's category colour (or its own badge colour)
 * — categorySurface's "active" ring, the same hue as its pictogram.
 */
export function badgeFaceAndRing(
  r: DeviceReading,
): { face: DeviceSurfaceState; ring: DeviceSurfaceState } {
  const own = badgeKindFor({ ...r, linkedOn: false });
  if (own === "unavailable") return { face: "unavailable", ring: "unavailable" };
  const face = SURFACE_STATE[own];
  // A face already alerting keeps its red ring: that IS needs-attention.
  return { face, ring: r.linkedOn && face !== "alert" ? "active" : face };
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
  const kind = badgeKindFor({ ...r, linkedOn: false });
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
  /** The entity map (for `linkedEntityId`) and the villa's per-entity alert
   *  overrides — resolved here, never by a caller. */
  config: { entityMap: Record<string, EntityMapping>; alertThresholds: Record<string, Threshold> };
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
  /** The badge FACE: the device's own state (badgeFaceAndRing). */
  face: DeviceSurfaceState;
  /** The badge RING: its linked entity's signal, else the face. */
  ring: DeviceSurfaceState;
  /** badgeKindFor — the one five-way reading a COUNT summary rings from
   *  (the linked signal folded in). */
  kind: BadgeKind;
  /** The device's own reading, without its linked entity — what its mesh shows. */
  own: BadgeKind;
  /** ACTIVITY: doing something (kind "on"). An idle camera is active. */
  active: boolean;
  /** Red on the map: its face needs attention. */
  alert: boolean;
  /** Home Assistant has lost it (or never reported it). */
  unavailable: boolean;
  /** POWER: its switch's position, "none" when it has no switch. */
  power: PowerState;
  /** Whether the entity it is LINKED to is on (devicePower: an unlocked lock,
   *  an open cover). */
  linkedOn: boolean;
}

/** The one DeviceReading for this device, alert override and linked entity
 *  resolved from the source — what the mesh rule (meshLookFor) reads too. */
export function readingOf(entityId: string, source: LookSource): DeviceReading {
  const entity = source.state(entityId) ?? phantomEntity(entityId);
  const linkedId = source.config.entityMap[entityId]?.linkedEntityId;
  let linkedOn = false;
  if (linkedId) {
    const pending = source.pendingPower?.(linkedId);
    linkedOn = pending !== undefined
      ? pending
      : devicePower(source.state(linkedId), linkedId).position === "on";
  }
  return {
    type: source.typeOf(entityId),
    entity,
    linkedOn,
    alertState: alertStateFor(
      entity.attributes.device_class as string | undefined,
      source.config.alertThresholds[entityId]?.alertState),
  };
}

/** How this device looks — face, ring, kind, ACTIVITY and POWER. */
export function deviceLook(entityId: string, source: LookSource): DeviceLook {
  const r = readingOf(entityId, source);
  const { face, ring } = badgeFaceAndRing(r);
  const kind = badgeKindFor(r);
  const own = badgeKindFor({ ...r, linkedOn: false });
  const switchable = hasOnOff(entityId);
  return {
    type: r.type, face, ring, kind, own,
    active: kind === "on",
    alert: face === "alert",
    unavailable: own === "unavailable",
    power: switchable ? devicePower(source.state(entityId), entityId).position : "none",
    linkedOn: r.linkedOn,
  };
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
    typeOf: (id) => (drawnAs?.entityId === id ? drawnAs.type : undefined)
      ?? config.entityMap[id]?.type ?? inferTypeFromEntityId(id) ?? "sensor",
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
    typeOf: (id) => mapping.get(id)?.type ?? config().entityMap[id]?.type ?? inferTypeFromEntityId(id) ?? "sensor",
    get config() { return config(); },
  };
}

/** What a summary of several devices — a room chip, a group card, a Cockpit
 *  tile, a device list's header — shows. */
export interface GroupLook {
  /** Red ring: needs attention. Never for "on" (owner, 2026-10-01: red is the
   *  Map-colours legend's "Needs attention"). */
  ringRed: boolean;
  /** The neutral "a member is on" ring (ACTIVITY), only when nothing is red. */
  ringOn: boolean;
  /** A member is on, whatever else is true — a ROOM CHIP's border, which no
   *  longer carries "needs attention" (that moved to its count, see
   *  summaryLook.roomHealth), so it must not lose "on" to a red it never draws. */
  anyOn: boolean;
  /** A member is unavailable — dimming is its own signal, never a ring. */
  unavailable: boolean;
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
 *   SHOWING ITS DEVICES  each cell carries its own ring, so the summary's may
 *     say only what is true of the WHOLE set: red iff every member's own ring
 *     is "alert" (a card that went red because ONE of two cameras was armed
 *     claimed the pair was), and no "on" ring at all.
 *   DRAWING A COUNT      nothing inside says anything, so: red if ANY member's
 *     kind alerts; else the neutral "on" ring if any member is active.
 */
export function groupLook(
  members: readonly (DeviceLook | null | undefined)[],
  opts: { showingDevices: boolean },
): GroupLook {
  let anyAlert = false, everyRingAlert = members.length > 0, anyActive = false, unavailable = false;
  let onCount = 0, activeCount = 0, offline = 0;
  for (const m of members) {
    if (!m) { everyRingAlert = false; continue; }
    if (m.kind === "alert") anyAlert = true;
    if (m.kind === "on") anyActive = true;
    if (m.ring !== "alert") everyRingAlert = false;
    if (m.kind === "unavailable") unavailable = true;
    if (m.power === "on") onCount++;
    if (m.active) activeCount++;
    if (m.unavailable) offline++;
  }
  const ringRed = opts.showingDevices ? everyRingAlert : anyAlert;
  return {
    ringRed,
    ringOn: !opts.showingDevices && !ringRed && anyActive,
    anyOn: anyActive,
    unavailable, onCount, activeCount, offline,
  };
}
