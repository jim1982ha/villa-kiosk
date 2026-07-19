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

function todayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; // local calendar day
}

/**
 * Call once (e.g. from Dashboard). `isSafeToReload` is polled every minute —
 * it should return false while any panel/modal is open or the user has
 * interacted recently, so a reload never interrupts someone mid-use. Returns
 * an unsubscribe function.
 */
export function installDailyAutoReload(isSafeToReload: () => boolean): () => void {
  const tick = () => {
    const now = new Date();
    if (now.getHours() !== RELOAD_HOUR) return;
    let already = "";
    try { already = localStorage.getItem(GUARD_KEY) ?? ""; } catch { /* storage disabled */ }
    if (already === todayKey(now)) return; // already reloaded today
    if (!isSafeToReload()) return; // busy — retry next minute, still within the hour
    try { localStorage.setItem(GUARD_KEY, todayKey(now)); } catch { /* best-effort */ }
    location.reload();
  };
  const id = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(id);
}
