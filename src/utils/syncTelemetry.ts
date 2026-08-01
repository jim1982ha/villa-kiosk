// src/utils/syncTelemetry.ts
// How a server-backed store reports itself. One implementation for both, for
// the same reason the diff/push protocol and the refresh triggers are shared:
// a diagnosis is only as good as the weakest-instrumented store, and the FM
// store having no telemetry at all meant a real field report ("the fault
// status didn't reach my phone") arrived with a log that could not distinguish
// a broken write from a screen that simply hadn't asked yet.
//
// The dedupe is not an optimisation, it is what keeps the log readable. The
// ring holds only the newest 500 events; a phone fires a pull on every
// visibilitychange (which it does every few seconds) and an open panel polls
// on a 15s beat, so without this the steady state would evict the very
// history it exists to explain. A CHANGE is always reported; an unchanged
// outcome is reported once and then goes quiet.

import { useCallback, useRef } from "react";
import { report as reportTelemetry } from "./telemetry";

/** @param store Which store the event is about — every dump carries both. */
export function useSyncReporter(store: "config" | "fm") {
  const lastSig = useRef<string>("");
  return useCallback((data: Record<string, unknown>) => {
    const sig = JSON.stringify(data);
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    reportTelemetry("sync", { store, ...data });
  }, [store]);
}
