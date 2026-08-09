// src/utils/stateColors.ts
// Shared colour helpers for StateTimeline across the device panels — keeps
// on/off/danger colouring consistent with the existing .status-pill tones
// used elsewhere in the same panels.

import type { HassEntity } from "@/types/ha.types";

/** HA reports "unavailable" when it has lost contact with the device
 *  (offline, integration reload, …) and "unknown" when it's never reported a
 *  real value yet — in BOTH cases the entity's true state is NOT known, so a
 *  panel must never fold either into a definite on/off/locked/open reading.
 *  Every panel's binary state derivation (`entity?.state === "on"`, etc.)
 *  needs to check this FIRST — see LockPanel, the worst case: silently
 *  treating "unavailable" as "not locked" rendered a lock HA has lost contact
 *  with as a confirmed, alarming "UNLOCKED". */
export function isUnavailable(entity: HassEntity | undefined): boolean {
  return entity == null || entity.state === "unavailable" || entity.state === "unknown";
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
  /** Home Assistant has lost contact — state genuinely unknown. */
  unavailable: "var(--status-warning)",
  /** Needs attention. */
  alert: "var(--status-danger)",
} as const;

export type StatusKey = keyof typeof STATUS_COLOR;

const ON_COLOR = STATUS_COLOR.active;
const WARN_COLOR = STATUS_COLOR.unavailable;
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
  const s = state.trim().toLowerCase();
  if (s === "" || s === "unavailable" || s === "unknown" || s === "none") {
    return "unavailable";
  }
  if (domain) {
    const d = domain.split(".")[0];
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

/** binary_sensor: like the plain map above, but the device_class's "problem" state (if
 *  configured — see ThresholdConfig/BinarySensorClasses) reads as danger. */
export function binarySensorColor(state: string, alertState?: string): string {
  if (alertState !== undefined && state === alertState) return DANGER_COLOR;
  return STATUS_COLOR[statusKeyFor(state, "binary_sensor")];
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
    if (!map.has(s)) map.set(s, PALETTE[i++ % PALETTE.length]);
  }
  return (state: string) => map.get(state) ?? "var(--text-dim)";
}
