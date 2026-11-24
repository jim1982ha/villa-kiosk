// src/babylon/colors.ts
// The status table's colours where a CSS variable cannot reach: a 3D material (STATUS_COLOR3) and a baked picture
// (the room chip's pill, healthPill). Room glows, outlines, pulses and badge rings each carried their own hand-picked
// red once; every one of them reads this, which reads the table's one mirror (stateColors.STATUS_HEX_BY_THEME).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { STATUS_HEX_BY_THEME, themeInForce, type StatusKey } from "@/utils/stateColors";

// ⚠️ NO HEX OF ITS OWN (owner, 2026-11-15: every colour of a meaning defined ONE time): the 3D colours and the baked
// pills read the status table's one mirror (stateColors.STATUS_HEX_BY_THEME), in the theme in force (owner,
// 2026-11-22, colour code rule 7; they were the light theme's on every map). The alarm's own ALERT_RED is gone: an
// alarm is STATUS_COLOR3.warn, the amber of "needs attention" (owner, 2026-11-15: urgency is a pulse).


// A room's count pill (healthPill) is a picture, not a 3D colour: it lives in ./healthPill, which imports no Babylon, so
// the lists that draw it (the legend, "Which room?") are loaded by a device that never downloads the 3D engine (the
// villa pictures, owner 2026-11-24). Re-exported here for the 3D side's readers.
export { healthPill } from "./healthPill";

/** The status vocabulary's colours (utils/stateColors.STATUS_COLOR) for a 3D object, the theme in force's
 *  (syncStatusTheme): a mesh shows the status its device's window shows, in that window's colour (owner, 2026-11-04: "always
 *  consistent with the device status"). It had its own: a locked lock a brighter green than its pill, an unlocked one
 *  a teal glow beside a red "Unlocked". The same keys as STATUS_COLOR, one value each (tests/oracles/colour_rules.mjs). */
export const STATUS_COLOR3: Record<StatusKey, Color3> =
  Object.fromEntries(Object.entries(STATUS_HEX_BY_THEME.light).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<StatusKey, Color3>;

/** Set STATUS_COLOR3 to the theme in force, IN PLACE: a room glow and a camera beam hold these very objects as their
 *  colour, so they follow without being told; a mesh's tint is a copy, repainted by its caller (SceneManager's
 *  handleThemeChange → repaintBadges, which replays every mesh's state). */
export function syncStatusTheme(): void {
  const hex = STATUS_HEX_BY_THEME[themeInForce()];
  for (const k of Object.keys(STATUS_COLOR3) as StatusKey[]) STATUS_COLOR3[k].copyFrom(Color3.FromHexString(hex[k]));
}
