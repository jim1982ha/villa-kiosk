// src/utils/viewPrefs.ts
// Per-device view preferences kept in localStorage: the saved overview camera
// pose and whether the first-run tips were seen. Split out of utils/storage.ts
// (round 10, 2.496.162).

// ── Per-device overview camera default ──────────────────────────────────────
// Deliberately NOT part of AppConfig, which is shared across devices: the
// whole reason a saved overview pose is needed is that different devices (a
// wall tablet vs. a phone in portrait) need different framing for the same
// villa. Keeping it in its own localStorage key means it always reflects
// THIS device/browser's own screen.

// ── First-run tips ───────────────────────────────────────────────────────────
// The icon-only HUD chrome plus several tap/long-press gestures (Rooms button,
// the overview "save default view" anchor) have no discovery path for someone
// using the kiosk for the first time — hover tooltips explain them, but never
// reach a touchscreen. FirstRunTips shows a one-time card covering both, gated
// per-BROWSER (not per-profile): whichever profile is first to log in on a
// given kiosk/device sees it, and it never reappears there afterward, even for
// a different profile signing in later. Simple default; villa staff can reset
// it (along with everything else per-device) by clearing site data.

const FIRST_RUN_TIPS_KEY = "villa-kiosk:first-run-tips-seen";

export function hasSeenFirstRunTips(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_TIPS_KEY) === "1";
  } catch {
    return true; // storage disabled — don't show a tips card that can never be dismissed-and-remembered
  }
}

export function markFirstRunTipsSeen(): void {
  try {
    localStorage.setItem(FIRST_RUN_TIPS_KEY, "1");
  } catch { /* storage disabled */ }
}

const OVERVIEW_VIEW_KEY = "villa-kiosk:overview-view";

export interface OverviewViewSnapshot {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export function saveOverviewView(view: OverviewViewSnapshot): void {
  try {
    localStorage.setItem(OVERVIEW_VIEW_KEY, JSON.stringify(view));
  } catch (err) {
    console.error("[storage] failed to save overview view", err);
  }
}

export function loadOverviewView(): OverviewViewSnapshot | null {
  const raw = localStorage.getItem(OVERVIEW_VIEW_KEY);
  return raw ? (JSON.parse(raw) as OverviewViewSnapshot) : null;
}
