// src/babylon/colors.ts
// The status table's colours where a CSS variable cannot reach: a 3D material (STATUS_COLOR3) and a baked picture
// (the room chip's pill, healthPill). Room glows, outlines, pulses and badge rings each carried their own hand-picked
// red once; every one of them reads this, which reads the table's one mirror (stateColors.STATUS_HEX).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { STATUS_HEX, type StatusKey } from "@/utils/stateColors";

// ⚠️ NO HEX OF ITS OWN (owner, 2026-11-15: every colour of a meaning defined ONE time): the 3D colours and the baked
// pills read the status table's one light-theme mirror (stateColors.STATUS_HEX). The alarm's own ALERT_RED and its
// hex, a red until 2026-11-15, are gone: an alarm is STATUS_COLOR3.alert.

// "The villa's system has lost contact with this device — its state isn't known": distinct from the alarm (a
// confirmed, actionable state) on purpose — tinting an unavailable lock/sensor mesh as an alarm would assert a state
// never observed (EntityVisuals.applyToMesh). Grey, a fault's amber being "check soon" (owner, 2026-10-22).
export const LOST_GREY = Color3.FromHexString(STATUS_HEX.unavailable);

/** A room's health as the status table's colour (summaryLook.roomHealth): a fault is "needs a look", all right the
 *  usual green (owner, 2026-11-14: green for "all right"; since 2026-11-15 that IS the usual's colour), an alarm the
 *  alarm's purple. */
const HEALTH_STATUS = { alert: "alert", fault: "warn", unavailable: "unavailable", ok: "usual" } as const satisfies Record<string, StatusKey>;
/** The ink on each pill: white on the dark fills, dark on the light ones. */
const DARK_INK = "#17191A";

/** A room's count pill, by the room's HEALTH (summaryLook.roomHealth): the alarm's purple —
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
 *  faint for a digit this small; dark is 5.2:1. Dark on the light grey too (white on it is 2.6:1). White on the green is 4.6:1.
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
export const STATUS_COLOR3: Record<StatusKey, Color3> =
  Object.fromEntries(Object.entries(STATUS_HEX).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<StatusKey, Color3>;
