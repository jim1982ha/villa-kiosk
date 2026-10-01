// src/ha/HAEnergyAPI.ts
// Home Assistant's Energy dashboard, as the Energy window reads it: its setup (energy/get_prefs), where it computes cost (energy/info), and
// — through the history source — the recorder's per-bucket `change` for each
// statistic, the same number HA's own dashboard graphs are built from. What
// those numbers MEAN (consumption, untracked, "today") is config/energyModel's.
//
// Deliberately whole-villa only, not per-room: a device_consumption entry's
// statistic_id has no reliable path back to a kiosk room (unlike an entity_id,
// which resolves via resolvedRooms) — matching it by name would be exactly the
// per-site guessing the "no hardcoding" rule forbids.
//
// ⚠️ A CONFIGURED SOURCE IS NOT A WORKING ONE: on a real villa the dashboard's
// `stat_energy_from` pointed at a statistic an entity rename had orphaned. It
// then has no rows, which energyModel reads as "no reading" — never 0 kWh — so
// a figure built only on orphans is not shown at all.

import type { HAWebSocket } from "./HAWebSocket";
import { energySetup, type EnergyCostSetup } from "@/config/energyModel";
import type { HistoryAnswer, HistoryRequest } from "./historySource";
import type { HistorySeries } from "@/types/ha.types";
import type { StatisticsPeriod } from "@/utils/statisticsSeries";

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

type EnergyRequest = Extract<HistoryRequest, { kind: "statistics" }>;

/** The history-source request for each statistic's `change` per bucket since
 *  `since` — the same buckets HA's dashboard draws. */
export function energyRequest(s: EnergyWindowSetup, since: number, period: StatisticsPeriod): EnergyRequest {
  return { kind: "statistics", ids: energyStatIds(s), period, fields: ["change"], since };
}

/** Its answer as one `change` series per statistic. A statistic the recorder
 *  has nothing for is an empty series with its outage (statisticsSeries),
 *  never a zero. */
export function energyChanges(answer: HistoryAnswer<EnergyRequest>): Record<string, HistorySeries> {
  return Object.fromEntries(Object.entries(answer)
    .flatMap(([id, f]) => (f.change ? [[id, f.change] as const] : [])));
}
