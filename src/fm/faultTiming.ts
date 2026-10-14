// src/fm/faultTiming.ts
// What the Faults tab's (i) says (components/fm/FaultTiming.tsx): when a fault opens and closes, by where it comes
// from, and how often the list is read again (owner, 2026-10-14). Pure, so tests/oracles/info_tip.mjs reads the very
// words the card shows.
//
// ⚠️ THE AGENT'S NUMBERS ARE ITS DEFAULTS, SAID AS SUCH: the nightly check's time and how long a device must be back
// are the VESTA Agent's settings, which a villa can change; this Kiosk only knows the defaults. The list's own refresh
// is this app's (useStoreRefresh: STORE_ACTIVE_MS while the Facility view is open, else the heartbeat).

import { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";

/** [where a fault comes from, when it opens, when it closes] */
export const FAULT_TIMING: readonly (readonly [string, string, string])[] = [
  ["Alert from a Home Assistant rule (door left unlocked, overload, device unavailable…)",
   "As soon as the alert is raised", "Within minutes of Home Assistant reporting it back to normal"],
  ["Device found offline by the nightly check", "Nightly check", "Within minutes of the device coming back"],
  ["Device deleted from Home Assistant", "—", "Within minutes"],
  ["Maintenance trend (battery, energy use, Wi-Fi drops, run time)", "Nightly check",
   "At the next nightly check that no longer finds it"],
  ["Raised, closed or reopened by a person", "At once", "At once"],
];

export const FAULT_TIMING_NOTE =
  "Faults from alerts and checks are kept by the VESTA Agent, which checks every 5 minutes; the nightly check runs at "
  + `02:00 by default. This list is read again every ${STORE_ACTIVE_MS / 1000} seconds while it is open (every `
  + `${STORE_HEARTBEAT_MS / 60_000} minutes otherwise), and as soon as you come back to the app.`;
