// src/ha/HAHistoryAPI.ts
// The history source's Home Assistant adapter (ha/historySource.ts): state
// rows over REST through the add-on, statistics over the websocket. What a
// chart asks for, and every rule about windows, gaps and outages, is the
// source's; this only fetches.

import type { HistoryPort, StateRow } from "./historySource";
import { ingressApiBase } from "./ingress";

/** Anything that can read the recorder's statistics — the HA websocket. */
export type StatisticsPort = Pick<HistoryPort, "getStatisticsDuringPeriod">;

export function haHistoryPort(ws: StatisticsPort): HistoryPort {
  return {
    async stateRows(entityId, from, to) {
      // The add-on's Supervisor proxy injects the token server-side, so this
      // goes token-less (the session cookie carries the authorization).
      //
      // ⚠️ end_time IS REQUIRED for any window longer than a day. Home
      // Assistant defaults it to start + 24h when omitted, so a 7-day request
      // silently came back with the FIRST day of that week and nothing since.
      const url =
        `${ingressApiBase()}/history/period/${encodeURIComponent(new Date(from).toISOString())}` +
        `?filter_entity_id=${encodeURIComponent(entityId)}` +
        `&end_time=${encodeURIComponent(new Date(to).toISOString())}&minimal_response&no_attributes`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`History request failed: ${res.status}`);
      const data = (await res.json()) as StateRow[][];
      return data[0] ?? [];
    },
    getStatisticsDuringPeriod: (...args) => ws.getStatisticsDuringPeriod(...args),
  };
}
