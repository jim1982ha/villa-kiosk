// src/components/panels/chartUtils.ts
// Shared formatters for every history chart. What the pointer is over is
// utils/chartGeometry's hover answer, not a helper here.

import type { StateHistoryPoint } from "@/types/ha.types";
import { clockTime, dayMonth, dayTime, monthShort } from "@/utils/dateText";
import { NOT_KEPT_WORDS } from "@/utils/stateColors";
import { nextEdge } from "@/utils/timelineCells";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/utils/localDay";

export function fmtChartValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function fmtChartTime(t: number): string {
  return clockTime(t);
}

/** A duration, as a person says it: "2s", "3min", "1h 20min", "2d 3h" (owner, 2026-10-24: the unit joined to its
 *  number) — rounded to the minute from a minute
 *  on, whole hours from a day on (never an hour more than it has been).
 *  ⚠️ ONE RULE ON BOTH APPS (architecture review round 2, 2026-10-16): the VESTA Agent's timeutil.lasting writes the
 *  same words — 89s was "1min" here and "89s" in its messages. The agreement's `duration.cases`
 *  (agent-contract.json) are the words, checked on both sides (tests/oracles/duration_words.mjs here). */
export function fmtDuration(ms: number): string {
  // no number, no words (architecture review K: NaN read "NaNd", an endless one "Infinityd")
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${Math.max(1, s)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}min` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** What a state band's slice covers, at the band's own step (owner, 2026-10-20: "adjust the tooltip to the time
 *  aggregation"): "14:20 – 14:25" for five minutes, the day ("15 Oct") for a day, "13 Oct – 19 Oct" for a week. */
export function fmtCellSpan(from: number, to: number, stepMs: number, spanHours: number): string {
  if (stepMs < DAY_MS) return `${fmtChartStamp(from, spanHours)} – ${fmtChartTime(to)}`;
  return fmtStepStamp(from, stepMs, spanHours);
}


/** ⚠️ A VALUE'S MOMENT AT ITS OWN STEP (owner, 2026-10-20: a daily value read "231 W · 15 Oct, 00:00"): under a day,
 *  its time (with the day when the window needs it); a day's value, the day alone; a week's, its first and last day;
 *  a month's, the month. Never a clock time for a day or longer — every chart's tooltip says it this way. */
export function fmtStepStamp(t: number, stepMs: number, spanHours: number): string {
  if (stepMs >= 28 * DAY_MS) return monthShort(t);
  if (stepMs >= 7 * DAY_MS) return `${dayMonth(t)} – ${dayMonth(nextEdge(t, stepMs) - 1)}`;
  if (stepMs >= DAY_MS) return dayMonth(t);
  return fmtChartStamp(t, spanHours);
}

/** How a chart's values were made from the readings, said beside its title (owner, 2026-10-20: "show the aggregation
 *  used … avg or sum"): its step ("5-min", "hourly", "daily", "weekly", "monthly") and, for a measured value, "avg" (the
 *  mean over the step), for a total "sum"; an on/off band has neither — its step alone. */
export type Aggregation = "avg" | "sum" | null;
export function stepWords(stepMs: number): string {
  if (stepMs >= 28 * DAY_MS) return "monthly";
  if (stepMs >= 7 * DAY_MS) return "weekly";
  if (stepMs >= DAY_MS) return "daily";
  if (stepMs >= HOUR_MS) return "hourly";
  return `${Math.round(stepMs / MINUTE_MS)}-min`;
}
export function aggregationWords(stepMs: number, aggregation: Aggregation): string {
  return aggregation ? `${stepWords(stepMs)} ${aggregation}` : stepWords(stepMs);
}

/** A day's or a week's slice in words, one line per state: how long it held, and how many times it began when more
 *  than once — the states that held longest first. Its changes one by one are a five-minute slice's. */
export function cellSummary(spent: Record<string, number>, entered: Record<string, number>,
  words: (state: string) => string): { state: string; text: string }[] {
  return Object.entries(spent).sort((a, b) => b[1] - a[1]).map(([state, ms]) => ({
    state, text: `${words(state)} · ${fmtDuration(ms)}${(entered[state] ?? 0) > 1 ? ` · ${entered[state]} times` : ""}`,
  }));
}

/** An outage in a chart's tooltip: "Unavailable · 05:21–05:24 (3 min)", or
 *  "Unavailable since 05:21" for one still running at `now` (the window's end). */
export function fmtOutage(gap: { from: number; to: number; actual?: { from: number; to: number }; notKept?: boolean },
  now: number): string {
  // older than the villa's system keeps: not an outage (historySource.keptFrom, owner 2026-10-20)
  if (gap.notKept) return `${NOT_KEPT_WORDS} · before ${dayTime(gap.to)}`;
  // The real times, when the band was widened to whole five-minute intervals.
  const g = gap.actual ?? gap;
  if (!Number.isFinite(g.to) || g.to >= now) return `Unavailable since ${fmtChartTime(g.from)} (${fmtDuration(now - g.from)})`;
  return `Unavailable · ${fmtChartTime(g.from)}–${fmtChartTime(g.to)} (${fmtDuration(g.to - g.from)})`;
}

/** An x-axis tick: the time of day while the window is two days or less,
 *  the date beyond — a "14:20" under a 7-day chart names no day at all. One
 *  labeller for every chart; the Weather charts had a second. */
export function fmtChartTick(t: number, spanHours: number): string {
  if (spanHours <= 48) return fmtChartTime(t);
  return dayMonth(t);
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
  return dayTime(d);
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
