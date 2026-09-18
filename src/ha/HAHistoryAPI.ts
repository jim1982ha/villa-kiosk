// src/ha/HAHistoryAPI.ts
// Fetch recent entity history via the REST API for panel sparklines/timelines.

import { gapsFrom } from "@/utils/historyGaps";
import type { StateHistoryPoint, HistorySeries } from "@/types/ha.types";
import { ingressApiBase } from "./ingress";

interface RawHistoryState {
  state: string;
  last_changed: string;
  last_updated?: string;
}

async function fetchRaw(entityId: string, hours: number): Promise<RawHistoryState[]> {
  // The add-on's Supervisor proxy injects the token server-side, so we hit it
  // token-less (session cookie carries the browser's authorization).
  const apiBase = ingressApiBase();
  const now = Date.now();
  const start = new Date(now - hours * 3600 * 1000).toISOString();
  // end_time is REQUIRED for any window longer than a day. Home Assistant's
  // history endpoint defaults it to start + 24h when it is omitted, so a 7-day
  // request silently came back with the FIRST day of that week and nothing
  // since — a chart whose newest point was six days old while the 24h view of
  // the same sensor was full of data.
  const end = new Date(now).toISOString();
  const url =
    `${apiBase}/history/period/${encodeURIComponent(start)}` +
    `?filter_entity_id=${encodeURIComponent(entityId)}` +
    `&end_time=${encodeURIComponent(end)}&minimal_response&no_attributes`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`History request failed: ${res.status}`);
  const data = (await res.json()) as RawHistoryState[][];
  return data[0] ?? [];
}

/** A history row's numeric value, or NaN when there was no reading at all.
 *
 *  ⚠️ BLANK AND NULL ARE NOT ZERO. Kept as a named function rather than inlined
 *  because "absent" vs "zero" is the distinction the whole numeric path turns
 *  on, and `Number(x)` quietly answers 0 for both. */
export function numericState(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  return s === "" ? NaN : Number(s);
}

/**
 * Fetch the last `hours` of NUMERIC history for an entity (line sparklines),
 * AND the stretches in which it reported nothing usable.
 *
 * ⚠️ THE GAPS ARE PART OF THE RETURN VALUE, NOT AN OPTION. Dropping the
 * unusable rows and saying nothing is what drew a pump "ramping up" all night
 * while it was offline — the chart joined the last reading before the outage to
 * the first one after it and called that a measurement. Returning one object
 * makes the honest drawing the only drawing a caller can produce: there is no
 * overload that hands back points alone.
 */
export async function fetchHistory(entityId: string, hours = 24): Promise<HistorySeries> {
  const series = await fetchRaw(entityId, hours);
  const rows = series
    // ⚠️ A MISSING READING MUST BECOME NaN, NEVER 0. `Number(null)` is 0 and so
    // is `Number("")`, and both are `Number.isFinite`, so the filter below —
    // which exists to drop unparseable rows — passed them through as a real
    // measurement of zero. On a power sensor that draws a line to the floor and
    // reads as "the device stopped drawing power"; on a temperature it reads as
    // 0°C. Same wire and same lie about the declared type as the null-state
    // crash fixed alongside this, silent instead of loud.
    .map((s) => ({ t: new Date(s.last_changed).getTime(), v: numericState(s.state) }));
  return {
    points: rows.filter((p) => Number.isFinite(p.v)),
    // `Date.now()` rather than the last row's stamp: an entity that is
    // unavailable NOW has an outage that has not ended. The chart clamps the
    // band to its own plot, so an end beyond the last point is safe here.
    gaps: gapsFrom(rows, Date.now()),
  };
}

/**
 * Fetch the last `hours` of RAW state history for an entity (StateTimeline) —
 * no numeric parsing, so this also works for on/off, enum, and free-text
 * sensor states (e.g. an access point reporting "connected"/"disconnected").
 * fetchHistory's numeric filter silently drops every point for such an
 * entity, which is why a text-state sensor previously showed "Not enough
 * history yet" even though HA had real history for it.
 */
export async function fetchStateHistory(
  entityId: string,
  hours = 24,
): Promise<StateHistoryPoint[]> {
  // ⚠️ `unavailable` AND `unknown` ARE KEPT, AND THE OPTION TO DROP THEM IS
  // GONE. It used to default to dropping, which silently deleted every period
  // a device was offline before the chart ever saw it. Two ways that showed,
  // both reported 2026-09-14 on a lock that had been flapping all day:
  //
  //   • a 1h window whose first in-window change is late renders BLANK up to
  //     that change, because the state the entity was ALREADY in — the anchor
  //     HA returns at the window start — was an `unavailable` row and got
  //     deleted. The bar begins mid-chart with nothing before it.
  //   • a 12h window renders as ONE solid band of the surviving state, because
  //     once the `unavailable` rows are gone the remaining rows are all equal
  //     and the de-duplication below collapses them into a single segment. It
  //     looks complete and is the worse lie of the two: it claims the device
  //     held one state for twelve hours when it was offline for most of them.
  //
  // ⚠️ AND IT MADE `useStateHistory`'s OWN DEAD-WINDOW TEST VACUOUS. That hook
  // asks `h.some(pt => !UNKNOWN_STATES.has(pt.state))` to decide whether to
  // look further back for the last sighting — a question that can only be
  // answered by data this filter had already removed, so the answer was always
  // "alive" and the lookback never ran.
  //
  // Nothing wanted the old default: all three call sites either passed the
  // opt-out or were broken by not passing it. Colour is not this module's
  // business — `stateColors.historyStateColor` already maps these to the amber
  // the Map colours legend documents.
  const series = await fetchRaw(entityId, hours);
  const points = series
    // ⚠️ COERCED AT THE DOOR, alongside the guard in `statusKeyFor`. Home
    // Assistant sends a null `state` on a freshly added entity's early rows
    // and every consumer downstream believed the declared type. The filter
    // below treats null exactly as it did before (it is neither "unavailable"
    // nor "unknown"), so this changes no behaviour — it only stops the null
    // travelling any further.
    .map((s) => ({ t: new Date(s.last_changed).getTime(),
                   state: String(s.state ?? "") }))
    .filter((p) => Number.isFinite(p.t));
  // Collapse consecutive duplicate states (can happen when only attributes
  // changed between two reported points) so segment rendering doesn't draw
  // redundant boundaries.
  const out: StateHistoryPoint[] = [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].state !== p.state) out.push(p);
  }
  return out;
}
