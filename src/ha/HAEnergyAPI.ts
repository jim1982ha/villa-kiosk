// src/ha/HAEnergyAPI.ts
// "Energy today" for the Cockpit page — reads Home Assistant's own Energy
// Dashboard configuration and long-term statistics rather than re-deriving
// consumption from raw sensor readings. HA's recorder already computes the
// per-bucket `change` (consumption within a period, not a running total this
// app would have to diff itself) — the same number its own Energy Dashboard
// graphs are built from, see HAWebSocket.getStatisticsDuringPeriod.
//
// Deliberately whole-villa only, not per-room: a device_consumption entry's
// statistic_id has no reliable path back to a kiosk room (unlike an
// entity_id, which resolves via resolvedRooms) — matching it by name would
// be exactly the kind of per-site guessing the "no hardcoding" rule warns
// against. Confirmed the risk is real, not theoretical, before deciding
// this: on a real villa, the Energy Dashboard's configured `stat_energy_from`
// pointed at a statistic ID that no LONGER had any recorded data (an
// unrelated entity rename had orphaned it) — which is exactly why this
// cross-checks against listStatisticIds before trusting anything the
// dashboard config says, rather than assuming a configured source is a
// working one.

import type { HAWebSocket } from "./HAWebSocket";
import { energySetup, type EnergyCostSetup } from "@/config/energyModel";
import { fetchStatistics } from "./HAHistoryAPI";
import type { HistorySeries } from "@/types/ha.types";
import type { StatisticsPeriod } from "@/utils/statisticsSeries";

export interface EnergyToday {
  /** Sum of every resolvable grid source's consumption since local midnight. */
  kwh: number;
}

/** Local midnight (villa's own timezone, via the browser) as an ISO string —
 *  HA's statistics are bucketed on wall-clock days, not UTC ones, so a UTC
 *  midnight would misattribute the last few hours of "today" to "yesterday"
 *  or vice versa depending on the villa's offset. */
function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Null when the install has no Energy Dashboard configured at all, OR its
 * configured grid source(s) don't actually resolve to recorded data — both
 * cases render as "this section doesn't exist" rather than a zero, since a
 * genuine zero (grid source configured and resolving, but no consumption
 * recorded yet today) is a real, different answer worth showing.
 */
export async function fetchEnergyToday(ws: HAWebSocket): Promise<EnergyToday | null> {
  const prefs = await ws.getEnergyPrefs();
  const gridIds = prefs.energy_sources
    .filter((s) => s.type === "grid" && s.stat_energy_from)
    .map((s) => s.stat_energy_from as string);
  if (gridIds.length === 0) return null;

  const known = await ws.listStatisticIds("sum");
  const knownIds = new Set(known.map((s) => s.statistic_id));
  const resolvable = gridIds.filter((id) => knownIds.has(id));
  if (resolvable.length === 0) return null;

  const buckets = await ws.getStatisticsDuringPeriod(resolvable, startOfTodayIso(), "day");
  let kwh = 0;
  let sawAny = false;
  for (const id of resolvable) {
    for (const bucket of buckets[id] ?? []) {
      if (typeof bucket.change === "number") { kwh += bucket.change; sawAny = true; }
    }
  }
  return sawAny ? { kwh } : null;
}

// ── The Energy window (2.496.105) ─────────────────────────────────────────
// Everything it shows is Home Assistant's Energy dashboard's own: its setup
// (energy/get_prefs), where it computes cost (energy/info), and the recorder's
// per-period `change` for each statistic. Read on EVERY open — never copied
// into VESTA's config — so a change made in HA's Energy settings is on screen
// the next time the window opens. The rules on top: config/energyModel.ts.


/** The setup, plus each energy statistic's cost statistic (HA's own). */
export type EnergyWindowSetup = EnergyCostSetup;

/** Null when HA has no Energy dashboard with a grid or solar source. */
export async function fetchEnergySetup(
  ws: HAWebSocket, nameOf: (statId: string) => string,
): Promise<EnergyWindowSetup | null> {
  const prefs = await ws.getEnergyPrefs();
  const setup = energySetup(prefs, nameOf);
  if (setup.gridIn.length === 0 && setup.solar.length === 0) return null;
  // No cost is a real answer (no tariff set): the window then shows kWh only.
  const info = await ws.getEnergyInfo().catch(() => ({ cost_sensors: {} }));
  return { ...setup, costOf: info.cost_sensors ?? {} };
}

/** Every statistic the window reads, energy and cost. */
export function energyStatIds(s: EnergyWindowSetup): string[] {
  const ids = new Set<string>([...s.gridIn, ...s.gridOut, ...s.solar, ...s.devices.map((d) => d.id)]);
  for (const id of s.gridIn) if (s.costOf[id]) ids.add(s.costOf[id]);
  return [...ids];
}

/** Each statistic's `change` per bucket since `since` — the same buckets HA's
 *  dashboard draws. A statistic the recorder has nothing for is an empty
 *  series with its outage (statisticsSeries), never a zero. */
export async function fetchEnergyPeriod(
  ws: HAWebSocket, s: EnergyWindowSetup, since: number, period: StatisticsPeriod,
): Promise<Record<string, HistorySeries>> {
  const out = await fetchStatistics(ws, energyStatIds(s), 0, period, ["change"] as const, since);
  return Object.fromEntries(Object.entries(out).map(([id, f]) => [id, f.change]));
}
