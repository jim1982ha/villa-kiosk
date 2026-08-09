// src/components/panels/chartUtils.ts
// Shared formatters + hit-testing for the panel mini charts (Sparkline,
// DualSparkline). Kept DRY so both charts label axes and resolve the hovered
// datapoint the same way.

import type { StateHistoryPoint } from "@/types/ha.types";

export function fmtChartValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function fmtChartTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * A timestamp for a chart TOOLTIP, with the day included only when it adds
 * something: a bare "14:20" is unambiguous while the chart covers today, and
 * meaningless on a 7-day window where the reader cannot tell which 14:20 it is.
 *
 * Driven off the window the chart is showing rather than off the timestamp's
 * own age, so every point in one chart is formatted the same way — a tooltip
 * that gained and lost a date as the pointer moved would be worse than either
 * form. The one exception is a point that is not from today, which earns the
 * date even inside a short window (an unavailable device's history is anchored
 * to when it was last seen, so a "24h" chart there can sit entirely in the
 * past).
 */
export function fmtChartStamp(t: number, spanHours: number): string {
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  if (spanHours <= 24 && sameDay) return fmtChartTime(t);
  return d.toLocaleString([], {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Index of the point whose x is closest to the given plot-space x. */
export function nearestIndexByX(pts: { x: number }[], x: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i].x - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Merge several NAMED state-history series into ONE composite StateTimeline
 * series — e.g. a camera's own online/offline history layered with its
 * linked motion sensor's on/off history into a single "offline / online /
 * motion" bar, reusing StateTimeline itself rather than a bespoke chart.
 *
 * Walks every distinct timestamp across all input series (ascending), keeping
 * each series' most-recently-known state as of that instant, and asks
 * `resolve` to derive the ONE composite state from that snapshot — emitting a
 * new output point only when the composite actually changes, exactly like a
 * real StateHistoryPoint series (one point per genuine transition, not one
 * per input sample).
 */
export function mergeStateHistories(
  series: Record<string, StateHistoryPoint[]>,
  resolve: (current: Record<string, string | undefined>) => string,
): StateHistoryPoint[] {
  const names = Object.keys(series);
  const allTimes = [...new Set(names.flatMap((n) => series[n].map((p) => p.t)))].sort((a, b) => a - b);
  const idx: Record<string, number> = Object.fromEntries(names.map((n) => [n, -1]));
  const current: Record<string, string | undefined> = {};
  const out: StateHistoryPoint[] = [];
  let last: string | null = null;
  for (const t of allTimes) {
    for (const n of names) {
      const pts = series[n];
      while (idx[n] + 1 < pts.length && pts[idx[n] + 1].t <= t) idx[n]++;
      if (idx[n] >= 0) current[n] = pts[idx[n]].state;
    }
    const composite = resolve(current);
    if (composite !== last) {
      out.push({ t, state: composite });
      last = composite;
    }
  }
  return out;
}
