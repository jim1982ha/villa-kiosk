// src/components/panels/cameraStatusBar.ts
// The camera window's bottom status bar, as one composite state history:
// the camera's own reachability layered with its MOTION sensor's on/off
// (mapping.motionEntityId) — offline / online / motion / motion-unavailable.
// Rendered by the same StateTimeline every other panel uses.
//
// ⚠️ THIS BAR'S SUBJECT IS REACHABILITY, so an `unavailable` row is the
// signal, not noise: the camera's own is what "offline" is for, and the
// motion sensor's stops a sensor that went offline while reading `on` from
// painting motion for the whole outage.
//
// Pure: tests/oracles/camera_status_bar.mjs. It was an inline closure in
// CameraPanel.tsx, where 2.496.179 painted a lost motion sensor green.

import { UNKNOWN_STATES } from "@/utils/stateColors";
import type { StateHistoryPoint } from "@/types/ha.types";
import { mergeStateHistories } from "./chartUtils";

export type CameraBarState = "offline" | "online" | "motion" | "motion-unavailable";

/** The bar's state at one instant, from each series' state then. */
export function cameraBarState(camera: string | undefined, motion: string | undefined, hasMotion: boolean): CameraBarState {
  if (!camera || UNKNOWN_STATES.has(camera)) return "offline";
  if (hasMotion && motion === "on") return "motion";
  // ⚠️ A LOST MOTION SENSOR IS NOT "ONLINE" (2.496.179): it resolved to the
  // camera's resting state and was painted green — an outage of the thing
  // this bar exists to report, shown as all-clear.
  if (hasMotion && (!motion || UNKNOWN_STATES.has(motion))) return "motion-unavailable";
  return "online";
}

/** The bar's whole history, from the two raw state histories. */
export function cameraBarHistory(
  camera: readonly StateHistoryPoint[], motion: readonly StateHistoryPoint[] | undefined,
): StateHistoryPoint[] {
  return mergeStateHistories(
    { camera: [...camera], motion: [...(motion ?? [])] },
    (cur) => cameraBarState(cur.camera, cur.motion, motion !== undefined),
  );
}
