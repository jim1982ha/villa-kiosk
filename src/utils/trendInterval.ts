// src/utils/trendInterval.ts
// THE interval every device trend is reported in: five minutes (owner,
// 2026-09-27: "the values shall be consistently reported as 5 min time
// intervals everywhere … the chart background coloured as per device state,
// when unavailable, on each 5 min interval").
//
// ⚠️ THREE RESOLUTIONS BEFORE (2.496.179). State bars used 1, 5, 10 or 60
// minutes depending on the range picked; binary sensors drew every raw change;
// numeric sensors — the pumps' power among them, reported every minute —
// plotted every raw point, even over seven days. The chart type differs by
// device; the time grain does not, and it is this.
//
// Pure: tests/oracles/trend_interval.mjs.

import type { HistoryGap, HistorySeries } from "@/types/ha.types";
import { cellEdges, cellIndex } from "@/utils/timelineCells";

const TREND_INTERVAL_MIN = 5;
export const TREND_INTERVAL_MS = TREND_INTERVAL_MIN * 60_000;

/**
 * A numeric history as five-minute values: each interval's TIME-WEIGHTED mean
 * of what the sensor reported during the part of it that was not an outage
 * (a reading holds until the next one — the chart's own step rule), stamped
 * at the interval's start. An interval with no available time has no value.
 *
 * Outages are widened to the whole intervals they touched, so the shaded
 * background covers every five minutes in which the device was unavailable;
 * each keeps its real start and end in `actual`, for the tooltip's
 * "Unavailable · 14:22–14:31 (9 min)". Intervals are anchored to the clock
 * (:00, :05, …), the same edges on every chart and for everyone.
 */
export function fiveMinuteSeries(s: HistorySeries): HistorySeries {
  return intervalSeries(s, TREND_INTERVAL_MS);
}

/**
 * The same, in intervals of `B` ms: the step a range is drawn in (historyRange `grainMs` — five minutes up to a
 * week, a day for a month, a week for a year: owner, 2026-10-20). A numeric device the recorder keeps no long-term
 * figures of is drawn this way from what the villa's system still keeps (historySource).
 */
export function intervalSeries(s: HistorySeries, B: number): HistorySeries {
  const { from, to } = s.window;
  if (!(to > from)) return s;
  // ⚠️ THE BAND'S OWN EDGES (architecture review, 2026-10-20): a day or a week begins at the villa's midnight (a week
  // on a Monday), as the recorder's figures and the state band do (timelineCells.firstCellStart) — this line cut its
  // weeks on the 1970 Thursday and its days on UTC's midnight, so two charts of one panel showed different weeks
  const edges = cellEdges(from, to, B);
  const gaps = [...s.gaps].sort((a, b) => a.from - b.from);
  const spans = knownSpans(s);
  const points: { t: number; v: number }[] = [];
  for (let k = 0; k + 1 < edges.length && edges[k] < to; k++) {
    const t0 = edges[k], t1 = edges[k + 1];
    let w = 0, sum = 0;
    for (const sp of spans) {
      const a = Math.max(sp.a, t0), b = Math.min(sp.b, t1);
      if (b > a) { w += b - a; sum += (b - a) * sp.v; }
    }
    if (w > 0) points.push({ t: Math.max(t0, from), v: sum / w });
  }
  return { points, gaps: widenGaps(gaps, from, to, B), window: s.window };
}

/**
 * Where a numeric history's signal is KNOWN, each reading held: from the reading until the next reading, an outage's
 * start, or the window's end, whichever is first (clipped to the window). The time weights of `intervalSeries`, and of
 * a chart's range filter (rangeFilter: only the spans whose value is inside the range count), one rule for both.
 */
export function knownSpans(s: HistorySeries): { a: number; b: number; v: number }[] {
  const { from, to } = s.window;
  const pts = [...s.points].sort((a, b) => a.t - b.t);
  const gaps = [...s.gaps].sort((a, b) => a.from - b.from);
  const spans: { a: number; b: number; v: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = Math.max(pts[i].t, from);
    let b = i + 1 < pts.length ? pts[i + 1].t : to;
    for (const g of gaps) if (g.from >= pts[i].t && g.from < b) { b = g.from; break; }
    if (b > a) spans.push({ a, b: Math.min(b, to), v: pts[i].v });
  }
  return spans;
}

/**
 * ⚠️ ONE LOOK FOR AN OUTAGE INSIDE A STEP, WHEREVER THE STEP CAME FROM (architecture review 24): a device the recorder
 * keeps figures of had its week's hour striped "Unavailable during this hour", its line drawn through (historySource
 * outagesInside), while one drawn from its changes (no figures: intervalSeries) had the same hour a plain grey band,
 * its line broken, and its tooltip a span of times. Of `s` drawn in `period` steps, each widened outage's step that
 * still has its mean is marked offline inside it (`within`, the same as the figures'); a run of steps with no mean at
 * all stays a break with its real span (`actual`), as a missing figure is. "No longer kept" is left as it is. Pure.
 *
 * ⚠️ AN OUTAGE THE FIGURES WOULD SEE, NO SHORTER (architecture review 25): a 50 ms drop — the villa's system reloading
 * its virtual devices, several times a day — striped a template sensor's whole hour on its week and its whole day on
 * its month, while a sensor kept in figures showed nothing for the same drop (a five-minute figure is written unless
 * the device said nothing all of it: statisticsSeries.finerOutages). A step is marked only when the outage emptied a
 * whole five-minute slot of it (emptiesSlot), the one rule of both; the 1h and 24h charts still draw every outage.
 */
export function stepsOfflineInside(s: HistorySeries, period: "hour" | "day" | "week", B: number): HistorySeries {
  const { from, to } = s.window;
  if (!(to > from) || !s.gaps.some((g) => !g.notKept)) return s;
  const edges = cellEdges(from, to, B);
  const hasMean = new Set(s.points.map((p) => cellIndex(edges, p.t)));
  const gaps: HistoryGap[] = [];
  for (const g of s.gaps) {
    if (g.notKept) { gaps.push(g); continue; }
    const real = g.actual ?? { from: g.from, to: g.to };
    let run: HistoryGap | null = null;
    for (let k = Math.max(0, cellIndex(edges, g.from)); k + 1 < edges.length && edges[k] < g.to; k++) {
      const a = Math.max(edges[k], g.from), b = Math.min(edges[k + 1], g.to);
      if (hasMean.has(k)) {
        run = null;
        if (emptiesSlot(Math.max(real.from, edges[k]), Math.min(real.to, edges[k + 1]))) gaps.push({ from: a, to: b, within: period });
        continue;
      }
      if (run) { run.to = b; run.actual = { from: run.actual!.from, to: Math.min(real.to, b) }; continue; }
      run = { from: a, to: b, actual: { from: Math.max(real.from, a), to: Math.min(real.to, b) } };
      gaps.push(run);
    }
  }
  return { ...s, gaps };
}

/** Did an outage from `from` to `to` cover one whole five-minute slot of the clock — the slot a figure is written for
 *  (statisticsSeries PERIOD_MS["5minute"], the same five minutes as TREND_INTERVAL_MS)? */
export function emptiesSlot(from: number, to: number): boolean {
  return Math.ceil(from / TREND_INTERVAL_MS) * TREND_INTERVAL_MS + TREND_INTERVAL_MS <= to;
}

/** Outages widened to whole five-minute intervals (merged where they then
 *  meet), each with its real span in `actual`. */
export function widenGaps(gaps: readonly HistoryGap[], from: number, to: number, B = TREND_INTERVAL_MS): HistoryGap[] {
  const out: HistoryGap[] = [];
  // on the chart's own step edges (timelineCells.cellEdges): a week's outage was widened on the 1970 Thursday
  const edges = to > from ? cellEdges(from, to, B) : [from, to];
  for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
    const k = cellIndex(edges, Math.max(from, g.from)), j = cellIndex(edges, Math.min(to, g.to) - 1);
    const w = {
      from: Math.max(from, edges[Math.max(0, k)]),
      to: Math.min(to, edges[Math.min(edges.length - 1, j + 1)]),
      actual: { from: g.actual?.from ?? g.from, to: g.actual?.to ?? g.to },
      ...(g.notKept ? { notKept: true } : {}),
    };
    const last = out[out.length - 1];
    // "no longer kept" and an outage stay two bands: different facts, different colours
    if (last && w.from <= last.to && !!last.notKept === !!w.notKept) {
      last.to = Math.max(last.to, w.to);
      last.actual = { from: last.actual!.from, to: Math.max(last.actual!.to, w.actual.to) };
    } else out.push(w);
  }
  return out;
}
