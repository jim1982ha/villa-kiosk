// src/babylon/colors.ts
// Single shared "active/alert" red. Room presence glow (RoomHighlight), a
// running climate device's mesh outline (EntityVisuals.applyClimateOutline)
// and the 2D badge's alert ring were each carrying their own independently
// hand-picked red — close but not identical — even though they're meant to
// read as the same signal ("this is actively alerting"). Import this instead
// of hardcoding a new Color3 wherever that signal shows up.
import { Color3 } from "@babylonjs/core";

export const ALERT_RED = new Color3(0.9, 0.2, 0.2);
// Same colour as ALERT_RED, for the badge ring's Babylon GUI hex string API.
export const ALERT_RED_HEX = "#E63333";
