// src/hooks/useStateHistory.ts
// "This entity's last N hours of states" for the device panels' timelines
// (LastDayTimeline) — through the history source's `stateWindow`, which moves
// a window that is entirely dead back to end at the device's last sighting.
//
// Also reports the request's `status`, which StateTimeline takes whole:
// loading, no history, and a failed request are three different answers.

import { useHistorySource } from "./useHistorySource";
import type { HistoryStatus } from "@/utils/statisticsSeries";
import type { StateHistoryPoint } from "@/types/ha.types";

export interface StateHistoryResult {
  data: StateHistoryPoint[];
  status: HistoryStatus;
  /** Set when the window had to be moved back to find any real data — the
   *  moment the device was last seen reporting. The UI says so rather than
   *  silently showing a window that is not the one that was asked for. */
  lastSeen?: number;
}

export function useStateHistory(entityId: string, hours = 24): StateHistoryResult {
  const { data, status } = useHistorySource({ w: { kind: "stateWindow", id: entityId, hours } });
  return { data: data?.w.data ?? [], status, lastSeen: data?.w.lastSeen };
}
