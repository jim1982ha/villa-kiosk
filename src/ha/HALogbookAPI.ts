// src/ha/HALogbookAPI.ts
// Fetch Home Assistant's own Logbook via websocket — for the Cockpit page's
// recent-activity feed. `logbook/get_events`, not the classic REST
// `/api/logbook/<timestamp>` endpoint: verified directly against a live
// instance that the websocket command is the reliable path (matches what
// HA's own frontend logbook uses); the REST endpoint returned nothing usable
// in the same test. See HAWebSocket.getLogbookEvents / RawLogbookEntry
// (types/ha.types.ts) for the exact response shape this depends on — most
// notably that only automation/script-triggered entries carry a real HA
// `message`, and cockpitData.ts's describeLogbookEntry is where this app
// fills in the rest using its own existing state vocabulary rather than
// re-implementing HA's logbook text generation.

import type { HAWebSocket } from "./HAWebSocket";
import type { RawLogbookEntry } from "@/types/ha.types";

/** Entries from the last `hours`, oldest first (as HA returns them) — the
 *  caller sorts/filters/describes. */
export async function fetchLogbookEvents(ws: HAWebSocket, hours = 6): Promise<RawLogbookEntry[]> {
  const startTime = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return ws.getLogbookEvents(startTime);
}
