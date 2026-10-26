// src/utils/viewPrefs.ts
// Per-device view preferences kept in localStorage: the saved overview camera
// pose and whether the first-run tips were seen. Split out of utils/storage.ts
// (round 10, 2.496.162).

import { readJson, readString, writeJson, writeString } from "./storedJson";
import { storageWorks } from "@/utils/storedJson";
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
  // Storage disabled reads as SEEN — don't show a tips card that can never be
  // dismissed-and-remembered. (readString is null for both absent and
  // disabled, so the write is probed instead.)
  return readString(FIRST_RUN_TIPS_KEY) === "1" || !storageWorks();
}

export function markFirstRunTipsSeen(): void {
  writeString(FIRST_RUN_TIPS_KEY, "1");
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
  if (!writeJson(OVERVIEW_VIEW_KEY, view)) console.error("[storage] failed to save overview view");
}

export function loadOverviewView(): OverviewViewSnapshot | null {
  return readJson<OverviewViewSnapshot>(OVERVIEW_VIEW_KEY, (v): v is OverviewViewSnapshot =>
    typeof v === "object" && v !== null && ["alpha", "beta", "radius", "targetX", "targetY", "targetZ"].every((k) => Number.isFinite((v as Record<string, unknown>)[k])));
}

// ── Charts from 0 ───────────────────────────────────────────────────────────
// ⚠️ A TREND READS FROM 0 (owner, 2026-10-26: "show the 0 in the Y axis … so it is easier to read trends charts";
// opening from 0, one tap on any chart's Y axis zooms every chart to its values, and back): a battery that went from
// 40 to 91 % read as a cliff on a 40-90 axis. Per tablet, for every chart; absent (or no storage): from 0.

const CHARTS_FROM_ZERO_KEY = "villa-kiosk:charts-from-zero";
const chartZeroListeners = new Set<() => void>();
let chartsZeroNow: boolean | null = null;

/** Whether every line chart's y-axis starts at 0 on this tablet (the default), or is zoomed to its values. */
export function chartsFromZero(): boolean {
  if (chartsZeroNow === null) chartsZeroNow = readString(CHARTS_FROM_ZERO_KEY) !== "0";
  return chartsZeroNow;
}

/** Sets it for every chart on this tablet, and tells each chart shown now. */
export function setChartsFromZero(on: boolean): void {
  chartsZeroNow = on;
  writeString(CHARTS_FROM_ZERO_KEY, on ? "1" : "0");
  chartZeroListeners.forEach((l) => l());
}

/** Calls `listener` whenever it changes; returns the unsubscribe (useSyncExternalStore's shape). */
export function onChartsFromZero(listener: () => void): () => void {
  chartZeroListeners.add(listener);
  return () => { chartZeroListeners.delete(listener); };
}
