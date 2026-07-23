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
import type { StateHistoryPoint } from "@/types/ha.types";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";

export interface StateHistoryResult {
  data: StateHistoryPoint[];
  loading: boolean;
}

export function useStateHistory(entityId: string, hours = 24): StateHistoryResult {
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStateHistory(entityId, hours)
      .then((h) => { if (!cancelled) { setHistory(h); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId, hours]);
  return { data: history, loading };
}
