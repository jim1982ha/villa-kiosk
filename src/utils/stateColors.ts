// src/utils/stateColors.ts
// THE one table of status colours (STATUS_COLOR, below) and the reading of a state into its meaning: every pill,
// history bar, button, 3D object and legend swatch that colours a status reads it here.

import { domainOf } from "./entityDomain";
import { contactOf, UNKNOWN_STATES } from "./deviceHealth";

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

/**
 * THE status vocabulary: seven meanings, one colour each, defined here and nowhere else (owner, 2026-11-13: "one
 * colour code for every status"). The same table paints the state pill, the history bar, the On button, the 3D
 * object, the map, the Cockpit, the presence tile, the camera's bar and the "Map colours & keys" legend.
 *
 *   usual         green        alive, in its usual state: off, closed, locked, clear, disarmed, docked, idle
 *   active        red          on, doing something, nothing wrong: on, open, unlocked, motion seen, occupied, playing,
 *                              armed
 *   transitional  teal         moving, only while it moves: opening, closing, locking, arming, returning
 *   warn          amber        needs a look: a late maintenance, a state marked as a warning
 *   alert         purple       an alarm: a leak, smoke, jammed, a fault word, a critical device offline
 * ⚠️ SWAPPED (owner, 2026-11-15): usual was purple, active green, alarm red; a lock was its own exception (locked green,
 *  unlocked amber or red) and follows the table now like every device.
 *   unavailable   light grey   lost contact ("unavailable"), a plain colour, never striped
 *   noValue       empty track  nothing to show: "unknown", blank, "none", and history no longer kept
 *
 * ⚠️ ONE COLOUR IS "THE DEVICE IS ALIVE, AND REPORTING THE USUAL STATE" (owner, 2026-11-13), never a judgement: where a
 * state is a problem, its usual state is that colour and the problem amber or red. ⚠️ PURPLE, ACTIVE GREEN (owner, the
 * same evening: "consistently and globally invert" the two): the swap is these two lines and their tokens
 * (--status-usual, --status-active), nothing else. Until 2.496.792 "active" was green for
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
  usual: "var(--status-usual)",
  active: "var(--status-active)",
  /** A device DOING something on request, neither of the two rest states it sits between and emphatically not a
   *  fault: without it every transitional state fell onto lost contact's colour, so a lock's history read "lost
   *  contact" for the second or two it spent motoring. See TRANSITIONAL_STATES. */
  transitional: "var(--status-pending)",
  warn: "var(--status-warning)",
  alert: "var(--status-alarm)",
  /** The villa's system has lost contact ("unavailable"), never "unknown", a device answering with no value
   *  (contactOf "no-value": noValue). ⚠️ GREY, NO LONGER AMBER (owner, 2026-10-22: badge proposal 2), and LIGHT and
   *  PLAIN since 2026-11-13: the stripes it was drawn in were the chart's, not the state's. */
  unavailable: "var(--status-lost)",
  /** The track's own ground, so "nothing to show" and "not painted" are literally the same colour and cannot drift
   *  (owner, 2026-11-13: dark, far from the light grey of lost contact). */
  noValue: "var(--bg-input)",
} as const;

export type StatusKey = keyof typeof STATUS_COLOR;

/**
 * THE table's colours as the LIGHT theme's hexes — the ONE mirror of the status tokens (01-base.css, which define every
 * theme), for what cannot read a CSS variable (a baked canvas picture, a 3D material) or reads before the stylesheet
 * has painted (EntityCategories' fallbacks). ⚠️ NO SECOND COPY (owner, 2026-11-15: "the alarm colour must be defined
 * ONE time centrally"): the 3D colours, the room chip's pills and the badge marks all read it; tests/oracles/
 * colour_rules.mjs holds each value equal to its token. `noValue`: a mesh has no empty track, so the quiet
 * --status-off a resting object takes.
 */
export const STATUS_HEX: Record<StatusKey, string> = {
  usual: "#34845A",        // --status-usual
  active: "#B24232",       // --status-active
  transitional: "#2B67C0", // --status-pending
  warn: "#B8801F",         // --status-warning
  alert: "#6E57B8",        // --status-alarm
  unavailable: "#9A9F98",  // --status-lost
  noValue: "#D8D3C7",      // --status-off
};

/** A stretch older than what the villa's system keeps (NOT_KEPT, NO_RECORD): nothing to show, the empty track — its
 *  words say which ("No longer kept"). ⚠️ NO LONGER ITS OWN BLUE HAZE (owner, 2026-11-13: "nothing to show is the empty
 *  track"); its own colour since 2026-10-20 sat beside the grey of lost contact. */
export const NOT_KEPT_COLOR = STATUS_COLOR.noValue;

/** A critical device's reading (on the villa's critical list): its "needs a look" and its lost contact are an alarm
 *  (owner, 2026-11-13: "a critical door unlocked, a critical device offline" are red). Every other meaning stays. The
 *  one escalation, applied to the meaning before anything paints it, through the device's rule (statusRule). */
export function criticalStatus(key: StatusKey, critical: boolean): StatusKey {
  return critical && (key === "warn" || key === "unavailable") ? "alert" : key;
}

/** ONE DEVICE'S RULE for every status it shows: a state's meaning, once it is known whether its device is on the
 *  villa's critical list (criticalStatus: "needs a look" and lost contact are the alarm's red) or hidden in the villa's
 *  system (never red or amber anywhere: its alarm and its "needs a look" read as its usual state). The device's look
 *  carries it (deviceActivity.DeviceLook.statusRule); its badge, its 3D object, its room's number, the Cockpit's alarms
 *  and every pill of its window project what it says. */
export type StatusRule = (key: StatusKey) => StatusKey;

/** The rule of a device neither critical nor hidden (or before the villa is read): every meaning as it is. */
export const PLAIN_STATUS: StatusRule = (key) => key;

const HIDDEN_STATUS: StatusRule = (key) => (key === "alert" || key === "warn" ? "usual" : key);
const CRITICAL_STATUS: StatusRule = (key) => criticalStatus(key, true);

/** The rule of a device with these facts (hidden wins: it is no device anywhere). The COLOUR of every state it shows;
 *  a critical door left unlocked is red like any unlocked door here, its alarm raised apart
 *  (deviceActivity.ownReadingOf `status`, owner 2026-11-15). */
export function statusRule(facts: { critical: boolean; hidden: boolean }): StatusRule {
  return facts.hidden ? HIDDEN_STATUS : facts.critical ? CRITICAL_STATUS : PLAIN_STATUS;
}

/** The colour of a button that MOVES a device to `target` (its state as the villa's system names it: "unlocked",
 *  "open"): the colour of the state it leads to, from this table — "Unlock door…" amber (red for a critical door),
 *  "Lock door" and "Close" in the usual colour, "Open" in the active one. A button that SAYS a state (the power button)
 *  takes the state it says (PowerToggle). ⚠️ AN ACTION WEARS WHERE IT LEADS (owner, 2026-11-13: "Shall the `Unlock
 *  door` button colour be contextual to the `unlocked` colour state?"): it wore the app's green accent, a colour that
 *  says "on" on every other screen; a blind's buttons wore the device's category colour, an identity, never a state. */
export function actionColor(entityId: string, target: string, rule: StatusRule = PLAIN_STATUS): string {
  return STATUS_COLOR[rule(statusKeyFor(target, entityId))];
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
  // A lock follows the table like every device (owner, 2026-11-15): locked its usual state, unlocked in use (active),
  // critical or not; jammed the alarm (UNIVERSAL_STATES). `open` here is the latch being held open, NOT a cover's
  // "open" — the one state whose meaning genuinely inverts between two domains, and the reason this table has to be
  // domain-aware at all.
  lock: { locked: "usual", unlocked: "active", open: "active" },
  // part of the way open (panelRules.PARTIALLY_OPEN): the moving colour (owner, 2026-11-15)
  cover: { open: "active", closed: "usual", partially_open: "transitional" },
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
