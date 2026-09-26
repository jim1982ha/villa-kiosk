// src/utils/barChart.ts
// A bucketed bar chart — the Energy window's charts and the Weather window's
// rain — between its buckets and the pixels. components/panels/BarChart.tsx
// draws only what this says.
//
// ⚠️ IT WAS WRITTEN TWICE, AND THE COPIES DISAGREED (2.496.114). The Energy
// bars scaled to a round top; the rain bars used the LINE rule, so their top
// tick could sit below the tallest bar. The Energy tooltip wrote "kWh" after
// every value, so the cost chart's read "Cost 45,000 kWh". Hover ignored the
// gap between bars. One module now owns:
//   * the scale — 0 to a round top (chartGeometry.niceTicks), and the ticks;
//   * the slots — every bucket an equal slot, so the bucket under the pointer
//     and a bucket's centre are exact fractions, whatever the gap looks like;
//   * the three kinds of bucket — a reading (drawn), nothing yet (a stub),
//     and NO READING (an outage band — never a bar of 0);
//   * the tooltip's rows, each value written by the CHART's formatter (its unit).
// Pure; tests/oracles/bar_chart.mjs drives it.

import { niceTicks } from "./chartGeometry";
import { COMPILE_GRACE_MS } from "./statisticsSeries";

export interface BarSeg { key: string; label: string; v: number; cls: string }

/** One bucket. `segs`: its readings, stacked; `[]` nothing to draw yet (an
 *  hour still running); `null` NO READING — the recorder has nothing for it. */
export interface BarBucket { t: number; segs: BarSeg[] | null }

export interface BarLayout {
  /** The scale's round top, and the axis ticks: `y` down from the top of
   *  the plot, as a fraction of its height (ChartAxis' frame of 1). */
  top: number;
  ticks: { v: number; y: number }[];
  bars: { t: number; missing: boolean; segs: { key: string; cls: string; h: number }[] }[];
  /** Where the typical-value line sits (0–1), if one was given. */
  typicalAt?: number;
}

/** A bucket's stacked total (0 for no reading). */
export const bucketTotal = (b: BarBucket) => (b.segs ?? []).reduce((a, s) => a + s.v, 0);

export function barLayout(buckets: readonly BarBucket[], typical?: number): BarLayout {
  const peak = Math.max(1e-6, typical ?? 0, ...buckets.map(bucketTotal));
  const axis = niceTicks(0, peak);
  const top = axis.top;
  return {
    top,
    ticks: axis.ticks.map((v) => ({ v, y: 1 - v / top })),
    bars: buckets.map((b) => ({
      t: b.t,
      missing: b.segs === null,
      segs: (b.segs ?? []).map((s) => ({ key: s.key, cls: s.cls, h: Math.max(0, s.v) / top })),
    })),
    typicalAt: typical === undefined ? undefined : typical / top,
  };
}

/**
 * A second measure plotted OVER the bars on its own scale — the cost over
 * the energy it paid for (owner, 2026-09-26: one chart, "the IDR Y axis on
 * the right"). 0 to its own round top; a point per bucket at the bucket's
 * centre (`y` down from the top, 0–1); none where the value is missing, so
 * the line breaks there rather than dropping to 0.
 */
export interface LineLayout {
  top: number;
  ticks: { v: number; y: number }[];
  /** Runs of consecutive points: a missing value breaks the line. */
  runs: { i: number; y: number }[][];
}
export function lineLayout(values: readonly (number | undefined)[]): LineLayout {
  const peak = Math.max(1e-6, ...values.map((v) => v ?? 0));
  const axis = niceTicks(0, peak);
  const top = axis.top;
  const runs: { i: number; y: number }[][] = [];
  let run: { i: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === undefined) { if (run.length) runs.push(run); run = []; return; }
    run.push({ i, y: 1 - Math.max(0, v) / top });
  });
  if (run.length) runs.push(run);
  return { top, ticks: axis.ticks.map((v) => ({ v, y: 1 - v / top })), runs };
}

/** The bucket under a pointer `frac` of the way across the plot. */
export function barAt(frac: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
}

/** A bucket's centre, as a fraction of the plot's width. */
export const barCentre = (i: number, n: number) => (i + 0.5) / n;

/** Where an x-axis label sits: centred under its bucket, except at the ends,
 *  where it is flush with the plot's edge instead of hanging past it. */
export function barTick(i: number, n: number): { at: number; align: "start" | "middle" | "end" } {
  if (i <= 0) return { at: 0, align: "start" };
  if (i >= n - 1) return { at: 1, align: "end" };
  return { at: barCentre(i, n), align: "middle" };
}

export interface BarTipRow { key: string; cls?: string; text: string }

/**
 * What a bucket's tooltip says, every value in the chart's own unit (`fmt`):
 * the total first when there is more than one segment, then each segment
 * that is not zero (all of them zero: the first, so "0 mm" is still said).
 * No reading says so; nothing yet says nothing.
 */
export function barTipRows(
  b: BarBucket, fmt: (v: number) => string,
  /** The plotted line's value in this bucket, in ITS unit — one tooltip for both. */
  line?: { label: string; cls: string; v: number | undefined; fmt: (v: number) => string },
): BarTipRow[] {
  const lineRow = line && line.v !== undefined ? [{ key: "_line", cls: line.cls, text: `${line.label} ${line.fmt(line.v)}` }] : [];
  if (b.segs === null) return [{ key: "_none", text: "No reading" }, ...lineRow];
  if (b.segs.length === 0) return lineRow;
  const nonZero = b.segs.filter((s) => Math.abs(s.v) > 1e-9);
  const shown = nonZero.length ? nonZero : b.segs.slice(0, 1);
  return [
    ...(b.segs.length > 1 ? [{ key: "_total", text: `Total ${fmt(bucketTotal(b))}` }] : []),
    ...lineRow,
    ...shown.map((s) => ({ key: s.key, cls: s.cls, text: `${s.label} ${fmt(s.v)}` })),
  ];
}

/**
 * The sentence a chart with nothing to show says: no bucket with a reading —
 * `none` ("No rain readings…"); every reading zero — `zero` ("No rain…").
 * ⚠️ Zero is a reading and nothing is not: an empty record said "No rain in
 * the last 24 h" about a gauge the recorder had nothing for (2.496.88).
 */
export function barNote(buckets: readonly BarBucket[], none: string, zero: string): string | undefined {
  const read = buckets.filter((b) => b.segs && b.segs.length > 0);
  if (read.length === 0) return none;
  return read.every((b) => b.segs!.every((x) => x.v === 0)) ? zero : undefined;
}

/**
 * A totals series (rain) as buckets across its window: one a `slotMs`,
 * anchored on the recorder's own bucket starts (its readings), so a day
 * bucket stays on local midnight. A bucket with a reading is that reading
 * (0 included — the recorder writes a row for a dry hour); one it has not
 * compiled yet (still running, or just ended) has nothing yet; any other has
 * NO READING — never 0.
 */
export function seriesBuckets(
  s: { points: readonly { t: number; v: number }[]; window: { from: number; to: number } },
  slotMs: number, seg: { key: string; label: string; cls: string },
): BarBucket[] {
  const { from, to } = s.window;
  if (!(slotMs > 0) || !(to > from)) return [];
  const anchor = s.points[0]?.t ?? Math.floor(from / slotMs) * slotMs;
  const k0 = Math.floor((from - anchor) / slotMs);
  const starts: number[] = [];
  for (let t = anchor + k0 * slotMs; t < to; t += slotMs) if (t + slotMs > from) starts.push(t);
  // A reading goes to the nearest start: a 23- or 25-hour day (daylight
  // saving) still lands in its own day.
  const byIdx = new Map<number, number>();
  for (const p of s.points) {
    const i = starts.findIndex((t) => Math.abs(p.t - t) < slotMs / 2);
    if (i >= 0) byIdx.set(i, (byIdx.get(i) ?? 0) + p.v);
  }
  return starts.map((t, i): BarBucket => {
    const v = byIdx.get(i);
    if (v !== undefined) return { t, segs: [{ ...seg, v }] };
    return { t, segs: t + slotMs + COMPILE_GRACE_MS > to ? [] : null };
  });
}
