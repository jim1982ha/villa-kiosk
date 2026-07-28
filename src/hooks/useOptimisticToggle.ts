// src/hooks/useOptimisticToggle.ts
// Shows a toggle's INTENT immediately, then reconciles with Home Assistant's
// real state when it arrives.
//
// Why this exists: a switch rendered purely from confirmed HA state can't flip
// until the whole round-trip completes — browser -> add-on -> HA -> the
// PHYSICAL DEVICE -> state_changed -> back. Most devices confirm in ~100ms and
// feel instant. Some genuinely take seconds: an access-point LED, for one,
// whose integration calls the controller API and polls the result. The UI was
// correctly waiting on a slow truth, which reads as "the app is laggy" — no
// amount of app-side optimisation can fix that, because the app was never the
// slow part.
//
// NOT the same as the optimistic PREDICTION that was tried and reverted for
// the in-scene quick-toggle tap (see TapRipple's docstring / CHANGELOG
// ~v2.32.7-20). That one predicted 3D mesh appearance with no bounded
// correction, so a fast ON-then-OFF could strand the scene showing the wrong
// thing. This is narrower and self-correcting on every axis:
//   * it only overrides a discrete DOM switch, never scene/material state;
//   * the override is dropped the moment real state matches the intent;
//   * it is dropped anyway after `timeoutMs`, so a service call that silently
//     fails reverts to truth instead of lying indefinitely;
//   * it resets when the target entity changes, so a reused panel can't
//     inherit the previous device's pending intent.
// Worst case is a few seconds of showing what the user asked for before the
// truth overrides it — which is exactly the intended behaviour, not a bug.

import { useCallback, useEffect, useRef, useState } from "react";

export interface OptimisticToggle {
  /** What the switch should render: pending intent if any, else real state. */
  isOn: boolean;
  /** Flip it: paint the new state now, fire the service call, reconcile later. */
  toggle: () => void;
}

export function useOptimisticToggle(
  /** Target entity — a change resets any pending intent. Undefined is fine
   *  (nothing to toggle); the hook still runs so callers keep hook order. */
  entityId: string | undefined,
  /** Live, HA-confirmed state. */
  actualOn: boolean,
  /** Fire the actual service call. */
  send: () => void,
  /** How long to keep showing intent before giving up and trusting HA again.
   *  Generous: it only has to outlast a slow integration's confirmation, and
   *  reverting too early would produce a visible flip-back on exactly the
   *  devices this exists for. */
  timeoutMs = 10_000,
): OptimisticToggle {
  const [pending, setPending] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep `toggle` stable even when the caller passes an inline closure.
  const sendRef = useRef(send);
  sendRef.current = send;

  const clearPending = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPending(null);
  }, []);

  // Different device in the same panel — drop any intent aimed at the old one.
  useEffect(() => { clearPending(); }, [entityId, clearPending]);

  // Truth caught up with intent: stop overriding. Deliberately compares
  // against the INTENT rather than just "any state change" — an unrelated
  // attribute update on the same entity must not clear a still-pending flip.
  useEffect(() => {
    if (pending !== null && actualOn === pending) clearPending();
  }, [actualOn, pending, clearPending]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggle = useCallback(() => {
    const desired = !(pending ?? actualOn);
    setPending(desired);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(null);
    }, timeoutMs);
    sendRef.current();
  }, [pending, actualOn, timeoutMs]);

  return { isOn: pending ?? actualOn, toggle };
}
