// src/hooks/useStateHistory.ts
// Shared "fetch this entity's last N hours of state history" pattern used by
// every simple device panel (Light/Switch/Fan/Cover/Lock/Generic) to feed
// their "Last 24 hours" StateTimeline — six panels each hand-rolled the same
// useState + useEffect(fetch, cancelled-guard) block. Panels with a genuinely
// different history need (SensorPanel fetches numeric AND state history in
// parallel; DeviceGroupPanel fetches one series per group member) keep their
// own fetch effect rather than being forced through this.
//
// Also reports `loading` — the fetch and "HA genuinely has no history for
// this entity yet" used to be indistinguishable (both just an empty array),
// so a slow network read identically to "this device has never reported".
// StateTimeline/LastDayTimeline use it to show a neutral "loading" state
// instead of the more alarming "not enough history" one while a fetch is
// still in flight.

import { useEffect, useState } from "react";
import { UNKNOWN_STATES } from "@/utils/stateColors";
import type { StateHistoryPoint } from "@/types/ha.types";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";

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
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);
  const [lastSeen, setLastSeen] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLastSeen(undefined);
    // A device that has been down for longer than the chosen window has NOTHING
    // in it — every point is "unavailable", or there are no points at all — and
    // the panel then showed an empty strip, which reads as "no data" when the
    // useful fact is "it went down at 14:20 last Tuesday". When that happens,
    // look further back for the last moment it reported and show the SAME
    // window ending there, so the chart always answers "when did this stop".
    const alive = (h: StateHistoryPoint[]) =>
      h.some((pt) => !UNKNOWN_STATES.has(pt.state));
    fetchStateHistory(entityId, hours)
      .then(async (h) => {
        if (cancelled) return;
        if (alive(h)) { setHistory(h); setLoading(false); return; }
        const deep = await fetchStateHistory(entityId, LAST_SEEN_LOOKBACK_HOURS);
        if (cancelled) return;
        let seen = 0;
        for (const pt of deep) {
          if (!UNKNOWN_STATES.has(pt.state) && pt.t > seen) seen = pt.t;
        }
        if (seen === 0) { setHistory(h); setLoading(false); return; }
        // Keep the window's own length; only move where it ends.
        const from = seen - hours * 3600 * 1000;
        setHistory(deep.filter((pt) => pt.t >= from && pt.t <= seen + hours * 3600 * 1000));
        setLastSeen(seen);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId, hours]);
  return { data: history, loading, lastSeen };
}
