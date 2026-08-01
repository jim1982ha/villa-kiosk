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

/** Slow enough to be invisible in battery/network terms, quick enough that a
 *  second operator's change shows up on its own rather than "when you next
 *  reopen the app". */
export const STORE_HEARTBEAT_MS = 3 * 60 * 1000;

/**
 * @param refresh  Re-read the store. MUST be safe to call at any moment: it is
 *                 the callee's job to refuse to clobber an edit this device
 *                 hasn't successfully pushed yet (see each store's guard).
 *                 Should be referentially stable — wrap it in useCallback.
 */
export function useStoreRefresh(refresh: () => void): void {
  useEffect(() => {
    refresh();
    const onWake = () => { refresh(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, STORE_HEARTBEAT_MS);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      clearInterval(heartbeat);
    };
  }, [refresh]);
}
