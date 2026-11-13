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
export const LOST_GREY = new Color3(0.42, 0.44, 0.42);

// Same green as --status-on across the 2D panels ("this is reporting fine" /
// "available") — for the one place on the Babylon GUI side that needs it
// (the room-cluster chip's count pill, see EntityVisuals.updateClusters).
// A Babylon GUI control can't consume a CSS custom property, so this is a
// static match to the light-theme value rather than a live read.
export const AVAILABLE_GREEN_HEX = "#34845A";
// --status-warning (light theme): a FAULT, check soon — as a hex for the pill below.
const FAULT_AMBER_HEX = "#B8801F";
// --status-lost (light theme): no contact — the same grey as LOST_GREY, as a hex for the pill below.
const LOST_GREY_HEX = "#6B706B";

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
 *  faint for a digit this small; dark is 5.2:1. White on the grey is 5.1:1. */
export function healthPill(health: "alert" | "fault" | "unavailable" | "ok"): { fill: string; ink: string } {
  return health === "alert" ? { fill: ALERT_RED_HEX, ink: "#ffffff" }
    : health === "fault" ? { fill: FAULT_AMBER_HEX, ink: "#17191A" }
    : health === "unavailable" ? { fill: LOST_GREY_HEX, ink: "#ffffff" }
    : { fill: AVAILABLE_GREEN_HEX, ink: "#ffffff" };
}

/** The status vocabulary's colours (utils/stateColors.STATUS_COLOR) for a 3D object, light-theme values like every
 *  colour here: a mesh shows the status its device's window shows, in that window's colour (owner, 2026-11-04: "always
 *  consistent with the device status"). It had its own: a locked lock a brighter green than its pill, an unlocked one
 *  a teal glow beside a red "Unlocked". */
export const STATUS_COLOR3: Record<StatusKey, Color3> = {
  active: Color3.FromHexString("#34845A"),        // --status-on
  idle: Color3.FromHexString("#D8D3C7"),          // --status-off
  transitional: Color3.FromHexString("#1F7F8C"),  // --status-pending
  shut: Color3.FromHexString("#6B5AA6"),          // --cat-access-control
  unavailable: LOST_GREY,                         // --status-lost
  alert: ALERT_RED,                               // --status-danger
};
