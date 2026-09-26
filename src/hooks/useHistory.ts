// src/hooks/useHistory.ts
// "Fetch this history, and say where the request stands" — the one effect
// every panel's chart used to write out by hand: a `cancelled` guard, a
// `loading` flag, and a `.catch(() => {})` that turned a FAILED request into
// the same empty array as a sensor with no history. Seven copies, and the one
// in the Weather window drew the failure as "No rain, 0.0 mm".
//
// ⚠️ KEYED BY A STRING THAT SAYS WHAT IS BEING FETCHED — the ids and the range —
// never by an object. The bar's weather station was a NEW object on every state
// push anywhere in the villa, so a fetch keyed on it re-ran several times a
// second and cancelled itself: a 7-day chart never arrived (2.496.86).

import { useEffect, useRef, useState } from "react";
import type { HistoryStatus } from "@/utils/statisticsSeries";

export interface HistoryResult<T> {
  data: T;
  status: HistoryStatus;
  /** status === "loading" — the flag the charts' skeletons take. */
  loading: boolean;
}

/**
 * Run `load` whenever `key` changes; keep the last answer until the next one
 * lands (a failure clears it). `key === null` means "nothing to fetch": ready, with `initial`.
 * `load` is read from the latest render, so it may close over anything —
 * only `key` decides when it runs.
 */
export function useHistory<T>(key: string | null, load: () => Promise<T>, initial: T): HistoryResult<T> {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<HistoryStatus>(key === null ? "ready" : "loading");
  const loadRef = useRef(load);
  loadRef.current = load;
  const initialRef = useRef(initial);
  useEffect(() => {
    if (key === null) { setData(initialRef.current); setStatus("ready"); return; }
    let cancelled = false;
    setStatus("loading");
    loadRef.current()
      .then((d) => { if (!cancelled) { setData(d); setStatus("ready"); } })
      // The previous answer was for another key (another range): showing it
      // under this one's heading would be a chart of the wrong week.
      .catch(() => { if (!cancelled) { setData(initialRef.current); setStatus("failed"); } });
    return () => { cancelled = true; };
  }, [key]);
  return { data, status, loading: status === "loading" };
}
