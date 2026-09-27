// src/utils/deviceWake.ts
// ONE "the device just came back — is what we show stale?" signal.
//
// A tablet that slept, an iPhone that roamed Wi-Fi, a tab that was in the
// background: the socket may be dead without an onclose for minutes, and a
// store read an hour ago may be stale. Three browser events say "now is the
// moment to re-check": the tab becoming visible, the window regaining focus,
// and the network coming back.
//
// ⚠️ TWO COPIES WITH DIFFERENT SIGNALS (2.496.196). The HA socket listened
// for visibility + online; the store refresh (config, FM data) for focus +
// visibility. So the stores never re-read when the network returned, and the
// socket never health-checked on focus. One subscription, both callers.

export type Unsubscribe = () => void;

/** Call `fn` whenever the device wakes: visible again, focused, or online.
 *  Nothing is registered where there is no document/window (the oracles). */
export function onWake(fn: () => void): Unsubscribe {
  const onVisible = () => { if (!document.hidden) fn(); };
  const onSignal = () => fn();
  const doc = typeof document !== "undefined" ? document : null;
  const win = typeof window !== "undefined" ? window : null;
  doc?.addEventListener("visibilitychange", onVisible);
  win?.addEventListener("focus", onSignal);
  win?.addEventListener("online", onSignal);
  return () => {
    doc?.removeEventListener("visibilitychange", onVisible);
    win?.removeEventListener("focus", onSignal);
    win?.removeEventListener("online", onSignal);
  };
}
