// src/hooks/useStateHistory.ts
// Shared "fetch this entity's last N hours of state history" pattern used by
// every simple device panel (Light/Switch/Fan/Cover/Lock/Generic) to feed
// their "Last 24 hours" StateTimeline — six panels each hand-rolled the same
// useState + useEffect(fetch, cancelled-guard) block. The fetch itself now
// runs through useHistory, like every other panel's; what this adds is the
// last-sighting lookback for a device that is down for the whole window.
//
// Also reports useHistory's `status`, which StateTimeline takes whole:
// loading, no history, and a failed request are three different answers.

import { useHistory } from "./useHistory";
import type { HistoryStatus } from "@/utils/statisticsSeries";
import type { StateHistoryPoint } from "@/types/ha.types";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { UNKNOWN_STATES } from "@/utils/stateColors";
import { windowEndingAt } from "@/utils/lineChart";

export interface StateHistoryResult {
  data: StateHistoryPoint[];
  status: HistoryStatus;
  /** Set when the window had to be moved back to find any real data — the
   *  moment the device was last seen reporting. The UI says so rather than
   *  silently showing a window that is not the one that was asked for. */
  lastSeen?: number;
}

/** How far back to look for a device's last sighting when the requested window
 *  is entirely dead. Long enough to cover a device that failed weeks ago, short
 *  enough that the query stays cheap; beyond it, "not enough history" is the
 *  honest answer. */
const LAST_SEEN_LOOKBACK_HOURS = 24 * 60;

/**
 * The window to chart, and — when the asked-for window is entirely dead — the
 * same window moved back to END at the device's last sighting.
 *
 * A device that has been down for longer than the chosen window has NOTHING
 * in it — every point is "unavailable", or there are no points at all — and
 * the panel then showed an empty strip, which reads as "no data" when the
 * useful fact is "it went down at 14:20 last Tuesday". When that happens,
 * look further back for the last moment it reported and show the SAME
 * window ending there, so the chart always answers "when did this stop".
 * `fetch` is a parameter so the rule can be driven without a network.
 */
export async function loadStateWindow(
  entityId: string, hours: number,
  fetch: (id: string, hours: number) => Promise<StateHistoryPoint[]> = fetchStateHistory,
): Promise<{ data: StateHistoryPoint[]; lastSeen?: number }> {
  const alive = (h: StateHistoryPoint[]) => h.some((pt) => !UNKNOWN_STATES.has(pt.state));
  const h = await fetch(entityId, hours);
  if (alive(h)) return { data: h };
  const deep = await fetch(entityId, LAST_SEEN_LOOKBACK_HOURS);
  let seen = 0;
  for (const pt of deep) {
    if (!UNKNOWN_STATES.has(pt.state) && pt.t > seen) seen = pt.t;
  }
  if (seen === 0) return { data: h };
  // Keep the window's own length; only move where it ENDS — at the
  // sighting. It used to keep points up to `seen + hours`, twice the
  // window, and to drop the row BEFORE `from` that says what state the
  // window opened in (StateTimeline reads data[0] as holding from the
  // window's start). The bar then draws exactly this span: see its `end`.
  return { data: windowEndingAt(deep, seen, hours), lastSeen: seen };
}

/** The section header's title: the range, and — when the window had to be
 *  moved to find data — the moment it ends, because an unlabelled chart of a
 *  different period is worse than no chart. */
export function historyTitle(rangeTitle: string, lastSeen: number | undefined): string {
  return lastSeen
    ? `${rangeTitle} before ${new Date(lastSeen).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : rangeTitle;
}

export function useStateHistory(entityId: string, hours = 24): StateHistoryResult {
  const { data, status } = useHistory<{ data: StateHistoryPoint[]; lastSeen?: number }>(
    `${entityId}|${hours}`, () => loadStateWindow(entityId, hours), { data: [] });
  return { data: data.data, status, lastSeen: data.lastSeen };
}
