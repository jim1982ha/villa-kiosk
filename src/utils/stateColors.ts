// src/utils/stateColors.ts
// Shared colour helpers for StateTimeline across the device panels — keeps
// on/off/danger colouring consistent with the existing .status-pill tones
// used elsewhere in the same panels.

import type { HassEntity } from "@/types/ha.types";
import { domainOf } from "./entityDomain";

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
 *  bar paints it STATUS_COLOR.notKept and words it NOT_KEPT_WORDS (owner, 2026-10-20). */
export const NOT_KEPT = "\u0000not_kept";
export const NOT_KEPT_WORDS = "No longer kept";
/** Its colour: a neutral grey beside the status colours — never one of them, it says nothing of the device. */
export const NOT_KEPT_COLOR = "var(--not-kept)";   // its own colour, never Off's grey (owner, 2026-10-20)
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

/** Home Assistant does not have `id` — answered only once HA's list is loaded (an empty list is "not yet", never
 *  "every device is gone"). */
export function missingFromHa(entities: Record<string, HassEntity>, id: string): boolean {
  for (const _ in entities) return !entities[id];
  return false;
}

/**
 * THE status vocabulary — five meanings, one colour each, defined here and
 * nowhere else.
 *
 * This is what the "Map colours" legend documents to the user, so anything
 * that paints a status has to read it from here or the legend becomes a lie.
 * The camera status bar was the case that proved it: it had its own literal
 * `#000` for a camera being offline, while the legend told the user that
 * losing contact with a device is amber. Two answers to the same question,
 * neither aware of the other.
 */
export const STATUS_COLOR = {
  /** On / active. */
  active: "var(--status-on)",
  /** Off / idle / nothing to report. Deliberately the same token the
   *  timeline track and .status-pill.off already use, so "nothing happened"
   *  and "not painted" are literally the same colour and cannot drift. */
  idle: "var(--bg-input)",
  /** Moving between two rest states — opening, locking, arming, buffering.
   *  A device DOING something on request, which is neither of the two states
   *  it sits between and emphatically not a fault. This meaning was added
   *  because its absence was actively misreporting: every transitional state
   *  fell through the old per-domain helpers onto the amber below, so the
   *  history of a lock read "Home Assistant lost contact" for the second or
   *  two it spent motoring — the one reading that palette exists to keep
   *  separate. See TRANSITIONAL_STATES. */
  transitional: "var(--status-pending)",
  /** Home Assistant has lost contact ("unavailable") — never "unknown", which
   *  is a device answering with no value (contactOf "no-value": idle).
   *  ⚠️ GREY, NO LONGER AMBER (owner, 2026-10-22: badge proposal 2): amber is a
   *  fault, check soon; no contact is grey — the badge's grey "?", one
   *  vocabulary on every surface. */
  unavailable: "var(--status-lost)",
  /** Needs attention. */
  alert: "var(--status-danger)",
} as const;

export type StatusKey = keyof typeof STATUS_COLOR;

const ON_COLOR = STATUS_COLOR.active;
// A text sensor's third series colour — never a status meaning (paletteColorFor), so not STATUS_COLOR's.
const WARN_COLOR = "var(--status-warning)";
const DANGER_COLOR = STATUS_COLOR.alert;

// ── The state → meaning map ───────────────────────────────────────────────
// Home Assistant's own history/logbook colours states from a per-domain table
// (frontend `state_color.ts`), and its vocabulary is wider than the four
// meanings this kiosk started with. Rather than import HA's palette — which
// would drop a second, unrelated set of hues into a deliberately narrow brand
// system — its DISTINCTIONS are mapped onto the VESTA vocabulary here, with
// one new meaning (`transitional`) where HA genuinely draws a line that the
// four could not express.
//
// Lookup order, and each step exists for a reason:
//   1. unavailable/unknown/empty        — outranks everything, always
//   2. the entity's DOMAIN table        — where a domain disagrees below
//   3. the universal table              — states that mean the same everywhere
//   4. fall back to `idle`
//
// Step 4 is the fix, not a shrug. The old helpers fell back to AMBER, so any
// state they didn't enumerate was reported as "HA has lost contact" — a claim
// about the connection that the data never made. Falling back to idle matches
// what HA itself does (`stateActive()` returns false for anything not on its
// active list, painting --state-inactive-color), and idle is the timeline's
// own track colour, so an unmodelled state reads as "nothing to report"
// rather than as a fault. Entities whose states aren't knowable ahead of time
// (a weather condition, a vendor status string) shouldn't reach here at all —
// paletteColorFor is the tool for those.

/** States that mean "mid-transition" — the device is moving between two rest
 *  states. Domain-independent: none of these words means anything else in any
 *  domain HA uses them in. Also consumed by babylon/meshVariants.ts to reach
 *  the virtual "half" pose, so the two cannot drift apart. */
export const TRANSITIONAL_STATES: ReadonlySet<string> = new Set([
  "opening", "closing", "locking", "unlocking", "arming", "disarming",
  "pending", "buffering", "returning", "returning_home", "docking",
]);

/** States whose meaning is the same in every domain HA uses them in. */
const UNIVERSAL_STATES: Record<string, StatusKey> = {
  on: "active",
  off: "idle",
  // presence / connectivity
  home: "active",
  not_home: "idle",
  detected: "active",
  clear: "idle",
  connected: "active",
  // media / capture
  playing: "active",
  recording: "active",
  streaming: "active",
  paused: "idle",
  standby: "idle",
  idle: "idle",
  // motion
  running: "active",
  active: "active",
  cleaning: "active",
  mowing: "active",
  docked: "idle",
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
  // device successfully made — not the same thing as HA having lost contact
  // with the entity (which is `unavailable`, handled above and painted amber).
  offline: "alert",
  disconnected: "alert",
  unreachable: "alert",
  down: "alert",
  disabled: "alert",
};

/** Where a domain reads a state differently from the universal table. */
const DOMAIN_STATES: Record<string, Record<string, StatusKey>> = {
  // Locked is the normal, secure, quiet state; an unlocked door is what
  // demands attention. `open` here is the latch being held open, NOT a
  // cover's "open" — the one state whose meaning genuinely inverts between
  // two domains, and the reason this table has to be domain-aware at all.
  lock: { locked: "active", unlocked: "alert", open: "alert" },
  cover: { open: "active", closed: "idle" },
  valve: { open: "active", closed: "idle" },
  alarm_control_panel: {
    disarmed: "idle",
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
  humidifier: { on: "active", off: "idle" },
  media_player: { on: "active", off: "idle" },
  vacuum: { returning: "transitional", paused: "idle" },
  // A pending update is news, not a fault — the map badge treats it the same
  // way (classifyDeviceActivity's "info"), so neither shouts.
  update: { on: "active", off: "idle" },
};

/**
 * THE mapping from a Home Assistant state string to the VESTA status
 * vocabulary. `domain` may be a bare domain ("lock") or a full entity_id
 * ("lock.front_door") — anything before the first dot is used.
 */
export function statusKeyFor(state: string, domain?: string): StatusKey {
  // ⚠️ COERCED, BECAUSE THE DECLARED TYPE IS A HOPE AND NOT A GUARANTEE. This
  // is called with values that came off Home Assistant's wire through
  // `HAHistoryAPI`, and a freshly added entity has history rows whose `state`
  // is null — nothing upstream filters those out, so `.trim()` threw
  // `Cannot read properties of null` inside a React render and took the whole
  // panel to the error screen. Reported 2026-09-08: a newly added smoke
  // detector could not have its badge opened at all.
  //
  // ⚠️ AND NULL LANDS ON THE BLANK BRANCH, NOT IN `UNKNOWN_STATES`. The cheap
  // fix is to add it to that set, and it would be wrong: the set is the FACT
  // "this entity is unreachable", read by `isUnavailable` and by every string
  // reader below. A missing history row on a brand-new entity is not an
  // outage. Same colour, different fact.
  const s = String(state ?? "").trim().toLowerCase();
  // ⚠️ WIDER THAN `UNKNOWN_STATES` ON PURPOSE, and the two extra members stay
  // spelled out: a blank state and the literal `"none"` are not "the value is
  // unknown", they are an entity that has nothing to report. Same COLOUR, not
  // the same fact — converging them into the set would make `isUnavailable`
  // start answering true for them.
  //
  // ⚠️ "UNKNOWN" IS IDLE, NOT LOST (owner, 2026-10-19 — architecture review): contactOf calls it "no-value", a
  // device that answers with nothing to say, and its map badge sits quiet ("off"). Its history bar and its pill
  // were the amber "contact lost" all the same. Only "unavailable" (and the blank/"none" above) keeps the amber.
  if (s === "unknown") return "idle";
  if (s === "" || s === "none" || UNKNOWN_STATES.has(s)) {
    return "unavailable";
  }
  if (domain) {
    const d = domainOf(domain);
    const hit = DOMAIN_STATES[d]?.[s];
    if (hit) return hit;
  }
  if (TRANSITIONAL_STATES.has(s)) return "transitional";
  return UNIVERSAL_STATES[s] ?? "idle";
}

/**
 * The `colorFor` a StateTimeline wants, for an entity whose domain says how
 * to read its states. Pass the entity_id — the domain is taken from it, so a
 * panel cannot accidentally colour a lock's history with a cover's rules
 * (which would paint a locked door in the same green a cover uses for OPEN).
 */
export function historyStateColor(entityId: string): (state: string) => string {
  return (state: string) => STATUS_COLOR[statusKeyFor(state, entityId)];
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
  active: "on",
  idle: "off",
  transitional: "transitional",
  unavailable: "unavailable",
  alert: "danger",
};

/**
 * A binary_sensor's meaning. When it has a PROBLEM state — its device class's
 * (leak, smoke, gas, tamper, a low battery…) or the owner's own per-device
 * setting (BinarySensorClasses.alertStateFor) — that state is an alert and
 * the OTHER one is the device doing its job: "active", green.
 *
 * ⚠️ "NO LEAK" WAS GREY (owner, 2026-10-05): a leak sensor reporting no leak
 * read "Off / idle" on its pill and its history bar, as if it were switched
 * off, when it is watching and finding nothing — the state an owner wants to
 * see. Only a sensor with no problem state (presence, a plug, a running pump)
 * keeps on = active, off = idle. Unavailable/unknown keep their own meaning.
 *
 * ⚠️ AND A CLOSED DOOR IS GREEN (owner, 2026-10-05, a server door reading
 * grey while closed): an opening's and a lock sensor's problem state is "on"
 * (open, unlocked) since 2026-10-21, so its closed "off" is the device doing
 * its job — active, green, through the rule above. Its own "secure state"
 * branch, for a door that was not a problem, went with that decision.
 */
export function binaryStatus(state: string, alertState?: string): StatusKey {
  const plain = statusKeyFor(state, "binary_sensor");
  if (state !== "on" && state !== "off") return plain;
  if (alertState === "on" || alertState === "off") return state === alertState ? "alert" : "active";
  return plain;
}

const PALETTE = [ON_COLOR, "var(--accent)", WARN_COLOR, DANGER_COLOR, "var(--accent-strong)"];

/**
 * Stable colour-per-distinct-state for an arbitrary text/enum sensor whose
 * possible values aren't known ahead of time (e.g. an access point's
 * "connected"/"disconnected", a weather condition string, …) — first-seen
 * order, cycling the palette if there are more distinct states than colours.
 */
export function paletteColorFor(states: string[]): (state: string) => string {
  const map = new Map<string, string>();
  let i = 0;
  for (const s of states) {
    // ⚠️ NOT A VALUE (2.496.179): "unavailable"/"unknown" took a palette slot
    // like "connected" did, so an access point's lost stretches were painted
    // dark green inside its green bar (owner's screenshot). They are the one
    // meaning every chart shows in the legend's colour — see paintState.
    if (UNKNOWN_STATES.has(s)) continue;
    if (!map.has(s)) map.set(s, PALETTE[i++ % PALETTE.length]);
  }
  return paintState((state: string) => map.get(state) ?? "var(--text-dim)");
}

/**
 * Any chart's colouring, with the one rule every chart shares: an
 * unavailable stretch is ALWAYS the legend's "contact lost" colour
 * (STATUS_COLOR.unavailable), and an unknown one ALWAYS its quiet idle colour,
 * whatever the device's own mapping says. The timeline applies it to whatever
 * `colorFor` it is given, so no panel can forget it (2.496.179).
 *
 * ⚠️ UNKNOWN WAS AMBER TOO (to 2.496.427): a sensor with no value to give — its
 * device answering — drew "contact lost" minutes in its history bar while its
 * map badge sat quiet. contactOf owns the split: "lost" amber, "no-value" idle.
 */
export function paintState(colorFor: (state: string) => string): (state: string) => string {
  return (state: string) => {
    if (!UNKNOWN_STATES.has(state)) return colorFor(state);
    return contactOf(state) === "lost" ? STATUS_COLOR.unavailable : STATUS_COLOR.idle;
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
