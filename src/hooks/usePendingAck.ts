// src/hooks/usePendingAck.ts
// "Something is happening" — acknowledge a tap that fired a service call,
// until the real state moves (or a timeout gives up).
//
// This is the CONSERVATIVE half of the app's two feedback strategies, and the
// distinction matters:
//
//   * usePendingAck (this file) NEVER predicts an outcome. It only says a
//     request is in flight, and stops saying it the moment the entity's real
//     state changes to anything. It cannot show a wrong state because it
//     doesn't claim a state at all.
//   * useOptimisticToggle predicts, painting the intended state immediately
//     and reconciling later. Correct for a discrete DOM switch whose two
//     positions are unambiguous; wrong anywhere a mispredicted value would
//     strand something visibly incorrect.
//
// The pulse existed inline in PowerToggle (lights/switches/fans/media) and
// nowhere else — so the LOCK panel, driving the slowest devices in the villa
// (a Z-Wave/Zigbee deadbolt can take several seconds to report back), was the
// one surface with no acknowledgment at all. Extracted here so any panel can
// take it without re-deriving the timeout/reset rules, and so those rules
// stay defined once.

import { useEffect, useRef, useState } from "react";

/** Safety-net cap on the pending visual — cleared as soon as the watched
 *  state actually changes, so this only matters when HA never confirms (a
 *  dropped call, a stuck integration). Long enough to survive normal latency
 *  and a slow lock motor, short enough that a genuinely lost call doesn't
 *  read as "still working" indefinitely. */
const PENDING_TIMEOUT_MS = 4000;

/**
 * @param actual  The live, HA-confirmed value to watch. ANY change to it
 *                clears the pending flag — deliberately looser than
 *                useOptimisticToggle's compare-against-intent, because this
 *                hook has no intent to compare against: a lock going
 *                locked→unlocking→unlocked should stop pulsing at the first
 *                sign of movement, not wait for a specific final value.
 * @returns `pending` (render the in-flight affordance) and `markPending`
 *          (call it in the same handler that fires the service call).
 */
export function usePendingAck<T>(actual: T, timeoutMs = PENDING_TIMEOUT_MS): {
  pending: boolean;
  markPending: () => void;
} {
  const [pending, setPending] = useState(false);
  const prev = useRef(actual);

  useEffect(() => {
    if (actual !== prev.current) {
      prev.current = actual;
      setPending(false);
    }
  }, [actual]);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), timeoutMs);
    return () => clearTimeout(t);
  }, [pending, timeoutMs]);

  return { pending, markPending: () => setPending(true) };
}
