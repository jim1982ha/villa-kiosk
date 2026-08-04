// src/babylon/colors.ts
// Single shared "active/alert" red. Room presence glow (RoomHighlight), a
// running climate device's mesh outline (EntityVisuals.applyClimateOutline)
// and the 2D badge's alert ring were each carrying their own independently
// hand-picked red — close but not identical — even though they're meant to
// read as the same signal ("this is actively alerting"). Import this instead
// of hardcoding a new Color3 wherever that signal shows up.
import { Color3 } from "@babylonjs/core/Maths/math.color";

export const ALERT_RED = new Color3(0.9, 0.2, 0.2);
// Same colour as ALERT_RED, for the badge ring's Babylon GUI hex string API.
export const ALERT_RED_HEX = "#E63333";

// "HA has lost contact with this device — its state isn't known." Distinct
// from ALERT_RED (a confirmed, actionable alarm) on purpose: tinting an
// unavailable lock/sensor mesh red would falsely assert a specific confirmed
// state (e.g. "unlocked") that was never actually observed — see
// EntityVisuals.applyToMesh's lock/binary_sensor cases, the bug this fixed
// (a lock HA had lost contact with rendered as a confident red "unlocked").
// Matches --status-warning's amber across the 2D panels for the same signal.
export const UNAVAILABLE_AMBER = new Color3(0.85, 0.55, 0.05);

// Same green as --status-on across the 2D panels ("this is reporting fine" /
// "available") — for the one place on the Babylon GUI side that needs it
// (the room-cluster chip's count pill, see EntityVisuals.updateClusters).
// A Babylon GUI control can't consume a CSS custom property, so this is a
// static match to the light-theme value rather than a live read.
export const AVAILABLE_GREEN_HEX = "#10B981";
