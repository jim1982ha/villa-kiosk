// src/utils/autoReload.ts
// Kiosk safety net: reload the tab once a day during a quiet overnight window,
// so any slow, still-unpinned memory drift (observed ~37MB/hour idle on a
// real villa's kiosk — a genuine but low-priority leak under normal GC churn,
// not the earlier confirmed/fixed bugs) never accumulates for more than about
// a day. This is a deliberate blunt mitigation, not a fix for the underlying
// drift — chosen because the drift is slow enough not to be urgent, and
// further live-heap diagnosis on a fielded kiosk carries its own risk (a
// DevTools heap snapshot crashed the tab outright once already, at ~800MB).
//
// Reload is a plain location.reload(): the profile role lives in
// sessionStorage (survives a same-tab reload) and the model/app shell are
// service-worker cached, so this comes back fast with no re-login needed —
// safe to fire unattended overnight.

const RELOAD_HOUR = 4; // 04:00 local device time — a quiet window for a villa kiosk
const CHECK_INTERVAL_MS = 60_000;
const GUARD_KEY = "villa-kiosk:last-auto-reload-date";

// ── Memory safety valve ────────────────────────────────────────────────────
// The clock-based reload above has a hole for the exact device this app targets:
// a wall tablet left on for weeks. At the documented ~37MB/hour idle drift, a
// tab that reloads at 04:00 can still accumulate ~900MB before the NEXT 04:00
// comes round — and a mobile browser kills a tab well before that, which the
// user experiences as the kiosk going white/unresponsive rather than as a tidy
// overnight refresh. Time since the last reload is a proxy for accumulated
// memory; this watches the accumulation directly and acts on it, so a fast
// drift (or simply a long-lived tab) does not have to wait for a clock.
//
// Expressed as a FRACTION of the browser's own heap limit, not an absolute MB
// figure: that limit differs by an order of magnitude across the devices this
// runs on (phone / tablet / desktop), and a hardcoded ceiling would either
// never fire on one or fire constantly on another.
const HEAP_PRESSURE_RATIO = 0.7;
// Never let the valve become a reload loop: if the app is genuinely using this
// much heap right after starting, reloading cannot help and would just cycle.
const MIN_UPTIME_BEFORE_PRESSURE_RELOAD_MS = 60 * 60_000; // 1 hour
const PRESSURE_GUARD_KEY = "villa-kiosk:last-pressure-reload";
const MIN_INTERVAL_BETWEEN_PRESSURE_RELOADS_MS = 6 * 60 * 60_000; // 6 hours

function todayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; // local calendar day
}

/** Fraction of the JS heap limit currently in use, or null where the browser
 *  does not expose it. Chrome-family only (`performance.memory` is not a
 *  standard and Safari/Firefox omit it) — so this valve covers Android tablets
 *  and desktop, while iOS keeps relying on the clock reload plus its own
 *  context-loss recovery (see SceneManager.handlePageShow), which is the path
 *  that platform already self-manages. */
function heapPressure(): number | null {
  const mem = (performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!mem || !mem.jsHeapSizeLimit) return null;
  return mem.usedJSHeapSize / mem.jsHeapSizeLimit;
}

/**
 * Call once (e.g. from Dashboard). `isSafeToReload` is polled every minute —
 * it should return false while any panel/modal is open or the user has
 * interacted recently, so a reload never interrupts someone mid-use. Returns
 * an unsubscribe function.
 *
 * Two independent triggers, both gated on `isSafeToReload`: the daily quiet-hour
 * refresh, and the heap-pressure valve above.
 */
export function installDailyAutoReload(isSafeToReload: () => boolean): () => void {
  const startedAt = Date.now();

  const dailyDue = (now: Date): boolean => {
    if (now.getHours() !== RELOAD_HOUR) return false;
    let already = "";
    try { already = localStorage.getItem(GUARD_KEY) ?? ""; } catch { /* storage disabled */ }
    return already !== todayKey(now); // not already reloaded today
  };

  const pressureDue = (now: number): boolean => {
    const ratio = heapPressure();
    if (ratio === null || ratio < HEAP_PRESSURE_RATIO) return false;
    // A freshly-started tab already over the line is not drift — reloading it
    // would only repeat, so leave it alone and let the daily refresh handle it.
    if (now - startedAt < MIN_UPTIME_BEFORE_PRESSURE_RELOAD_MS) return false;
    let last = 0;
    try { last = Number(localStorage.getItem(PRESSURE_GUARD_KEY)) || 0; } catch { /* storage disabled */ }
    return now - last >= MIN_INTERVAL_BETWEEN_PRESSURE_RELOADS_MS;
  };

  const tick = () => {
    const now = new Date();
    const daily = dailyDue(now);
    const pressure = !daily && pressureDue(now.getTime());
    if (!daily && !pressure) return;
    if (!isSafeToReload()) return; // busy — retry next minute
    try {
      if (daily) localStorage.setItem(GUARD_KEY, todayKey(now));
      // Stamped for BOTH triggers: a daily reload resets the heap just as a
      // pressure one does, so it must also restart the pressure cooldown —
      // otherwise a tab that crossed the threshold shortly before 04:00 could
      // reload twice in quick succession for the same accumulated memory.
      localStorage.setItem(PRESSURE_GUARD_KEY, String(now.getTime()));
    } catch { /* best-effort */ }
    location.reload();
  };
  const id = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(id);
}
