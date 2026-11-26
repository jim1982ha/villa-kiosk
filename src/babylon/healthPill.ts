// src/babylon/healthPill.ts
// A room's count pill as the status table's colours (colors.ts's healthPill, moved here whole): plain hex strings,
// NO Babylon import, so the legend and the "Which room?" list can draw it on a device that shows the villa pictures
// and never downloads the 3D engine (owner, 2026-11-24).
import { STATUS_HEX_BY_THEME, themeInForce, type StatusKey } from "@/utils/stateColors";

/** A room's health as the status table's colour (summaryLook.roomHealth): an alarm and a fault both "needs attention"
 *  amber (owner, 2026-11-15; the alarm is listed first, roomHealth's order), all right the usual green (owner,
 *  2026-11-14: green for "all right"; since 2026-11-15 that IS the usual's colour). */
const HEALTH_STATUS = { alert: "warn", fault: "warn", unavailable: "unavailable", ok: "usual" } as const satisfies Record<string, StatusKey>;
/** The ink on each pill: white on the dark fills, dark on the light ones. */
const DARK_INK = "#17191A";

/** A room's count pill, by the room's HEALTH (summaryLook.roomHealth): amber — something needs attention (an alarm,
 *  a critical device silent, a device with an open fault); grey —
 *  contact with a device is lost; green — all right. ONE answer for the map
 *  chip (EntityVisuals.renderChips), the "Which room?" list (RoomChoiceSheet)
 *  and the legend.
 *
 *  The vocabulary's own colours, as the badges' corner marks (owner,
 *  2026-10-22: badge proposal 2): amber needs attention, grey no contact.
 *  2.496.265 briefly had red for the BORDER and amber/green here — two signals
 *  on one chip, which read as contradicting each other (owner, 2026-10-04).
 *
 *  The theme in force's values, like every colour in this file: the map chip's
 *  pill is a baked picture, re-baked on a theme change. Dark ink on the amber: white on it is 3.4:1, too
 *  faint for a digit this small; dark is 5.2:1. Dark on the light grey too (white on it is 2.6:1). White on the green is 4.6:1.
 *
 *  ⚠️ THE TABLE'S COLOURS (architecture review item 6, 2026-11-13): it typed its own four hexes beside STATUS_HEX. */
export function healthPill(health: "alert" | "fault" | "unavailable" | "ok"): { fill: string; ink: string } {
  const key = HEALTH_STATUS[health];
  return { fill: STATUS_HEX_BY_THEME[themeInForce()][key], ink: key === "warn" || key === "unavailable" ? DARK_INK : "#ffffff" };
}
