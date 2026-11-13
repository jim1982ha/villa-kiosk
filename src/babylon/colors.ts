// src/babylon/colors.ts
// Single shared "active/alert" red. Room presence glow (RoomHighlight), a
// running climate device's mesh outline (EntityVisuals.applyClimateOutline)
// and the 2D badge's alert ring were each carrying their own independently
// hand-picked red — close but not identical — even though they're meant to
// read as the same signal ("this is actively alerting"). Import this instead
// of hardcoding a new Color3 wherever that signal shows up.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StatusKey } from "@/utils/stateColors";

// Matches --status-danger (light theme value — see colors.ts's file comment
// on why these are static, not a live theme read).
export const ALERT_RED = new Color3(0.7, 0.26, 0.2);
// Same colour as ALERT_RED, for the badge ring's Babylon GUI hex string API.
export const ALERT_RED_HEX = "#B24232";

// "The villa's system has lost contact with this device — its state isn't known." Distinct
// from ALERT_RED (a confirmed, actionable alarm) on purpose: tinting an
// unavailable lock/sensor mesh red would falsely assert a specific confirmed
// state (e.g. "unlocked") that was never actually observed — see
// EntityVisuals.applyToMesh's lock/binary_sensor cases, the bug this fixed
// (a lock that had lost contact rendered as a confident red "unlocked").
// ⚠️ GREY, NO LONGER AMBER (owner, 2026-10-22: badge proposal 2): amber is a fault — check soon — and grey "no
// contact", on every surface. Matches --status-lost (light theme) across the 2D panels for the same signal.
// ⚠️ LIGHTER (owner, 2026-11-13: lost contact is a plain light grey, far from the dark empty track of "nothing to show").
const LOST_GREY_HEX = "#9A9F98";
export const LOST_GREY = Color3.FromHexString(LOST_GREY_HEX);

// Same green as --status-on across the 2D panels ("this is reporting fine" /
// "available") — for the one place on the Babylon GUI side that needs it
// (the room-cluster chip's count pill, see EntityVisuals.updateClusters).
// A Babylon GUI control can't consume a CSS custom property, so this is a
// static match to the light-theme value rather than a live read.
export const AVAILABLE_GREEN_HEX = "#34845A";
// --status-usual (light theme): alive in its usual state (owner, 2026-11-13) — a room whose devices all report that is
// "all right" in this colour (healthPill "ok"), as their windows say it.
export const USUAL_HEX = "#6E57B8";
// --status-warning (light theme): a FAULT, check soon.
const FAULT_AMBER_HEX = "#B8801F";

/** The status vocabulary's colours (utils/stateColors.STATUS_COLOR) as light-theme hexes, one per meaning: what a baked
 *  picture (the room chip's pill) and a 3D object (STATUS_COLOR3) are painted from. */
const STATUS_HEX: Record<StatusKey, string> = {
  usual: USUAL_HEX,                 // --status-usual
  active: AVAILABLE_GREEN_HEX,      // --status-active
  transitional: "#1F7F8C",          // --status-pending
  warn: FAULT_AMBER_HEX,            // --status-warning
  alert: ALERT_RED_HEX,             // --status-danger
  unavailable: LOST_GREY_HEX,       // --status-lost
  // nothing to show: a mesh has no empty track, so the quiet --status-off a resting object takes
  noValue: "#D8D3C7",
};

/** A room's health as the status table's meaning (summaryLook.roomHealth): a fault is "needs a look", all right the usual. */
const HEALTH_STATUS = { alert: "alert", fault: "warn", unavailable: "unavailable", ok: "usual" } as const satisfies Record<string, StatusKey>;
/** The ink on each pill: white on the dark fills, dark on the light ones. */
const DARK_INK = "#17191A";

/** A room's count pill, by the room's HEALTH (summaryLook.roomHealth): red —
 *  something needs attention; amber — a device has an open fault; grey —
 *  contact with a device is lost; green — all right. ONE answer for the map
 *  chip (EntityVisuals.renderChips), the "Which room?" list (RoomChoiceSheet)
 *  and the legend.
 *
 *  The vocabulary's own colours, as the badges' corner marks (owner,
 *  2026-10-22: badge proposal 2): red act now, amber a fault, grey no contact.
 *  2.496.265 briefly had red for the BORDER and amber/green here — two signals
 *  on one chip, which read as contradicting each other (owner, 2026-10-04).
 *
 *  Static light-theme values, like every colour in this file: the map chip's
 *  pill is a baked picture. Dark ink on the amber: white on it is 3.4:1, too
 *  faint for a digit this small; dark is 5.2:1. Dark on the light grey too (white on it is 2.6:1).
 *
 *  ⚠️ THE TABLE'S COLOURS (architecture review item 6, 2026-11-13): it typed its own four hexes beside STATUS_HEX. */
export function healthPill(health: "alert" | "fault" | "unavailable" | "ok"): { fill: string; ink: string } {
  const key = HEALTH_STATUS[health];
  return { fill: STATUS_HEX[key], ink: key === "warn" || key === "unavailable" ? DARK_INK : "#ffffff" };
}

/** The status vocabulary's colours (utils/stateColors.STATUS_COLOR) for a 3D object, light-theme values like every
 *  colour here: a mesh shows the status its device's window shows, in that window's colour (owner, 2026-11-04: "always
 *  consistent with the device status"). It had its own: a locked lock a brighter green than its pill, an unlocked one
 *  a teal glow beside a red "Unlocked". The same keys as STATUS_COLOR, one value each (tests/oracles/colour_rules.mjs). */
export const STATUS_COLOR3: Record<StatusKey, Color3> = {
  ...(Object.fromEntries(Object.entries(STATUS_HEX).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<StatusKey, Color3>),
  // the alarm's red as every 3D red already is (ALERT_RED, a hair from its hex)
  alert: ALERT_RED,
  unavailable: LOST_GREY,
};
