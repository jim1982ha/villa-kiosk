// src/hooks/useStateHistory.ts
// Shared "fetch this entity's last N hours of state history" pattern used by
// every simple device panel (Light/Switch/Fan/Cover/Lock/Generic) to feed
// their "Last 24 hours" StateTimeline — six panels each hand-rolled the same
// useState + useEffect(fetch, cancelled-guard) block. The fetch itself now
// runs through useHistory, like every other panel's; what this adds is the
// last-sighting lookback for a device that is down for the whole window.
//
// Also reports `loading` (useHistory's) — StateTimeline/LastDayTimeline show
// a neutral "loading" state instead of the more alarming "not enough history"
// one while a fetch is still in flight.

import { useHistory } from "./useHistory";
import type { StateHistoryPoint } from "@/types/ha.types";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { UNKNOWN_STATES } from "@/utils/stateColors";
import { windowEndingAt } from "@/utils/lineChart";

export interface StateHistoryResult {
  data: StateHistoryPoint[];
  loading: boolean;
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

export function useStateHistory(entityId: string, hours = 24): StateHistoryResult {
  // A device that has been down for longer than the chosen window has NOTHING
  // in it — every point is "unavailable", or there are no points at all — and
  // the panel then showed an empty strip, which reads as "no data" when the
  // useful fact is "it went down at 14:20 last Tuesday". When that happens,
  // look further back for the last moment it reported and show the SAME
  // window ending there, so the chart always answers "when did this stop".
  const { data, loading } = useHistory<{ data: StateHistoryPoint[]; lastSeen?: number }>(
    `${entityId}|${hours}`,
    async () => {
      const alive = (h: StateHistoryPoint[]) => h.some((pt) => !UNKNOWN_STATES.has(pt.state));
      const h = await fetchStateHistory(entityId, hours);
      if (alive(h)) return { data: h };
      const deep = await fetchStateHistory(entityId, LAST_SEEN_LOOKBACK_HOURS);
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
    },
    { data: [] },
  );
  return { data: data.data, loading, lastSeen: data.lastSeen };
}
