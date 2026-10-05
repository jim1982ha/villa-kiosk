// src/babylon/colors.ts
// Single shared "active/alert" red. Room presence glow (RoomHighlight), a
// running climate device's mesh outline (EntityVisuals.applyClimateOutline)
// and the 2D badge's alert ring were each carrying their own independently
// hand-picked red — close but not identical — even though they're meant to
// read as the same signal ("this is actively alerting"). Import this instead
// of hardcoding a new Color3 wherever that signal shows up.
import { Color3 } from "@babylonjs/core/Maths/math.color";

// Matches --status-danger (light theme value — see colors.ts's file comment
// on why these are static, not a live theme read).
export const ALERT_RED = new Color3(0.7, 0.26, 0.2);
// Same colour as ALERT_RED, for the badge ring's Babylon GUI hex string API.
export const ALERT_RED_HEX = "#B24232";

// "HA has lost contact with this device — its state isn't known." Distinct
// from ALERT_RED (a confirmed, actionable alarm) on purpose: tinting an
// unavailable lock/sensor mesh red would falsely assert a specific confirmed
// state (e.g. "unlocked") that was never actually observed — see
// EntityVisuals.applyToMesh's lock/binary_sensor cases, the bug this fixed
// (a lock HA had lost contact with rendered as a confident red "unlocked").
// Matches --status-warning's amber across the 2D panels for the same signal.
export const UNAVAILABLE_AMBER = new Color3(0.72, 0.5, 0.12);

// Same green as --status-on across the 2D panels ("this is reporting fine" /
// "available") — for the one place on the Babylon GUI side that needs it
// (the room-cluster chip's count pill, see EntityVisuals.updateClusters).
// A Babylon GUI control can't consume a CSS custom property, so this is a
// static match to the light-theme value rather than a live read.
export const AVAILABLE_GREEN_HEX = "#34845A";
// The same amber as UNAVAILABLE_AMBER (--status-warning, light theme), as a
// hex for the pill below.
export const UNAVAILABLE_AMBER_HEX = "#B8801F";

/** A room's count pill, by the room's HEALTH (summaryLook.roomHealth): red —
 *  something needs attention; amber — Home Assistant lost a device; green —
 *  all right. ONE answer for the map chip (EntityVisuals.renderChips), the
 *  "Which room?" list (RoomChoiceSheet) and the legend.
 *
 *  The vocabulary's own colours: red is "Needs attention" and amber "lost
 *  contact" everywhere else (badge rings, panel status, legend). 2.496.265
 *  briefly had red for the BORDER and amber/green here — two signals on one
 *  chip, which read as contradicting each other (owner, 2026-10-04).
 *
 *  Dark ink on the amber: white on it is 3.4:1 against the green's 4.6:1, too
 *  faint for a digit this small; dark is 5.2:1, and dark-on-amber is the usual
 *  look of a warning. */
export function healthPill(health: "alert" | "unavailable" | "ok"): { fill: string; ink: string } {
  return health === "alert" ? { fill: ALERT_RED_HEX, ink: "#ffffff" }
    : health === "unavailable" ? { fill: UNAVAILABLE_AMBER_HEX, ink: "#17191A" }
    : { fill: AVAILABLE_GREEN_HEX, ink: "#ffffff" };
}

// A 3D lock mesh that is SECURE (locked, or on its way to a rest state) — the
// green it has always been drawn in, named here beside the other status
// colours rather than written as a literal in EntityVisuals.applyToMesh.
export const SECURE_GREEN = new Color3(0.2, 0.75, 0.3);
// A switch or media player that is ON: a soft glow on its own mesh.
export const ACTIVE_GLOW = new Color3(0.1, 0.35, 0.4);
