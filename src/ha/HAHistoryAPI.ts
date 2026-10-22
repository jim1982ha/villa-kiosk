// src/ha/HAHistoryAPI.ts
// The history source's Home Assistant adapter (ha/historySource.ts): state
// rows over REST through the add-on, statistics over the websocket. What a
// chart asks for, and every rule about windows, gaps and outages, is the
// source's; this only fetches.

import { KEPT_PROBE, keptFromRows, keptLookFrom, type HistoryPort, type StateRow } from "./historySource";
import { ingressApiBase } from "./ingress";
import { backendFetch } from "@/auth/sessionLost";
import { heldWindow, opensAsleep, recallFrom } from "./unavailableByDesign";

/** Anything that can read the recorder's statistics — the HA websocket. */
export type StatisticsPort = Pick<HistoryPort, "getStatisticsDuringPeriod">;

/** `asleep`: the devices asleep by design (the entity store's list) — their sleep is no change on a chart
 *  (unavailableByDesign.heldWindow). */
export function haHistoryPort(ws: StatisticsPort, asleep: ReadonlySet<string> = new Set()): HistoryPort {
  return {
    async stateRows(entityId, from, to) {
      const rows = (await recordedStates([entityId], from, to))[entityId] ?? [];
      if (!asleep.has(entityId)) return rows;
      // a window that opens asleep holds the report before it: read back as far as the store's recall does
      const before = opensAsleep(rows) ? (await recordedStates([entityId], recallFrom(from), from))[entityId] ?? [] : [];
      return heldWindow(rows, before, from);
    },
    getStatisticsDuringPeriod: (...args) => ws.getStatisticsDuringPeriod(...args),
    // where the villa's system's detail begins: the oldest change of the probe it still keeps (historySource.keptFrom)
    async keptFrom(now) {
      const from = keptLookFrom(now);
      return keptFromRows(await this.stateRows(KEPT_PROBE, from, now), from);
    },
  };
}

/** Every state each of `ids` reported between `from` and `to` (epoch ms), as the villa's system recorded it, led
 *  by the state it was already in at `from` — per entity; an entity with nothing recorded is absent. The one REST
 *  read of the villa's history: a panel's chart, and the entity store's last report of a device asleep by design. */
export async function recordedStates(ids: readonly string[], from: number, to: number): Promise<Record<string, StateRow[]>> {
  // The add-on's Supervisor proxy injects the token server-side, so this
  // goes token-less (the session cookie carries the authorization).
  //
  // ⚠️ end_time IS REQUIRED for any window longer than a day. Home
  // Assistant defaults it to start + 24h when omitted, so a 7-day request
  // silently came back with the FIRST day of that week and nothing since.
  const url =
    `${ingressApiBase()}/history/period/${encodeURIComponent(new Date(from).toISOString())}` +
    `?filter_entity_id=${encodeURIComponent(ids.join(","))}` +
    `&end_time=${encodeURIComponent(new Date(to).toISOString())}&minimal_response&no_attributes`;
  // backendFetch: a 401 here is the session gone, reported as such (it
  // read as "History request failed" until 2.496.263).
  const res = await backendFetch(url);
  if (!res.ok) throw new Error(`History request failed: ${res.status}`);
  const data = (await res.json()) as (StateRow & { entity_id?: string })[][];
  // minimal_response: only each entity's first row names it
  return Object.fromEntries(data.filter((rows) => rows[0]?.entity_id).map((rows) => [rows[0].entity_id as string, rows]));
}
