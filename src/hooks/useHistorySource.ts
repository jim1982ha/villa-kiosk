// src/hooks/useHistorySource.ts
// A panel's door to the history source: say WHAT history (the requests), get
// the answer and where it stands. The key, the clock reading, the port and
// the cancel/failed handling are all decided here, once — a panel builds no
// key string, reads no clock and names no fetcher.

import { useMemo } from "react";
import { useHA } from "@/ha/HAStateStore";
import { haHistoryPort } from "@/ha/HAHistoryAPI";
import {
  historyKey, loadHistory, type HistoryAnswers, type HistoryRequests,
} from "@/ha/historySource";
import { useHistory, type HistoryResult } from "./useHistory";

/**
 * Load `requests` (null: nothing to load) and keep the answer until the next
 * one lands. Re-runs when what is asked for changes, or `refresh` does (a
 * window that stays open and must follow the recorder). All the requests are
 * answered over ONE clock reading, taken when the load starts.
 */
export function useHistorySource<Q extends HistoryRequests>(
  requests: Q | null, refresh?: string | number,
): HistoryResult<HistoryAnswers<Q> | null> {
  const { ws } = useHA();
  const port = useMemo(() => haHistoryPort(ws), [ws]);
  const key = requests ? `${historyKey(requests)}#${refresh ?? ""}` : null;
  return useHistory<HistoryAnswers<Q> | null>(
    key, () => loadHistory(port, requests!, Date.now()), null);
}
