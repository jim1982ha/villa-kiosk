// src/fm/faultTiming.ts
// What the Overview's (i) beside "Raise a fault" says (components/fm/FaultTiming.tsx): when a fault opens and closes,
// by where it comes from, how it becomes a ticket, and how often the list is read again (owner, 2026-10-14). Pure, so
// tests/oracles/info_tip.mjs reads the very words the card shows.
//
// ⚠️ WITH OR WITHOUT THE VESTA AGENT: the Agent is optional in a Kiosk, and without it nothing opens or closes a fault
// by itself — the card says only what a person does. With it, the Agent's numbers are its DEFAULTS, said as such (the
// nightly check's time is the Agent's setting, which a villa can change). The list's own refresh is this app's
// (useStoreRefresh: STORE_ACTIVE_MS while the Cockpit is open, else the heartbeat).

import { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";

type Row = readonly [string, string, string];

/** [where a fault comes from, when it opens, when it closes], the VESTA Agent's first when there is one. */
const AGENT_ROWS: readonly Row[] = [
  ["Alert from a Home Assistant rule (door left unlocked, overload, device unavailable…)",
   "As soon as the alert is raised", "Within minutes of Home Assistant reporting it back to normal"],
  ["Device found offline by the nightly check", "Nightly check", "Within minutes of the device coming back"],
  ["Device deleted from Home Assistant", "—", "Within minutes"],
  ["Maintenance trend (battery, energy use, Wi-Fi drops, run time)", "Nightly check",
   "At the next nightly check that no longer finds it"],
];
const PERSON_ROW: Row = ["Raised by a person (Raise a fault, or a guest's report)", "At once", "When someone closes it"];

const REFRESH = `This list is read again every ${STORE_ACTIVE_MS / 1000} seconds while it is open (every `
  + `${STORE_HEARTBEAT_MS / 60_000} minutes otherwise), and as soon as you come back to the app.`;

export function faultTiming(agent: boolean): { rows: readonly Row[]; note: string } {
  return agent
    ? {
        rows: [...AGENT_ROWS, PERSON_ROW],
        note: "A fault becomes a ticket when someone marks it in progress (Tickets tab). The VESTA Agent closes its "
          + "own faults and tickets when the problem goes away; it checks every 5 minutes, and its nightly check runs "
          + `at 02:00 by default. ${REFRESH}`,
      }
    : {
        rows: [PERSON_ROW],
        note: `A fault becomes a ticket when someone marks it in progress (Tickets tab). ${REFRESH}`,
      };
}
