// src/ha/HALogbookAPI.ts
// Fetch Home Assistant's own Logbook via REST — for the Cockpit page's recent-
// activity feed. Deliberately NOT a re-implementation of "what happened and
// why": HA's logbook integration already turns a raw state change into a
// readable sentence (motion/lock/cover events, an automation's actual trigger
// cause), including per-integration custom wording this app has no way to
// reproduce — see the "don't reinvent HA features" rule. This file only
// fetches and lightly types that existing text, the same shape HAHistoryAPI.ts
// already establishes for /api/history/period.
//
// Filtering to the villa's own selectableDeviceIds happens in the CALLER, not
// here — HA's raw logbook is unfiltered by the kiosk's own device/RBAC model
// and is genuinely noisy (a `sensor.date_time` helper alone produced ~10
// entries/minute in a real pull), so a thin fetch layer here stays reusable
// for "give me everything in this window" while the caller decides what's
// villa-relevant.

import { ingressApiBase } from "./ingress";

export interface LogbookEntry {
  /** epoch ms */
  t: number;
  /** HA's own generated sentence, e.g. "was unlocked", "detected Motion",
   *  or (for an automation) "triggered by state of sensor.x" — already
   *  human-readable, never assembled here. */
  message: string;
  /** The device/entity name HA attached to this entry — already resolved
   *  (friendly_name, not entity_id). */
  name: string;
  entityId?: string;
  domain?: string;
}

interface RawLogbookEntry {
  when: string;
  message?: string;
  name?: string;
  entity_id?: string;
  domain?: string;
}

/** Fetch the last `hours` of logbook entries, most-recent first. Unfiltered —
 *  see the module docstring for why filtering belongs in the caller. */
export async function fetchLogbook(hours = 6): Promise<LogbookEntry[]> {
  const apiBase = ingressApiBase();
  const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const url = `${apiBase}/logbook/${encodeURIComponent(start)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Logbook request failed: ${res.status}`);
  const raw = (await res.json()) as RawLogbookEntry[];

  const out: LogbookEntry[] = [];
  for (const e of raw) {
    const t = new Date(e.when).getTime();
    // A logbook entry with no message at all (HA emits a few of these, e.g.
    // some context-only rows) has nothing worth showing — skip rather than
    // render a blank line.
    if (!Number.isFinite(t) || !e.message) continue;
    out.push({ t, message: e.message, name: e.name ?? e.entity_id ?? "", entityId: e.entity_id, domain: e.domain });
  }
  return out.sort((a, b) => b.t - a.t);
}
