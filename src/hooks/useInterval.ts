// src/hooks/useInterval.ts
// "Run this every N ms while mounted" — the effect five components wrote out
// (HUD clock, Weather 'now', Energy refresh, the passcode lockout countdown,
// the real-sun re-aim) (2.496.199). `null` pauses it. The LATEST callback
// runs, so a caller never restarts the timer just because its closure moved.

import { useEffect, useRef, useState } from "react";

export function useInterval(fn: () => void, ms: number | null): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => latest.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** The time, refreshed every `ms` — a clock's or a "now" line's re-render. Written out as state + useInterval by the
 *  HUD clock and the Weather window. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}
