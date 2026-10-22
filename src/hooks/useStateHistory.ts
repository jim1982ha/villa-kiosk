// src/hooks/useStateHistory.ts
// "This entity's last N hours of states" for the device panels' timelines
// (LastDayTimeline) — through the history source's `stateWindow`, which moves
// a window that is entirely dead back to end at the device's last sighting,
// and reads the bands that follow it (`follow`: a linked sensor's) over that
// same window.
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
  /** Where the moved window ends (historySource StateWindow.end); undefined: now. */
  end?: number;
  /** The following bands' states over the same window. */
  followers?: Record<string, StateHistoryPoint[]>;
}

/** `entityId` null: nothing to load (the window's shared band answers instead). */
export function useStateHistory(entityId: string | null, hours = 24, follow: readonly string[] = []): StateHistoryResult {
  const { data, status } = useHistorySource(entityId === null ? null
    : { w: { kind: "stateWindow", id: entityId, hours, ...(follow.length ? { follow } : {}) } });
  const w = data?.w;
  return { data: w?.data ?? [], status, lastSeen: w?.lastSeen, end: w?.end, followers: w?.followers };
}
