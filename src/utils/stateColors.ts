// src/utils/stateColors.ts
// THE one table of status colours (STATUS_COLOR, below) and the reading of a state into its meaning: every pill,
// history bar, button, 3D object and legend swatch that colours a status reads it here.

import type { HassEntity } from "@/types/ha.types";
import { domainOf } from "./entityDomain";
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

/** A history's stretch OLDER than what the villa's system still keeps of every change (its recorder's days): not a
 *  state the device was in, and never "unknown" or "unavailable" — historySource opens a window with it, a history
 *  bar paints it NOT_KEPT_COLOR and words it NOT_KEPT_WORDS (owner, 2026-10-20). */
export const NOT_KEPT = "\u0000not_kept";
export const NOT_KEPT_WORDS = "No longer kept";
/** A history's stretch BEFORE the device's first record (a sensor added this afternoon): not a state either, worded
 *  NO_RECORD_WORDS, painted NOT_KEPT_COLOR (owner, 2026-10-24: the presence chart's time before its stage sensor
 *  existed was the grey of "Empty", and read as an empty villa). */
export const NO_RECORD = "\u0000no_record";
export const NO_RECORD_WORDS = "No record yet";
/** Either stretch with nothing to show: never a state of the device, never in its palette or its "last seen". */
export const isNoHistory = (state: string): boolean => state === NOT_KEPT || state === NO_RECORD;

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

/** What every surface calls a device whose entity Home Assistant does not have at all — a 3D object named after an
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

/** Home Assistant does not have `id` — answered only once HA's list is loaded (an empty list is "not yet", never
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

/**
 * THE status vocabulary: seven meanings, one colour each, defined here and nowhere else (owner, 2026-11-13: "one
 * colour code for every status"). The same table paints the state pill, the history bar, the On button, the 3D
 * object, the map, the Cockpit, the presence tile, the camera's bar and the "Map colours & keys" legend.
 *
 *   usual         green        alive, in its usual state: off, closed, locked, clear, disarmed, docked, idle
 *   active        purple       on, doing something, nothing wrong: on, open, motion seen, occupied, playing, armed
 *   transitional  teal         moving, only while it moves: opening, closing, locking, arming, returning
 *   warn          amber        needs a look: a lock unlocked, a late maintenance, a state marked as a warning
 *   alert         red          an alarm: a leak, smoke, jammed, a fault word, a critical door unlocked or offline
 *   unavailable   light grey   lost contact ("unavailable"), a plain colour, never striped
 *   noValue       empty track  nothing to show: "unknown", blank, "none", and history no longer kept
 *
 * ⚠️ GREEN IS "THE DEVICE IS ALIVE, AND REPORTING THE USUAL STATE" (owner, 2026-11-13), never a judgement: where a
 * state is a problem, its usual state is green and the problem amber or red. Until 2.496.792 "active" was green for
 * on and "idle" the empty track for off, so a light off, a curtain closed and a sensor with no value were one colour;
 * 2.496.792 then gave a closed curtain the Access control category's purple ("shut"). ⚠️ A CATEGORY COLOUR (--cat-*)
 * IS NEVER A STATUS: it is a device's identity, on its icon tile only. Stripes are not a colour either: a chart's
 * period that mixed several states is striped in the colours it mixed (timelineCells.cellBackground), nothing else.
 *
 * Anything that paints a status reads it from here, or the legend becomes a lie (tests/oracles/colour_rules.mjs
 * holds every surface to it). The camera status bar was the case that proved it: it had its own literal `#000` for a
 * camera being offline while the legend told the user that losing contact was another colour.
 */
export const STATUS_COLOR = {
  usual: "var(--status-on)",
  active: "var(--status-active)",
  /** A device DOING something on request, neither of the two rest states it sits between and emphatically not a
   *  fault: without it every transitional state fell onto lost contact's colour, so a lock's history read "lost
   *  contact" for the second or two it spent motoring. See TRANSITIONAL_STATES. */
  transitional: "var(--status-pending)",
  warn: "var(--status-warning)",
  alert: "var(--status-danger)",
  /** The villa's system has lost contact ("unavailable"), never "unknown", a device answering with no value
   *  (contactOf "no-value": noValue). ⚠️ GREY, NO LONGER AMBER (owner, 2026-10-22: badge proposal 2), and LIGHT and
   *  PLAIN since 2026-11-13: the stripes it was drawn in were the chart's, not the state's. */
  unavailable: "var(--status-lost)",
  /** The track's own ground, so "nothing to show" and "not painted" are literally the same colour and cannot drift
   *  (owner, 2026-11-13: dark, far from the light grey of lost contact). */
  noValue: "var(--bg-input)",
} as const;

export type StatusKey = keyof typeof STATUS_COLOR;

/** A stretch older than what the villa's system keeps (NOT_KEPT, NO_RECORD): nothing to show, the empty track — its
 *  words say which ("No longer kept"). ⚠️ NO LONGER ITS OWN BLUE HAZE (owner, 2026-11-13: "nothing to show is the empty
 *  track"); its own colour since 2026-10-20 sat beside the grey of lost contact. */
export const NOT_KEPT_COLOR = STATUS_COLOR.noValue;

/** A critical device's reading (on the villa's critical list): its "needs a look" and its lost contact are an alarm
 *  (owner, 2026-11-13: "a critical door unlocked, a critical device offline" are red). Every other meaning stays. The
 *  one escalation every surface that knows a device is critical applies (config/reading.criticalPillTone,
 *  deviceActivity.meshLookFor, reading.lostColor). */
export function criticalStatus(key: StatusKey, critical: boolean): StatusKey {
  return critical && (key === "warn" || key === "unavailable") ? "alert" : key;
}

// ── The state → meaning map ───────────────────────────────────────────────
// The villa's system's own history colours states from a per-domain table, and its vocabulary is wider than the
// meanings this kiosk shows. Rather than import its palette (a second, unrelated set of hues in a deliberately
// narrow brand system), its DISTINCTIONS are mapped onto the VESTA vocabulary here.
//
// Lookup order, and each step exists for a reason:
//   1. unavailable / unknown / empty    — outranks everything, always
//   2. the entity's DOMAIN table        — where a domain disagrees below
//   3. the transitional and universal tables — states that mean the same everywhere
//   4. fall back to `usual`
//
// Step 4: a state no table names (a vendor's status word, a device type never seen) is the device reporting, so it is
// "alive, in its usual state" — never a fault and never lost contact, claims the data never made. The old helpers fell
// back to AMBER, so any state they did not enumerate read "lost contact". Entities whose states are not knowable ahead
// of time (a weather condition) should not reach here at all: paletteColorFor is the tool for those.

/** States that mean "mid-transition" — the device is moving between two rest
 *  states. Domain-independent: none of these words means anything else in any
 *  domain they are used in. Also consumed by babylon/meshVariants.ts to reach
 *  the virtual "half" pose, so the two cannot drift apart. */
export const TRANSITIONAL_STATES: ReadonlySet<string> = new Set([
  "opening", "closing", "locking", "unlocking", "arming", "disarming",
  "pending", "buffering", "returning", "returning_home", "docking",
]);

/** States whose meaning is the same in every domain they are used in. */
const UNIVERSAL_STATES: Record<string, StatusKey> = {
  on: "active",
  off: "usual",
  // presence / connectivity
  home: "active",
  not_home: "usual",
  detected: "active",
  clear: "usual",
  connected: "usual",
  // media / capture
  playing: "active",
  recording: "active",
  streaming: "active",
  paused: "usual",
  standby: "usual",
  idle: "usual",
  // motion
  running: "active",
  active: "active",
  cleaning: "active",
  mowing: "active",
  docked: "usual",
  // Known-bad readings. Deliberately the same list of words
  // utils/deviceActivity.ts already treats as an alert on the map badge and
  // the device list — one device reporting "fault" must not be a red badge
  // and a grey history segment.
  jammed: "alert",
  triggered: "alert",
  problem: "alert",
  alarm: "alert",
  tripped: "alert",
  error: "alert",
  fault: "alert",
  faulted: "alert",
  failed: "alert",
  fail: "alert",
  // A device REPORTING that it is offline/unreachable is an observation the
  // device successfully made — not the same thing as the villa's system having
  // lost contact with the entity (which is `unavailable`, handled above).
  offline: "alert",
  disconnected: "alert",
  unreachable: "alert",
  down: "alert",
  disabled: "alert",
};

/** Where a domain reads a state differently from the universal table. */
const DOMAIN_STATES: Record<string, Record<string, StatusKey>> = {
  // Locked is the usual, secure state; an unlocked door needs a look (a critical one is an alarm: criticalStatus).
  // `open` here is the latch being held open, NOT a cover's "open" — the one state whose meaning genuinely inverts
  // between two domains, and the reason this table has to be domain-aware at all.
  lock: { locked: "usual", unlocked: "warn", open: "warn" },
  cover: { open: "active", closed: "usual" },
  valve: { open: "active", closed: "usual" },
  alarm_control_panel: {
    disarmed: "usual",
    armed_home: "active",
    armed_away: "active",
    armed_night: "active",
    armed_vacation: "active",
    armed_custom_bypass: "active",
  },
  climate: {
    heat: "active", cool: "active", heat_cool: "active",
    auto: "active", dry: "active", fan_only: "active",
  },
  water_heater: {
    eco: "active", electric: "active", gas: "active", heat_pump: "active",
    high_demand: "active", performance: "active",
  },
  // A pending update is news, not a fault — the map badge treats it the same
  // way (classifyDeviceActivity's "info"), so neither shouts.
  update: { on: "active", off: "usual" },
};

/**
 * THE mapping from a state string to the VESTA status vocabulary. `domain` may be a bare domain ("lock") or a full
 * entity_id ("lock.front_door") — anything before the first dot is used.
 */
export function statusKeyFor(state: string, domain?: string): StatusKey {
  // ⚠️ COERCED, BECAUSE THE DECLARED TYPE IS A HOPE AND NOT A GUARANTEE. This
  // is called with values that came off the villa's system's wire through
  // `HAHistoryAPI`, and a freshly added entity has history rows whose `state`
  // is null — nothing upstream filters those out, so `.trim()` threw
  // `Cannot read properties of null` inside a React render and took the whole
  // panel to the error screen. Reported 2026-09-08: a newly added smoke
  // detector could not have its badge opened at all.
  //
  // ⚠️ AND NULL LANDS ON THE BLANK BRANCH, NOT IN `UNKNOWN_STATES`. The set is the FACT "this entity's value is not
  // known", read by `isUnavailable` and by every string reader below; a missing history row on a brand-new entity is
  // not an outage. A blank state and the literal "none" are an entity with nothing to report: noValue, as "unknown".
  //
  // ⚠️ "UNKNOWN" IS NO VALUE, NOT LOST (owner, 2026-10-19 — architecture review): contactOf calls it "no-value", a
  // device that answers with nothing to say. Only "unavailable" is lost contact.
  const s = String(state ?? "").trim().toLowerCase();
  if (s === "unavailable") return "unavailable";
  if (s === "" || s === "none" || s === "unknown") return "noValue";
  if (domain) {
    const d = domainOf(domain);
    const hit = DOMAIN_STATES[d]?.[s];
    if (hit) return hit;
  }
  if (TRANSITIONAL_STATES.has(s)) return "transitional";
  return UNIVERSAL_STATES[s] ?? "usual";
}

/**
 * The `colorFor` a StateTimeline wants, for an entity whose domain says how
 * to read its states. Pass the entity_id — the domain is taken from it, so a
 * panel cannot accidentally colour a lock's history with a cover's rules.
 */
export function historyStateColor(entityId: string): (state: string) => string {
  return (state: string) => STATUS_COLOR[statusKeyFor(state, entityId)];
}

/** The meaning of a switchable device's power button (a light, a fan, a switch, a player): its switch's position read
 *  from the table, as its history bar reads "on" and "off" — on active, off usual; a position the device cannot say
 *  (devicePower "unknown": no value, or moving) its state's own meaning. ⚠️ THE BIG ON BUTTON FOLLOWS THE STATE (owner,
 *  2026-11-13): it wore the device's category colour when on. */
export function powerStatus(position: "on" | "off" | "unknown", state: string | undefined, entityId: string): StatusKey {
  return position === "unknown" ? statusKeyFor(state ?? "", entityId) : statusKeyFor(position, entityId);
}

/**
 * The `.status-pill` modifier class for each meaning — the DOM counterpart of
 * STATUS_COLOR, so a panel picks its pill tone from the same reading of the
 * state that colours its history bar. Panels used to hand-write the ternary
 * (`locked ? "on" : "danger"`), which is where the misreport was most visible:
 * a lock spends a second or two "locking", which is not `locked`, so the pill
 * went red and read UNLOCKED every single time the door was secured.
 */
export const STATUS_PILL_CLASS: Record<StatusKey, string> = {
  usual: "usual",
  active: "active",
  transitional: "transitional",
  warn: "warn",
  alert: "danger",
  unavailable: "unavailable",
  noValue: "novalue",
};

/**
 * A binary_sensor's meaning. When it has a PROBLEM state — its device class's (leak, smoke, gas, tamper, a low
 * battery…: deviceCondition.windowProblemState) — that state is an alert and the OTHER one is the device alive in
 * its usual state: "usual", green. Without one (presence, motion, a door, a plug, a running pump): on is active, off
 * usual. Unavailable/unknown keep their own meaning.
 *
 * ⚠️ "NO LEAK" WAS GREY (owner, 2026-10-05): a leak sensor reporting no leak read "Off / idle", as if switched off,
 * when it is watching and finding nothing — the state an owner wants to see. ⚠️ AND AN OPEN DOOR OR A DETECTION IS
 * ACTIVE, NOT RED (owner, 2026-11-13): it was red in its window since 2026-10-26; red is an alarm.
 */
export function binaryStatus(state: string, alertState?: string): StatusKey {
  const plain = statusKeyFor(state, "binary_sensor");
  if (state !== "on" && state !== "off") return plain;
  if (alertState === "on" || alertState === "off") return state === alertState ? "alert" : "usual";
  return plain;
}

/** A text sensor's own values that the table does not name are SERIES, told apart by colour, never statuses: the brand
 *  accents, which carry no status meaning (as DeviceGroupPanel's series). */
const SERIES = ["var(--accent)", "var(--accent-warm)", "var(--accent-strong)", "var(--accent-teal)"];

/** The meaning a state word has wherever it is used (the transitional and universal tables), or undefined: a word
 *  only a device of its own uses ("sunny", "charging"). */
function knownStatus(state: string): StatusKey | undefined {
  return TRANSITIONAL_STATES.has(state) ? "transitional" : UNIVERSAL_STATES[state];
}

/**
 * Stable colour-per-distinct-state for an arbitrary text/enum sensor whose possible values aren't known ahead of time
 * (an access point's "connected"/"disconnected", a weather condition string, …): a word the table knows takes its
 * meaning's colour (a "disconnected" is red here as everywhere), any other a series colour in first-seen order,
 * cycling if there are more distinct words than colours.
 */
export function paletteColorFor(states: string[]): (state: string) => string {
  const map = new Map<string, string>();
  let i = 0;
  for (const s of states) {
    // ⚠️ NOT A VALUE (2.496.179): "unavailable"/"unknown" took a palette slot
    // like "connected" did, so an access point's lost stretches were painted
    // dark green inside its green bar (owner's screenshot). They are the one
    // meaning every chart shows in the legend's colour — see paintState.
    if (UNKNOWN_STATES.has(s) || map.has(s)) continue;
    const known = knownStatus(s);
    map.set(s, known ? STATUS_COLOR[known] : SERIES[i++ % SERIES.length]);
  }
  return paintState((state: string) => map.get(state) ?? "var(--text-dim)");
}

/**
 * Any chart's colouring, with the one rule every chart shares: an unavailable stretch is ALWAYS lost contact's colour
 * (STATUS_COLOR.unavailable), and an unknown one ALWAYS the empty track (noValue), whatever the device's own mapping
 * says. The timeline applies it to whatever `colorFor` it is given, so no panel can forget it (2.496.179).
 */
export function paintState(colorFor: (state: string) => string): (state: string) => string {
  return (state: string) => {
    if (!UNKNOWN_STATES.has(state)) return colorFor(state);
    return contactOf(state) === "lost" ? STATUS_COLOR.unavailable : STATUS_COLOR.noValue;
  };
}

/** Where a lock's bolt is, as every reader of a lock asks it: "thrown" (locked — the quiet, secure rest state), "open"
 *  (unlocked, or open: not secured, as the lock itself says), "jammed" (it said so: not secured, the retry stays
 *  offered), "moving" (locking / unlocking: on its way, nobody observed either rest state) or "unknown" (contact lost, or
 *  no value). Never "open" on anything short of the lock saying so.
 *
 *  ⚠️ FIVE ANSWERS (architecture review scan 2, 2026-10-19): the switch (entityState.switchPosition), the summary's
 *  counts (villaSummary), the lock window's header icon, its pill icon and its button each read the raw state their
 *  own way — the header showed an OPEN padlock for a jammed, locking or unavailable lock while the pill beside it
 *  showed a closed one, and the summary counted an "open" lock as neither locked nor unlocked. */
export type LockBolt = "thrown" | "open" | "jammed" | "moving" | "unknown";
export function lockBolt(state: string | undefined | null): LockBolt {
  if (contactOf(state) !== "ok") return "unknown";
  if (state === "locked") return "thrown";
  if (state === "unlocked" || state === "open") return "open";
  if (state === "jammed") return "jammed";
  return TRANSITIONAL_STATES.has(state as string) ? "moving" : "unknown";
}
