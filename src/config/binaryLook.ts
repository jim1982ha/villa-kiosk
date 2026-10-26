// src/config/binaryLook.ts
// HOW A binary_sensor LOOKS IN ITS WINDOW — its words, its colours, its pill
// and whether a state is its problem — answered once. Pure:
// tests/oracles/binary_status.mjs drives it by value.
//
// ⚠️ THE RULE LIVED INSIDE SensorPanel.tsx (until 2.496.285). A caller had to
// combine alertStateFor, secureStateFor, colourAlertStateFor, binaryStatus and
// the danger level in the right order; the oracle could only pin that order
// with a regex on the .tsx, and the grouped device window (DeviceGroupPanel),
// which never copied it, showed a smoke detector's "Smoke detected" as plain
// grey text with no history. Every window now asks here.
//
// ⚠️ THE WINDOW KEEPS RED WHERE THE MAP IS CALM (owner, 2026-10-26: "keep red
// there"): a detection, an open door, a lock sensor unlocked is red here and in
// its history bar, and in use on the map and in the Cockpit (the plain dot, no
// line in "Needs attention"). It read "red on both" until 2.496.540. The two
// are projections of one condition, side by side in config/deviceCondition
// (conditionOf for the map, windowProblemState for this window).

import { windowProblemState } from "./deviceCondition";
import { binaryWord } from "./binarySensorWords";
import { binaryStatus, STATUS_COLOR, STATUS_PILL_CLASS, type StatusKey } from "@/utils/stateColors";
import { prettyState } from "@/utils/entityValue";

export interface BinaryLook {
  /** The state that is this sensor's PROBLEM (an alert), if it has one —
   *  what the badge, the alerts and the reading's level read. */
  problem: string | undefined;
  /** A state's meaning in this window (the pill and the history bar). */
  status(state: string): StatusKey;
  /** Its `.status-pill` class (the problem state's is "danger", through `status`). */
  tone(state: string): string;
  /** Its colour in the history bar. */
  color(state: string): string;
  /** Its words, as Home Assistant shows them ("Normal", "Leak detected"). */
  word(state: string): string;
  /** Whether it is this sensor's problem state. */
  danger(state: string): boolean;
}

export function binaryLook(entityId: string, deviceClass: string | undefined): BinaryLook {
  // the class's problem state: an open door, a detection stay red HERE, while the map and the Cockpit read them as in
  // use (deviceCondition.windowProblemState — owner, 2026-10-26: "keep red there")
  const problem = windowProblemState(deviceClass);
  const status = (s: string) => binaryStatus(s, problem);
  const danger = (s: string) => problem !== undefined && s === problem;
  return {
    problem, status, danger,
    tone: (s) => STATUS_PILL_CLASS[status(s)],          // the problem state is "alert", so "danger"
    color: (s) => STATUS_COLOR[status(s)],
    word: (s) => binaryWord(entityId, deviceClass, s) ?? prettyState(s),
  };
}
