// src/utils/deviceHealth.ts
// IS THE VILLA'S SYSTEM IN CONTACT WITH THIS DEVICE: answered once, over ALL of the device's parts (architecture review
// item 4, 2026-11-13). A device is alive, partly lost (it answers, and some of its parts do not: which ones) or lost.
// Every list (the offline devices, the Cockpit's cards), every sign (a window's warning) and every colour (a badge's
// grey "?", a room's grey number) reads it; the colour module (utils/stateColors) only paints what this says.
//
// ⚠️ A DEVICE THAT WORKS WITH A DEAD PART SHOWED NOTHING (owner, 2026-11-13): a camera's person detection had been
// unavailable for days while the camera streamed, and no card, badge or sign said so: the offline list asked only the
// entity standing for each device, and contact was answered by four helpers in the colour module and again by the
// condition and the badge. The helpers live here now, with the reading over the device's parts.

import type { HassEntity } from "@/types/ha.types";
import { momentText } from "./dateText";

/** HA reports "unavailable" when it has lost contact with the device
 *  (offline, integration reload, …) and "unknown" when it's never reported a
 *  real value yet — in BOTH cases the entity's true state is NOT known, so a
 *  panel must never fold either into a definite on/off/locked/open reading.
 *  Every panel's binary state derivation (`entity?.state === "on"`, etc.)
 *  needs to check this FIRST — see LockPanel, the worst case: silently
 *  treating "unavailable" as "not locked" rendered a lock HA has lost contact
 *  with as a confirmed, alarming "UNLOCKED". */
/** The two states in which an entity's true value is NOT known.
 *
 *  ⚠️ NAMED BECAUSE THE PAIR WAS WRITTEN OUT SEVEN TIMES ON THIS BRANCH.
 *  `isUnavailable` below answers the question for a `HassEntity`, and two
 *  callers had it inline because they had one — but four more work on a bare
 *  state STRING (a history point, a merged status map, a camera's own status)
 *  where the predicate does not fit, so the shared thing that reaches all of
 *  them is the SET, not the function. This subsystem's most-repeated defect
 *  shape is one literal copied to each reader with nothing between them. */
export const UNKNOWN_STATES: ReadonlySet<string> = new Set(["unavailable", "unknown"]);

export function isUnavailable(entity: HassEntity | undefined): boolean {
  return entity == null || UNKNOWN_STATES.has(entity.state);
}

/** A device the villa's system has LOST CONTACT with: "unavailable", or an entity it does not have at all — never
 *  "unknown", a sensor with no value to give while its device reports (a wind chill on a warm day, a switch's gesture
 *  sensor between gestures). What every "is this device offline" list asks; isUnavailable stays the question "can a
 *  value be shown".
 *
 *  ⚠️ THE COCKPIT AND THE AGENT DISAGREED (owner, 2026-10-18 — architecture review, offline devices #4): the Cockpit
 *  listed every "unknown" device as Unavailable while the VESTA Agent, since 2026-10-04, calls only "unavailable"
 *  lost. One meaning now, the Agent's. */
export function isOffline(entity: HassEntity | undefined): boolean {
  return contactOf(entity?.state) === "lost";
}

/** Where a state stands with its device: "lost" (unavailable, or no state at all), "no-value" (unknown: the device
 *  reports, this entity has nothing to say), "ok". ⚠️ ONE ANSWER FOR THE MAP AND THE COCKPIT (architecture review
 *  scan 1, 2026-10-19): since 2.496.410 the Cockpit called only "unavailable" offline, while the map still rang an
 *  "unknown" sensor amber ("Contact is lost", the legend says), its row read "Unavailable", the device picker said
 *  offline — and a lock in "unknown" was painted red. Every "is contact lost" reader asks this, on a state string too
 *  (a history point, a camera's status). */
export function contactOf(state: string | undefined | null): "lost" | "no-value" | "ok" {
  return !state || state === "unavailable" ? "lost" : state === "unknown" ? "no-value" : "ok";
}

/** What every surface calls a device whose entity the villa's system does not have at all — a 3D object named after an
 *  entity that was renamed or removed (owner, 2026-10-14: the model is the ground truth, and the Kiosk says so
 *  everywhere: Needs attention, the device's window, Advanced Settings). */
export const NOT_IN_HA = "Missing";

/** What the villa's system's history says of a Missing device: when it left it (epoch ms, historySource.lastRecorded:
 *  the moment VESTA's "missing since" names too), null when it has no record of it (never there, or gone longer than
 *  it keeps), "unknown" when the history could not be read. */
export type MissingSeen = number | null | "unknown";

/** What a Missing device's window says: what the villa's system knows of it, and what to do. Its 3D object (`inModel`)
 *  can be renamed, removed or pointed elsewhere (Edit); anything else (a fault raised on a device since deleted,
 *  opened from its Cockpit card) only went away in the villa's system. ⚠️ NOT ALWAYS A 3D OBJECT (owner, 2026-10-25:
 *  "i don't have any devices named light.gym_light in the GLB file"): the window said "Rename or remove its object in
 *  the 3D model" for a deleted light whose only trace was a cleared fault.
 *  ⚠️ NOT ALWAYS THE MODEL'S FAULT (owner, 2026-10-31: "the door lock entity should exist, no?"): a lock that had
 *  worked for weeks was dropped by the villa's system at night, when its hub stopped sharing it, and the window
 *  pointed at the 3D model. A device the history has seen (`seen`) went away THERE: it says when, and what to check. */
export function missingAdvice(inModel: boolean, seen: MissingSeen): string {
  if (typeof seen === "number") {
    // ⚠️ VESTA'S WORDS AND MOMENT (architecture review 2026-10-31 #1): "last seen" gave another time than Telegram's
    // "missing from the villa's system since"
    return `The villa's system no longer has this device: it has been missing since ${momentText(seen)}; `
      + (inModel
        ? "its device may have been removed from the villa's system: check that it is still connected there. "
          + "If it comes back with another name, point this object at it with Edit."
        : "it was renamed or removed in the villa's system.");
  }
  if (seen === null) {
    return inModel
      ? "The villa's system has no record of this device. Rename or remove its object in the 3D model, "
        + "or point it at another device with Edit."
      : "The villa's system has no record of this device: it was renamed or removed there.";
  }
  return inModel
    ? "The villa's system does not have this device. If it was removed there, check that it is still connected; "
      + "otherwise rename or remove its object in the 3D model, or point it at another device with Edit."
    : "The villa's system does not have this device: it was renamed or removed there.";
}

/** The villa's system does not have `id` — answered only once its list is loaded (an empty list is "not yet", never
 *  "every device is gone"). */
export function missingFromHa(entities: Record<string, HassEntity>, id: string): boolean {
  for (const _ in entities) return !entities[id];
  return false;
}

/** Has `id` lost contact: its state is lost (isOffline), or the villa's system no longer has it at all (missingFromHa)
 *  — and never before the villa's system has sent its states (an empty list is "not yet").
 *  ⚠️ ONE ANSWER FOR THE DEVICE LIST AND ITS FAULTS (2026-10-31): the villa's offline devices asked isOffline of a
 *  missing state, true even before any state had come (every device of the model "Unavailable" for that moment), while
 *  a fault on one asked this rule written out inline. */
export function lostContact(entities: Record<string, HassEntity>, id: string): boolean {
  const e = entities[id];
  return e ? isOffline(e) : missingFromHa(entities, id);
}

// ── A device's parts ───────────────────────────────────────────────────────

/** The other entities of each device that count for its health, by the entity standing for it: what the fold puts
 *  under it (deviceGroups.deviceFolding: the owner's groups, the device registry, the parts of a whole). Built from the
 *  config and the registry only, never per state push. Empty: a device of one entity. */
export type PartsOf = (deviceId: string) => readonly string[];

export const NO_PARTS: PartsOf = () => [];

/** THE parts of each device (PartsOf): what its health asks (its card and its "?" for a dead one) AND what "Also on
 *  this device" lists of it (deviceGroups.deviceReadings, its readings among them) — one set, so a dead part listed
 *  there is the part that gets the card. Never one a person hid in the villa's system (`hidden`), never one it files
 *  as configuration or diagnostic (`suppressed`: a restart button, a signal strength, normally unavailable or noise)
 *  unless the owner grouped it (`chosen`: an owner's group member) or it is a BATTERY (`batteries`: a level to act on,
 *  filed as diagnostic by most integrations), never one switched off in Advanced Settings (`disabled`). A device
 *  nobody placed on the map (no fold: neither `placed` nor folded) has the other entities of its device in the
 *  villa's system (`entityDeviceIds`) that are folded nowhere. A part the villa's system sends no state for (disabled
 *  there, or removed) is no part: lostParts never asks it.
 *
 *  ⚠️ TWO DEFINITIONS OF "A DEVICE'S PARTS" (architecture review item 8, 2026-11-14): "Also on this device" kept a
 *  diagnostic battery and its own registry siblings, the health dropped the battery, so a dead battery was listed
 *  Unavailable in the window with no card and no "?". One builder now, and the battery is a part on both sides. */
export function partsOfFolding(folding: ReadonlyMap<string, string>, opts: {
  suppressed: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  chosen: ReadonlySet<string>;
  disabled: (entityId: string) => boolean;
  batteries: ReadonlySet<string>;
  entityDeviceIds: Readonly<Record<string, string>>;
  placed: (entityId: string) => boolean;
}): PartsOf {
  const counts = (part: string) => !opts.hidden.has(part) && !opts.disabled(part)
    && (!opts.suppressed.has(part) || opts.chosen.has(part) || opts.batteries.has(part));
  const add = (m: Map<string, string[]>, key: string, part: string) => {
    const list = m.get(key);
    if (list) list.push(part); else m.set(key, [part]);
  };
  const parts = new Map<string, string[]>();
  for (const [part, device] of folding) if (part !== device && counts(part)) add(parts, device, part);
  // a device nobody placed: its registry device's entities folded nowhere
  const unplaced = new Map<string, string[]>();
  for (const [id, dev] of Object.entries(opts.entityDeviceIds)) if (!folding.has(id) && !opts.placed(id) && counts(id)) add(unplaced, dev, id);
  for (const list of [...parts.values(), ...unplaced.values()]) list.sort();
  return (id) => parts.get(id)
    ?? (folding.has(id) || opts.placed(id) ? [] : (unplaced.get(opts.entityDeviceIds[id]) ?? []).filter((p) => p !== id));
}


/** The parts of `deviceId` the villa's system has lost contact with ("unavailable"), in id order: never "unknown" (a
 *  part with no value to give is answering), never a part it sends no state for. `state`: each entity's state as the
 *  caller holds it (the store, the map's cache). */
export function lostParts(deviceId: string, partsOf: PartsOf, state: (entityId: string) => HassEntity | undefined): string[] {
  return partsOf(deviceId).filter((p) => { const e = state(p); return !!e && isOffline(e); });
}

/** THE health of a device: "lost" (the entity standing for it has lost contact, or the villa's system no longer has
 *  it: lostContact), "partly" (it answers, and these parts do not: `lost`), "alive". */
export type DeviceHealth =
  | { kind: "alive" }
  | { kind: "partly"; lost: readonly string[] }
  | { kind: "lost" };

const ALIVE: DeviceHealth = { kind: "alive" };
const LOST: DeviceHealth = { kind: "lost" };

export function deviceHealth(deviceId: string, entities: Record<string, HassEntity>, partsOf: PartsOf): DeviceHealth {
  if (lostContact(entities, deviceId)) return LOST;
  const lost = lostParts(deviceId, partsOf, (p) => entities[p]);
  return lost.length ? { kind: "partly", lost } : ALIVE;
}

/** A part's own name, without its device's: "Person detection" for "Storage camera Person detection" on the device
 *  "Storage camera" — the words it shares at its start with one of the device's names (its label, its own name in the
 *  villa's system), the most of them, when something is left. Its whole name otherwise. */
export function partName(part: string, device: readonly (string | undefined)[]): string {
  const a = part.split(/\s+/);
  let n = 0;
  for (const name of device) {
    const b = (name ?? "").split(/\s+/);
    let k = 0;
    while (k < a.length - 1 && k < b.length && a[k].toLowerCase() === b[k].toLowerCase()) k++;
    n = Math.max(n, k);
  }
  const rest = a.slice(n).join(" ");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** What a device's card says of its lost parts, by their names (partName): "Person detection unavailable", "Motion,
 *  Person detection unavailable", "4 parts unavailable" past three — one line per device, its grey state pill. */
export function lostPartsWords(names: readonly string[]): string {
  return `${names.length > 3 ? `${names.length} parts` : names.join(", ")} unavailable`;
}
