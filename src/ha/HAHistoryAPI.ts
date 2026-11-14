// src/ha/HAHistoryAPI.ts
// The history source's Home Assistant adapter (ha/historySource.ts): state
// rows over REST through the add-on, statistics over the websocket. What a
// chart asks for, and every rule about windows, gaps and outages, is the
// source's; this only fetches.

import {
  KEPT_PROBE, keptFrom, keptFromRows, keptLookFrom, readBackFrom, type HistoryPort, type StateRow,
} from "./historySource";
import { ingressApiBase } from "./ingress";
import { backendFetch } from "@/auth/sessionLost";
import { heldWindow, opensAsleep } from "./unavailableByDesign";
import type { HistoryGap } from "@/types/ha.types";
import { coverState } from "@/utils/panelRules";

/** Anything that can read the recorder's statistics — the HA websocket. */
type StatisticsPort = Pick<HistoryPort, "getStatisticsDuringPeriod">;

/** Each finished villa day's outages, per entity (HistoryPort.outageDays): ONE for every chart's port, so a device
 *  window opened again, or its 1w then its 1m, reads only today's detail. In memory: a reload reads them again. */
const outageDays = new Map<string, readonly HistoryGap[]>();

/** `asleep`: the devices asleep by design (the entity store's list) — their sleep is no change on a chart
 *  (unavailableByDesign.heldWindow). */
export function haHistoryPort(ws: StatisticsPort, asleep: ReadonlySet<string> = new Set()): HistoryPort {
  return {
    async stateRows(entityId, from, to, back = readBackFrom(undefined, from)) {
      const rows = (await recordedStates([entityId], from, to))[entityId] ?? [];
      if (!asleep.has(entityId)) return rows;
      // a window that opens asleep holds the report before it: read back as far as the villa keeps (`back`,
      // historySource.readBackFrom), the depth the entity store's recall reads to, so its pill and its chart find the
      // same report
      const before = opensAsleep(rows) && back < from ? (await recordedStates([entityId], back, from))[entityId] ?? [] : [];
      return heldWindow(rows, before, from);
    },
    getStatisticsDuringPeriod: (...args) => ws.getStatisticsDuringPeriod(...args),
    keptFrom: villaKeptFrom,
    asleep: (entityId) => asleep.has(entityId),
    outageDays,
  };
}

/** The villa's recorder, as far as "how much does it keep" needs it: the probe's states, read as recorded. */
const recorder: HistoryPort = {
  stateRows: async (id, from, to) => (await recordedStates([id], from, to))[id] ?? [],
  getStatisticsDuringPeriod: () => Promise.reject(new Error("not read here")),
  // where the villa's system's detail begins: the oldest change of the probe it still keeps (historySource.keptFrom)
  async keptFrom(now) {
    const from = keptLookFrom(now);
    return keptFromRows(await this.stateRows(KEPT_PROBE, from, now), from);
  },
};

/** Where the villa's system's detail begins at `now` — ONE reading, cached, shared by every chart's port and the
 *  entity store's recall of a device asleep by design (historySource.readBackFrom). */
export function villaKeptFrom(now: number): Promise<number | undefined> {
  return keptFrom(recorder, now);
}

/** Every state each of `ids` reported between `from` and `to` (epoch ms), as the villa's system recorded it, led
 *  by the state it was already in at `from` — per entity; an entity with nothing recorded is absent. The one REST
 *  read of the villa's history: a panel's chart, and the entity store's last report of a device asleep by design. */
export async function recordedStates(ids: readonly string[], from: number, to: number): Promise<Record<string, StateRow[]>> {
  // ⚠️ A COVER'S POSITION IS ITS STATE HERE (owner, 2026-11-15: "Partially open" its own colour): its rows are read
  // with their attributes and EVERY change (a curtain moved from 100% to 47% stays "open" to the villa's system, an
  // attribute change only), each named by panelRules.coverState. Every other entity as before.
  const covers = ids.filter((id) => id.startsWith("cover."));
  const others = ids.filter((id) => !id.startsWith("cover."));
  const none: Record<string, StateRow[]> = {};
  const [plain, withPosition] = await Promise.all([
    others.length ? readHistory(others, from, to, "&minimal_response&no_attributes") : none,
    covers.length ? readHistory(covers, from, to, "&significant_changes_only=0") : none,
  ]);
  const named: Record<string, StateRow[]> = {};
  for (const [id, rows] of Object.entries(withPosition)) {
    named[id] = rows.map((r: StateRow) => ({ state: coverState(r.state ?? undefined, (r as { attributes?: { current_position?: unknown } }).attributes?.current_position) ?? r.state,
      last_changed: r.last_changed }));
  }
  return { ...plain, ...named };
}

/** One REST read of the villa's history for `ids`, with the query's own `extra` options, per entity. */
async function readHistory(ids: readonly string[], from: number, to: number, extra: string): Promise<Record<string, StateRow[]>> {
  // The add-on's Supervisor proxy injects the token server-side, so this
  // goes token-less (the session cookie carries the authorization).
  //
  // ⚠️ end_time IS REQUIRED for any window longer than a day. Home
  // Assistant defaults it to start + 24h when omitted, so a 7-day request
  // silently came back with the FIRST day of that week and nothing since.
  const url =
    `${ingressApiBase()}/history/period/${encodeURIComponent(new Date(from).toISOString())}` +
    `?filter_entity_id=${encodeURIComponent(ids.join(","))}` +
    `&end_time=${encodeURIComponent(new Date(to).toISOString())}${extra}`;
  // backendFetch: a 401 here is the session gone, reported as such (it
  // read as "History request failed" until 2.496.263).
  const res = await backendFetch(url);
  if (!res.ok) throw new Error(`History request failed: ${res.status}`);
  const data = (await res.json()) as (StateRow & { entity_id?: string })[][];
  // minimal_response: only each entity's first row names it
  return Object.fromEntries(data.filter((rows) => rows[0]?.entity_id).map((rows) => [rows[0].entity_id as string, rows]));
}
