// src/utils/rangeFilter.ts
// THE range filter of a trend chart (owner, 2026-10-26): two handles beside the chart's y-axis keep only the values
// between them. Each point of the chart becomes the average of ONLY the finer values inside [lo, hi] within that
// point's step, and a step with none inside is REMOVED: the kept steps are drawn side by side, one unbroken line with
// no gap (owner: "remove the X values so that only in-filter values are trended", "there shouldn't be any gap in the
// data"). It replaced a step held on the limit it passed (2.496.546), which still drew every step. A side with no
// limit is ±Infinity (a handle at that end of the axis).
//
// The finer values of a step (FINER): a five-minute step's are the readings themselves, each held until the next
// reading or outage and weighted by how long it held (trendInterval.knownSpans, the weights the chart's own values are
// made with); an hour's are the recorder's five-minute figures, a day's its hourly ones, a week's its daily ones, each
// counted once.
//
// The owner's example (tests/oracles/range_filter.mjs): daily averages of 7 days of hourly values, all 0 but day 2
// 500 for 1h, day 3 1000 for 1h, day 4 1500 all day, day 5 5000 for 2h and 2000 for 2h. Kept 3000 to 5000: day 5 alone
// is drawn, reading 5000 (only its two 5000 hours), never 3500.
//
// Also here, pure, everything the slider decides: when a range filters anything, where a handle goes for a pointer or
// a key, and the state that keeps a range per chart while the period changes and forgets it when another reading is
// opened. Pure: tests/oracles/range_filter.mjs.

import type { HistoryGap, HistoryPoint, HistorySeries } from "@/types/ha.types";
import { cellEdges, cellIndex } from "./timelineCells";
import { knownSpans } from "./trendInterval";
import { HOUR_MS } from "./localDay";
import type { StatisticsPeriod } from "./statisticsSeries";

/** The values kept: `lo` -Infinity is no lower limit, `hi` Infinity no upper one. */
export interface ValueRange { lo: number; hi: number }

/** Where a step's finer values come from: the readings themselves, or the recorder's figures of a finer period. */
export type FinerSource = "readings" | StatisticsPeriod;

/** The finer values of each chart step (historyRanges `period`): five minutes from the readings, an hour from the
 *  five-minute figures, a day from the hourly ones, a week (and a month) from the daily ones. */
export const FINER: Record<StatisticsPeriod, FinerSource> = {
  "5minute": "readings", hour: "5minute", day: "hour", week: "day", month: "day",
};

/** A chart's finer values, as the history source answers them (historySource "finer"). */
export interface FinerSeries {
  /** The chart period they refine, and the trend window they were read over (historySource "finer"): an answer for
   *  another period or window is not used (a period just changed). */
  of: StatisticsPeriod;
  window: { from: number; to: number };
  series: HistorySeries;
  /** Each value lasts this long and counts once (figures). Undefined: readings, each held until the next and weighted
   *  by how long it held. */
  stepMs?: number;
}

const inside = (v: number, r: ValueRange) => v >= r.lo && v <= r.hi;

/**
 * Each step between `edges` (the chart's own step edges, timelineCells.cellEdges): the average of its finer values
 * inside `range`, or null when none is. `window` clips the readings' spans to the chart's own window.
 */
export function stepsInRange(finer: Pick<FinerSeries, "series" | "stepMs">, edges: readonly number[], range: ValueRange,
  window?: { from: number; to: number }): (number | null)[] {
  const n = Math.max(0, edges.length - 1);
  const w = new Array<number>(n).fill(0), sum = new Array<number>(n).fill(0);
  if (finer.stepMs === undefined) {
    // readings: each held span, cut on the step edges, weighted by its duration
    const from = window?.from ?? -Infinity, to = window?.to ?? Infinity;
    for (const sp of knownSpans(finer.series)) {
      if (!inside(sp.v, range)) continue;
      const a0 = Math.max(sp.a, from), b0 = Math.min(sp.b, to);
      if (!(b0 > a0)) continue;
      for (let k = Math.max(0, cellIndex(edges, a0)); k < n && edges[k] < b0; k++) {
        const a = Math.max(a0, edges[k]), b = Math.min(b0, edges[k + 1]);
        if (b > a) { w[k] += b - a; sum[k] += (b - a) * sp.v; }
      }
    }
  } else {
    // figures: each value once, in the step its start falls in
    for (const p of finer.series.points) {
      const k = cellIndex(edges, p.t);
      if (k < 0 || k >= n || !inside(p.v, range)) continue;
      w[k] += 1; sum[k] += p.v;
    }
  }
  return w.map((wk, k) => (wk > 0 ? sum[k] / wk : null));
}

/** A chart filtered and closed up: what LineChart draws in place of the chart unfiltered. */
export interface KeptChart {
  /** The kept steps side by side, the k-th at `window.from + k × stepMs` and lasting `stepMs`: one unbroken line.
   *  No outages: a step that was out has nothing in range and is gone. */
  series: HistorySeries;
  /** A time on the closed-up chart → the real time it stands for: a kept step's own start (and its own length). */
  realAt: (t: number) => number;
  /** What the dates under the chart say: the first kept step, the middle one and the last (the window's end when the
   *  last is the step still running: "now"), real times. */
  ticks: [number, number, number];
  /** The real window's length, h: the dates and the tooltip are worded for the period chosen, not the kept part. */
  spanHours: number;
  /** The kept steps along the REAL window (fractions 0 to 1), consecutive ones merged: the ribbon under the chart. */
  ribbon: { from: number; to: number }[];
  /** How many steps are kept, of how many the chart had. */
  count: number;
  of: number;
}

/**
 * `base` (the chart as drawn unfiltered, in steps of `stepMs`) filtered to `range` from its finer values: each step
 * the average of its finer values in range, a step with none removed, the rest closed up.
 */
export function keptChart(base: HistorySeries, finer: Pick<FinerSeries, "series" | "stepMs">, stepMs: number,
  range: ValueRange): KeptChart {
  const { from, to } = base.window;
  const edges = cellEdges(from, to, stepMs);
  const steps = stepsInRange(finer, edges, range, base.window);
  const kept: { k: number; p: HistoryPoint }[] = [];
  for (const p of base.points) {
    const k = cellIndex(edges, p.t), v = k >= 0 && k < steps.length ? steps[k] : null;
    if (v !== null) kept.push({ k, p: { t: p.t, v } });
  }
  const n = kept.length;
  const points = kept.map(({ p }, j) => ({ t: from + j * stepMs, v: p.v }));
  const realAt = (t: number) => {
    if (n === 0) return from;
    const j = Math.max(0, Math.min(n - 1, Math.floor((t - from) / stepMs)));
    const k = kept[j].k, len = Math.min(edges[k + 1], to) - kept[j].p.t;
    return kept[j].p.t + Math.max(0, Math.min(1, (t - from - j * stepMs) / stepMs)) * len;
  };
  const last = n ? kept[n - 1] : null;
  const ticks: [number, number, number] = last
    ? [kept[0].p.t, kept[Math.floor((n - 1) / 2)].p.t, edges[last.k + 1] >= to ? to : last.p.t]
    : [from, (from + to) / 2, to];
  const span = to - from || 1, at = (t: number) => Math.max(0, Math.min(1, (t - from) / span));
  const ribbon: { from: number; to: number }[] = [];
  kept.forEach(({ k, p }, j) => {
    const a = at(p.t), b = at(edges[k + 1]);
    if (j > 0 && kept[j - 1].k === k - 1) ribbon[ribbon.length - 1].to = b; else ribbon.push({ from: a, to: b });
  });
  return {
    series: { ...base, points, gaps: [], window: { from, to: from + Math.max(1, n) * stepMs } },
    realAt, ticks, spanHours: span / HOUR_MS, ribbon, count: n, of: base.points.length,
  };
}

/** What a one-line chart draws for its range: the line, its x window, the closed-up chart, and where its detail
 *  stands. */
export interface RangeChart {
  points: HistoryPoint[];
  gaps: HistoryGap[];
  /** The kept steps' own window; the period's when unfiltered, still loading, or nothing is kept (the frame and the
   *  slider stay on the period, to widen the range). */
  window: { from: number; to: number } | undefined;
  /** The chart closed up, once its detail is in. */
  kept: KeptChart | null;
  /** "loading" (drawn unfiltered meanwhile) until the detail for THIS trend is in; "failed" when it could not be read. */
  state: "ready" | "loading" | "failed";
}

/**
 * THE filtered chart (architecture review N, 2026-10-27): `base` (the trend, unfiltered), the range set on it, and its
 * detail. The detail is used only when it was read for this period over this trend's own window: one read for a
 * later window would leave the chart's first steps with no detail (they vanished from a filtered chart left open).
 * Where the detail request stands is not an input: a reload asked for another chart keeps this one as it is (another
 * chart's range made every filtered chart blink unfiltered).
 */
export function rangeChart(base: HistorySeries | undefined, range: ValueRange | null, period: StatisticsPeriod,
  stepMs: number, detail: { finer?: FinerSeries; failed: boolean }): RangeChart {
  const on = base ? activeRange(range) : null;
  const plain = (state: RangeChart["state"]): RangeChart => ({
    points: base?.points ?? [], gaps: base?.gaps ?? [], window: base?.window, kept: null, state,
  });
  if (!on) return plain("ready");
  const f = detail.finer;
  if (!f || f.of !== period || f.window.from !== base!.window.from || f.window.to !== base!.window.to) {
    return plain(detail.failed ? "failed" : "loading");
  }
  const kept = keptChart(base!, f, stepMs, on);
  return { points: kept.series.points, gaps: kept.series.gaps,
    window: kept.count > 0 ? kept.series.window : base!.window, kept, state: "ready" };
}

// ── The slider ─────────────────────────────────────────────────────────────

/** The range when it limits either side, else null: with no limit (both handles at their ends) the chart is exactly
 *  as it is unfiltered. */
export function activeRange(range: ValueRange | null | undefined): ValueRange | null {
  return range && (Number.isFinite(range.lo) || Number.isFinite(range.hi)) ? range : null;
}

/** The axis a slider stands on: chartGeometry's series[0] (its ends and its ticks' step). */
export interface SliderAxis { lo: number; hi: number; step: number }

/** Where each handle is drawn: its limit, or its end of the axis when it has none. */
export function handleValues(range: ValueRange | null | undefined, axis: SliderAxis): ValueRange {
  const r = range ?? { lo: -Infinity, hi: Infinity };
  return { lo: Number.isFinite(r.lo) ? r.lo : axis.lo, hi: Number.isFinite(r.hi) ? r.hi : axis.hi };
}

/** How close the two handles may come, as a fraction of the axis: they never cross, nor sit on each other. */
export const HANDLE_GAP_OF_AXIS = 1 / 40;

/** A pointer this close (drawing px) to an end of the axis puts the handle AT that end: no limit on that side. */
export const END_PX = 4;

/** The arrow keys move a handle a tenth of the axis' tick step. */
export function handleGrain(step: number): number {
  return step / 10;
}

/** The value at pixel `y` on an axis drawn from `axis.lo` at `plot.bottom` to `axis.hi` at `plot.top` (the inverse of
 *  chartGeometry's `sy`), exact, held on the axis; within END_PX of an end, that end itself. */
export function valueAtY(axis: SliderAxis, plot: { top: number; bottom: number }, y: number): number {
  if (y <= plot.top + END_PX) return axis.hi;
  if (y >= plot.bottom - END_PX) return axis.lo;
  const f = (plot.bottom - y) / ((plot.bottom - plot.top) || 1);
  return axis.lo + f * (axis.hi - axis.lo);
}

/** The handle a pointer at value `v` takes: the nearer one (the upper from the middle up). */
export function nearerHandle(range: ValueRange | null | undefined, v: number, axis: SliderAxis): "lo" | "hi" {
  const at = handleValues(range, axis);
  return v >= (at.lo + at.hi) / 2 ? "hi" : "lo";
}

/** The lowest and highest of a chart's own values (its readings unfiltered): a limit stays between them. null: none. */
export function valueExtent(values: readonly number[]): ValueRange | null {
  const vs = values.filter(Number.isFinite);
  return vs.length ? { lo: Math.min(...vs), hi: Math.max(...vs) } : null;
}

/**
 * One handle moved to `v`: anywhere on the axis, exactly. At (or past) its own end of the axis it is no limit
 * (±Infinity); it never comes nearer the other than HANDLE_GAP_OF_AXIS, so it never reaches the other's end.
 * ⚠️ A HANDLE AT ITS END CUTS NOTHING (owner, 2026-10-26: a pump's daily averages top at 446 W while it runs at 900 W;
 * a top handle at 446 cut every running hour out): the finer values reach past the averages the axis shows.
 */
export function moveHandle(range: ValueRange | null | undefined, which: "lo" | "hi", v: number,
  axis: SliderAxis, extent?: ValueRange | null): ValueRange {
  const r = range ?? { lo: -Infinity, hi: Infinity };
  const at = handleValues(r, axis), gap = (axis.hi - axis.lo) * HANDLE_GAP_OF_AXIS;
  // ⚠️ A LIMIT STAYS AMONG THE CHART'S OWN VALUES (owner, 2026-10-30: a pump's power never below 0 read "≥ -1.5 kW"):
  // at or past its lowest reading the lower handle limits nothing, at or past its highest the upper one; whatever the
  // values are, a temperature below 0 included (the lower handle reaches its most negative reading, never beyond)
  const floor = extent ? Math.max(axis.lo, extent.lo) : axis.lo, ceiling = extent ? Math.min(axis.hi, extent.hi) : axis.hi;
  if (which === "hi") return { lo: r.lo, hi: v >= ceiling ? Infinity : Math.max(v, at.lo + gap) };
  return { lo: v <= floor ? -Infinity : Math.min(v, at.hi - gap), hi: r.hi };
}

/** A key on a handle: the arrows a grain, Page Up/Down a tick step, Home/End the axis' ends. null: not a slider key. */
export function keyMove(range: ValueRange | null | undefined, which: "lo" | "hi", key: string,
  axis: SliderAxis, extent?: ValueRange | null): ValueRange | null {
  const v = handleValues(range, axis)[which], g = handleGrain(axis.step);
  const to = key === "ArrowUp" || key === "ArrowRight" ? v + g
    : key === "ArrowDown" || key === "ArrowLeft" ? v - g
    : key === "PageUp" ? v + axis.step
    : key === "PageDown" ? v - axis.step
    : key === "Home" ? axis.lo
    : key === "End" ? axis.hi
    : null;
  return to === null ? null : moveHandle(range, which, to, axis, extent);
}

// ── Kept per chart, for one window ─────────────────────────────────────────

/** The ranges set in one history section, per series, for the readings it shows (`scope`). */
export interface FilterState { scope: string; ranges: Readonly<Record<string, ValueRange>> }

export const NO_FILTERS: FilterState = { scope: "", ranges: {} };

/** What a section's ranges belong to: the series it shows, never the period, so a range is kept while the period
 *  changes and forgotten when another reading is opened. */
export function filterScope(series: readonly { id: string }[]): string {
  return series.map((s) => s.id).join("|");
}

/** The range set on `id` in `scope`; null when none, or when it was set for other readings. */
export function filterOf(st: FilterState, scope: string, id: string): ValueRange | null {
  return st.scope === scope ? st.ranges[id] ?? null : null;
}

/** `st` with `id`'s range in `scope` set (null: shown in full); ranges of another scope are dropped. */
export function withFilter(st: FilterState, scope: string, id: string, r: ValueRange | null): FilterState {
  const ranges: Record<string, ValueRange> = st.scope === scope ? { ...st.ranges } : {};
  if (r) ranges[id] = r; else delete ranges[id];
  return { scope, ranges };
}
