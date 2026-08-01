// src/hooks/useStoreRefresh.ts
// WHEN a server-backed shared store re-reads itself. One implementation for
// both stores (config/DeviceConfigSync and fm/FmDataContext), because "how
// fresh is this screen" should not be a different answer per store.
//
// The triggers, and why each is needed:
//   * on mount — the obvious one;
//   * on window focus / visibilitychange — a phone coming back from the
//     background, or a desktop tab being returned to, is exactly when the user
//     is about to look at the data;
//   * a slow heartbeat WHILE VISIBLE — a device that is never backgrounded (a
//     wall-mounted tablet, or a desktop window left open on the Facility
//     screen) fires neither of the above and would otherwise sit on whatever
//     it read at boot, indefinitely.
//
// The FM store had only the mount trigger, which is why a fault raised by the
// facility manager on site stayed invisible to the owner's open window until
// one of them restarted the app — the records were correct, the screen just
// never asked again.
//
// Deliberately cheap: one small GET per interval per visible device, next to
// nothing beside the HA WebSocket's own 25s ping, and nothing at all while
// hidden.

import { useEffect } from "react";

/** Background cadence: slow enough to be invisible in battery/network terms,
 *  for a store nobody is currently looking at. */
export const STORE_HEARTBEAT_MS = 3 * 60 * 1000;

/** Cadence while the data is ACTUALLY ON SCREEN.
 *
 *  The background rate is wrong for a screen someone is watching: marking a
 *  fault in progress on the desktop and then staring at the phone means up to
 *  three minutes of the phone showing the old status with no indication that
 *  anything is coming. That reads as "the sync is broken" even though it is
 *  working exactly as designed — and the operator has no way to tell those two
 *  apart. Faster only while a panel is open, so an unattended kiosk still
 *  costs one small GET every three minutes. */
export const STORE_ACTIVE_MS = 15 * 1000;

/**
 * @param refresh  Re-read the store. MUST be safe to call at any moment: it is
 *                 the callee's job to refuse to clobber an edit this device
 *                 hasn't successfully pushed yet (see each store's guard).
 *                 Should be referentially stable — wrap it in useCallback.
 * @param intervalMs  Heartbeat period; pass STORE_ACTIVE_MS while the data is
 *                 on screen. Changing it restarts the timer, so a panel
 *                 opening gets a prompt tick rather than inheriting the
 *                 remainder of a slow one.
 */
export function useStoreRefresh(refresh: () => void, intervalMs: number = STORE_HEARTBEAT_MS): void {
  useEffect(() => {
    refresh();
    const onWake = () => { refresh(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      clearInterval(heartbeat);
    };
  }, [refresh, intervalMs]);
}
