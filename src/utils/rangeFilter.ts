// src/utils/rangeFilter.ts
// THE range filter of a trend chart (owner, 2026-10-26): two handles beside the chart's y-axis keep only the values
// between them. Each point of the chart becomes the average of ONLY the finer values inside [lo, hi] within that
// point's step; a point with none inside is 0, and counts as 0 in the overall average.
//
// The finer values of a step (FINER): a five-minute step's are the readings themselves, each held until the next
// reading or outage and weighted by how long it held (trendInterval.knownSpans, the weights the chart's own values are
// made with); an hour's are the recorder's five-minute figures, a day's its hourly ones, a week's its daily ones, each
// counted once.
//
// The owner's example (tests/oracles/range_filter.mjs): daily averages of 7 days of hourly values, all 0 but day 2
// 500 for 1h, day 3 1000 for 1h, day 4 1500 all day, day 5 5000 for 2h and 2000 for 2h. Kept 3000 to 5000: day 5 reads
// 5000 (only its two 5000 hours), never 3500, and every other day 0. Unfiltered, day 2 reads 500 / 24.
//
// Also here, pure, everything the slider decides: its defaults, when a range filters anything, where a handle goes
// for a pointer or a key, and the state that keeps a range per chart while the period changes and forgets it when
// another reading is opened. Pure: tests/oracles/range_filter.mjs.

import type { HistoryPoint, HistorySeries } from "@/types/ha.types";
import { cellEdges, cellIndex } from "./timelineCells";
import { knownSpans } from "./trendInterval";
import type { StatisticsPeriod } from "./statisticsSeries";

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
  /** The chart period they refine: an answer for another period is not used (a period just changed). */
  of: StatisticsPeriod;
  series: HistorySeries;
  /** Each value lasts this long and counts once (figures). Undefined: readings, each held until the next and weighted
   *  by how long it held. */
  stepMs?: number;
}

/** One chart step, filtered: the average of its finer values inside the range (0 when none is; null when the step has
 *  no finer value at all), and how long those inside lasted. */
export interface StepInRange { v: number | null; inRangeMs: number }

const inside = (v: number, r: ValueRange) => v >= r.lo && v <= r.hi;

/**
 * Each step between `edges` (the chart's own step edges, timelineCells.cellEdges), filtered to `range`. `window`
 * clips the readings' spans to the chart's own window.
 */
export function stepsInRange(finer: Pick<FinerSeries, "series" | "stepMs">, edges: readonly number[], range: ValueRange,
  window?: { from: number; to: number }): StepInRange[] {
  const n = Math.max(0, edges.length - 1);
  const w = new Array<number>(n).fill(0), sum = new Array<number>(n).fill(0);
  const ms = new Array<number>(n).fill(0), any = new Array<boolean>(n).fill(false);
  if (finer.stepMs === undefined) {
    // readings: each held span, cut on the step edges, weighted by its duration
    const from = window?.from ?? -Infinity, to = window?.to ?? Infinity;
    for (const sp of knownSpans(finer.series)) {
      const a0 = Math.max(sp.a, from), b0 = Math.min(sp.b, to);
      if (!(b0 > a0)) continue;
      for (let k = Math.max(0, cellIndex(edges, a0)); k < n && edges[k] < b0; k++) {
        const a = Math.max(a0, edges[k]), b = Math.min(b0, edges[k + 1]);
        if (!(b > a)) continue;
        any[k] = true;
        if (inside(sp.v, range)) { w[k] += b - a; sum[k] += (b - a) * sp.v; ms[k] += b - a; }
      }
    }
  } else {
    // figures: each value once, in the step its start falls in
    for (const p of finer.series.points) {
      const k = cellIndex(edges, p.t);
      if (k < 0 || k >= n) continue;
      any[k] = true;
      if (inside(p.v, range)) { w[k] += 1; sum[k] += p.v; ms[k] += finer.stepMs; }
    }
  }
  return w.map((wk, k) => ({ v: wk > 0 ? sum[k] / wk : any[k] ? 0 : null, inRangeMs: ms[k] }));
}

/** A chart's series filtered: each of its points the average of its step's finer values in range (0 when none), the
 *  average of those points, and how long the finer values in range lasted. */
export interface FilteredSeries { series: HistorySeries; avg: number; inRangeMs: number }

/**
 * `base` (the chart as drawn unfiltered, in steps of `stepMs`) filtered to `range` from its finer values. Every point
 * of the chart stays where it is, with its new value; its outages are unchanged.
 */
export function filterSeries(base: HistorySeries, finer: Pick<FinerSeries, "series" | "stepMs">, stepMs: number,
  range: ValueRange): FilteredSeries {
  const edges = cellEdges(base.window.from, base.window.to, stepMs);
  const steps = stepsInRange(finer, edges, range, base.window);
  const counted = new Set<number>();
  const points = base.points.map((p) => {
    const k = cellIndex(edges, p.t);
    const s = k >= 0 && k < steps.length ? steps[k] : null;
    if (s) counted.add(k);
    return { t: p.t, v: s?.v ?? 0 };
  });
  let inRangeMs = 0;
  for (const k of counted) inRangeMs += steps[k].inRangeMs;
  const avg = points.length ? points.reduce((a, p) => a + p.v, 0) / points.length : 0;
  return { series: { ...base, points }, avg, inRangeMs };
}

// ── The slider ─────────────────────────────────────────────────────────────

/** The range a chart opens on: the lowest and highest of the values it shows unfiltered; null with none. */
export function defaultRange(points: readonly HistoryPoint[]): ValueRange | null {
  if (points.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  return { lo, hi };
}

/** The range when it leaves out any value the chart shows unfiltered, else null: at its defaults (or wider) the chart
 *  is exactly as it is unfiltered. */
export function activeRange(range: ValueRange | null | undefined, points: readonly HistoryPoint[]): ValueRange | null {
  const d = defaultRange(points);
  if (!range || !d) return null;
  return range.lo > d.lo || range.hi < d.hi ? range : null;
}

/** The handles' values on an axis from `bounds.lo` to `bounds.hi`: the range (or the defaults), held on the axis. */
export function shownRange(range: ValueRange | null | undefined, points: readonly HistoryPoint[],
  bounds: ValueRange): ValueRange {
  const r = range ?? defaultRange(points) ?? bounds;
  const hold = (v: number) => Math.max(bounds.lo, Math.min(bounds.hi, v));
  return { lo: hold(r.lo), hi: hold(r.hi) };
}

/** A drag lands on a tenth of the axis' tick step: a value the pill can say exactly. */
export const HANDLE_GRAIN_OF_STEP = 1 / 10;

/** What a handle's value is read to on an axis whose ticks are `step` apart. */
export function handleGrain(step: number): number {
  return step * HANDLE_GRAIN_OF_STEP;
}

/** The value at pixel `y` on an axis drawn from `axis.lo` at `plot.bottom` to `axis.hi` at `plot.top` (the inverse of
 *  chartGeometry's `sy`), on the grain, held on the axis. */
export function valueAtY(axis: { lo: number; hi: number; step: number }, plot: { top: number; bottom: number },
  y: number): number {
  const f = (plot.bottom - y) / ((plot.bottom - plot.top) || 1);
  return holdOn(axis, axis.lo + f * (axis.hi - axis.lo));
}

/** `v` on the grain, held between the axis' ends (each end reachable exactly). */
function holdOn(axis: { lo: number; hi: number; step: number }, v: number): number {
  const g = handleGrain(axis.step);
  const snapped = g > 0 ? Math.round(v / g) * g : v;
  return Math.max(axis.lo, Math.min(axis.hi, Number(snapped.toPrecision(12))));
}

/** The handle a pointer at value `v` takes: the nearer one (the upper from the middle up). */
export function nearerHandle(r: ValueRange, v: number): "lo" | "hi" {
  return v >= (r.lo + r.hi) / 2 ? "hi" : "lo";
}

/** One handle moved to `v`: on the axis, and never past the other. */
export function moveHandle(r: ValueRange, which: "lo" | "hi", v: number,
  axis: { lo: number; hi: number; step: number }): ValueRange {
  const at = holdOn(axis, v);
  return which === "lo" ? { lo: Math.min(at, r.hi), hi: r.hi } : { lo: r.lo, hi: Math.max(at, r.lo) };
}

/** A key on a handle: the arrows a grain, Page Up/Down a tick step, Home/End the axis' end. null: not a slider key. */
export function keyMove(r: ValueRange, which: "lo" | "hi", key: string,
  axis: { lo: number; hi: number; step: number }): ValueRange | null {
  const v = r[which], g = handleGrain(axis.step);
  const to = key === "ArrowUp" || key === "ArrowRight" ? v + g
    : key === "ArrowDown" || key === "ArrowLeft" ? v - g
    : key === "PageUp" ? v + axis.step
    : key === "PageDown" ? v - axis.step
    : key === "Home" ? axis.lo
    : key === "End" ? axis.hi
    : null;
  return to === null ? null : moveHandle(r, which, to, axis);
}

/** The two value pills' centres: beside their handles, pushed apart to `gap` px when the handles are closer. */
export function pillTops(yHi: number, yLo: number, gap: number): { hi: number; lo: number } {
  const short = gap - (yLo - yHi);
  return short > 0 ? { hi: yHi - short / 2, lo: yLo + short / 2 } : { hi: yHi, lo: yLo };
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
