// src/hooks/useStateHistory.ts
// Shared "fetch this entity's last N hours of state history" pattern used by
// every simple device panel (Light/Switch/Fan/Cover/Lock/Generic) to feed
// their "Last 24 hours" StateTimeline — six panels each hand-rolled the same
// useState + useEffect(fetch, cancelled-guard) block. Panels with a genuinely
// different history need (SensorPanel fetches numeric AND state history in
// parallel; DeviceGroupPanel fetches one series per group member) keep their
// own fetch effect rather than being forced through this.

import { useEffect, useState } from "react";
import type { StateHistoryPoint } from "@/types/ha.types";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";

export function useStateHistory(entityId: string, hours = 24): StateHistoryPoint[] {
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(entityId, hours).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [entityId, hours]);
  return history;
}
