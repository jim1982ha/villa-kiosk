// src/utils/liveDraft.ts
// The rules of a control whose value FOLLOWS the device until a person takes
// hold of it — a slider, a stepper — as a pure step function, so the Node
// oracles can drive it (the React half is hooks/useLiveDraft.ts).
//
// ⚠️ THE SEND USED TO LIVE IN EACH PANEL, ON `onPointerUp` ONLY (fixed
// 2.496.231). So: a slider moved with the KEYBOARD changed on screen and sent
// nothing; a touch the browser CANCELLED (it became a scroll) left the
// control held forever, no longer following the device; and a REFUSED
// command left the dragged value showing as if it had been applied.

export interface DraftState<T> {
  /** What the control shows. */
  value: T;
  /** The device's last reported value (what a refusal or a cancel returns to). */
  live: T;
  /** A finger (or mouse) is on the control: device updates do not move it. */
  held: boolean;
}

export type DraftEvent<T> =
  | { type: "live"; value: T }        // the device reported
  | { type: "press" }                  // pointer down
  | { type: "move"; value: T }         // the control moved (pointer or keyboard)
  | { type: "release" }                // pointer up
  | { type: "cancel" }                 // the browser took the touch over
  | { type: "set"; value: T }          // a one-shot value (a stepper press)
  | { type: "refused" };               // the command for the last value failed

/** What the hook must do after a step: send the value now, send it once the
 *  keys stop (a keyboard burst is one command), or nothing. */
export type DraftEffect = "send-now" | "send-soon" | null;

export function draftStep<T>(s: DraftState<T>, e: DraftEvent<T>): { state: DraftState<T>; effect: DraftEffect } {
  switch (e.type) {
    case "live":
      return { state: { ...s, live: e.value, value: s.held ? s.value : e.value }, effect: null };
    case "press":
      return { state: { ...s, held: true }, effect: null };
    case "move":
      // Held: the release sends. Not held: the keyboard moved it.
      return { state: { ...s, value: e.value }, effect: s.held ? null : "send-soon" };
    case "release":
      return s.held ? { state: { ...s, held: false }, effect: "send-now" } : { state: s, effect: null };
    case "cancel":
      // The person did not finish a change: back to the device's value.
      return { state: { ...s, held: false, value: s.live }, effect: null };
    case "set":
      return { state: { ...s, value: e.value }, effect: "send-now" };
    case "refused":
      return { state: s.held ? s : { ...s, value: s.live }, effect: null };
  }
}
