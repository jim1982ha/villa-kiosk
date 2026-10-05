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
// The MAP keeps its own reading (deviceActivity): a detection is red in a
// sensor's window only — on the map motion stays information (owner, 2026-10-05).

import { alertStateFor, secureStateFor, colourAlertStateFor } from "./BinarySensorClasses";
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

/** `override`: the owner's own alert state for this sensor (config.alertThresholds). */
export function binaryLook(entityId: string, deviceClass: string | undefined, override: string | undefined): BinaryLook {
  const problem = alertStateFor(deviceClass, override);
  const colourAlert = colourAlertStateFor(deviceClass, override);
  const secure = secureStateFor(deviceClass);
  const status = (s: string) => binaryStatus(s, colourAlert, secure);
  const danger = (s: string) => problem !== undefined && s === problem;
  return {
    problem, status, danger,
    tone: (s) => STATUS_PILL_CLASS[status(s)],          // the problem state is "alert", so "danger"
    color: (s) => STATUS_COLOR[status(s)],
    word: (s) => binaryWord(entityId, deviceClass, s) ?? prettyState(s),
  };
}
