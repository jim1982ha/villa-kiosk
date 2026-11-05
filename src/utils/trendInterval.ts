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
 * all stays a break. "No longer kept" is left as it is. Pure.
 *
 * ⚠️ AT EVERY RANGE, FIVE MINUTES INCLUDED (owner, 2026-11-05: "Unavailable at 06:58, for 10s" and no value on the 24h
 * chart, "● 2.1 kW" and "at least once that hour" on the week's, of one drop): a five-minute step that has its mean is
 * marked the same way, its value said with its outage, and every band says its real drops (`drops`, dropsOf).
 *
 * ⚠️ EVERY OUTAGE THE 24H CHART SHOWS (owner, 2026-11-06: "It shall be visible by design"): architecture review 25
 * marked an hour, a day or a week only when the outage emptied a whole five-minute slot (as the figures then saw it),
 * so a drop of seconds striped the 24h chart and nothing on the week's. Every outage marks its step, as the figures'
 * steps now are from the same detail (historySource.outagesInside): one rule, at every range.
 */
export function stepsOfflineInside(s: HistorySeries, period: "5minute" | "hour" | "day" | "week", B: number,
  /** The outages as they were (the changes' gaps, before widening): widened to whole steps, two outages in steps side
   *  by side merge into one gap whose `actual` spans both, and a 50 ms drop the day before a long one read as that
   *  whole span. Absent: each gap's own drops. */
  outages?: readonly HistoryGap[]): HistorySeries {
  const { from, to } = s.window;
  if (!(to > from) || !s.gaps.some((g) => !g.notKept)) return s;
  const edges = cellEdges(from, to, B);
  const hasMean = new Set(s.points.map((p) => cellIndex(edges, p.t)));
  const gaps: HistoryGap[] = [];
  for (const g of s.gaps) {
    if (g.notKept) { gaps.push(g); continue; }
    const real = outages?.filter((o) => !o.notKept) ?? g.drops ?? [g.actual ?? { from: g.from, to: g.to }];
    let run: HistoryGap | null = null;
    for (let k = Math.max(0, cellIndex(edges, g.from)); k + 1 < edges.length && edges[k] < g.to; k++) {
      const a = Math.max(edges[k], g.from), b = Math.min(edges[k + 1], g.to);
      if (hasMean.has(k)) {
        run = null;
        gaps.push({ from: a, to: b, within: period, drops: dropsOf(real, a, b) });
        continue;
      }
      if (run) { run.to = b; run.drops = dropsOf(real, run.from, b); run.actual = spanOf(run.drops, run.from, b); continue; }
      const drops = dropsOf(real, a, b);
      run = { from: a, to: b, actual: spanOf(drops, a, b), drops };
      gaps.push(run);
    }
  }
  return { ...s, gaps };
}

/** The real outages of a band from `a` to `b`: those that touch it, whole (a drop over two steps is said whole in each,
 *  the same words wherever it is pointed at). HistoryGap.drops. */
export function dropsOf(outages: readonly { from: number; to: number }[], a: number, b: number): { from: number; to: number }[] {
  return outages.filter((o) => o.from < b && o.to > a).map((o) => ({ from: o.from, to: o.to }));
}

/** The span the drops cover (the first's start, the last's end), clipped to the band; the band with none. */
function spanOf(drops: readonly { from: number; to: number }[], a: number, b: number): { from: number; to: number } {
  return drops.length ? { from: Math.max(a, Math.min(...drops.map((d) => d.from))), to: Math.min(b, Math.max(...drops.map((d) => d.to))) }
    : { from: a, to: b };
}

/** Outages widened to whole five-minute intervals (merged where they then
 *  meet), each with its real span in `actual` and each real outage merged into it in `drops`. */
export function widenGaps(gaps: readonly HistoryGap[], from: number, to: number, B = TREND_INTERVAL_MS): HistoryGap[] {
  const out: HistoryGap[] = [];
  // on the chart's own step edges (timelineCells.cellEdges): a week's outage was widened on the 1970 Thursday
  const edges = to > from ? cellEdges(from, to, B) : [from, to];
  for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
    const k = cellIndex(edges, Math.max(from, g.from)), j = cellIndex(edges, Math.min(to, g.to) - 1);
    const actual = { from: g.actual?.from ?? g.from, to: g.actual?.to ?? g.to };
    const w: HistoryGap = {
      from: Math.max(from, edges[Math.max(0, k)]),
      to: Math.min(to, edges[Math.min(edges.length - 1, j + 1)]),
      actual,
      ...(g.notKept ? { notKept: true } : { drops: g.drops ? [...g.drops] : [actual] }),
    };
    const last = out[out.length - 1];
    // "no longer kept" and an outage stay two bands: different facts, different colours
    if (last && w.from <= last.to && !!last.notKept === !!w.notKept) {
      last.to = Math.max(last.to, w.to);
      last.actual = { from: last.actual!.from, to: Math.max(last.actual!.to, actual.to) };
      // each drop kept: "Unavailable 3 times, 10s in all" (chartUtils.fmtOutage)
      if (w.drops) last.drops = [...(last.drops ?? []), ...w.drops];
    } else out.push(w);
  }
  return out;
}
