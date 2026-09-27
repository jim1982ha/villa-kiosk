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

export const TREND_INTERVAL_MIN = 5;
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
  const B = TREND_INTERVAL_MS;
  const { from, to } = s.window;
  if (!(to > from)) return s;
  const first = Math.floor(from / B) * B;
  const pts = [...s.points].sort((a, b) => a.t - b.t);
  const gaps = [...s.gaps].sort((a, b) => a.from - b.from);
  // Where the signal is KNOWN: from each reading until the next reading, an
  // outage's start, or the window's end — whichever is first.
  const spans: { a: number; b: number; v: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = Math.max(pts[i].t, from);
    let b = i + 1 < pts.length ? pts[i + 1].t : to;
    for (const g of gaps) if (g.from >= pts[i].t && g.from < b) { b = g.from; break; }
    if (b > a) spans.push({ a, b: Math.min(b, to), v: pts[i].v });
  }
  const points: { t: number; v: number }[] = [];
  for (let t0 = first; t0 < to; t0 += B) {
    const t1 = t0 + B;
    let w = 0, sum = 0;
    for (const sp of spans) {
      const a = Math.max(sp.a, t0), b = Math.min(sp.b, t1);
      if (b > a) { w += b - a; sum += (b - a) * sp.v; }
    }
    if (w > 0) points.push({ t: Math.max(t0, from), v: sum / w });
  }
  return { points, gaps: widenGaps(gaps, from, to), window: s.window };
}

/** Outages widened to whole five-minute intervals (merged where they then
 *  meet), each with its real span in `actual`. */
export function widenGaps(gaps: readonly HistoryGap[], from: number, to: number): HistoryGap[] {
  const B = TREND_INTERVAL_MS;
  const out: HistoryGap[] = [];
  for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
    const w = {
      from: Math.max(from, Math.floor(g.from / B) * B),
      to: Math.min(to, Math.ceil(g.to / B) * B),
      actual: { from: g.actual?.from ?? g.from, to: g.actual?.to ?? g.to },
    };
    const last = out[out.length - 1];
    if (last && w.from <= last.to) {
      last.to = Math.max(last.to, w.to);
      last.actual = { from: last.actual!.from, to: Math.max(last.actual!.to, w.actual.to) };
    } else out.push(w);
  }
  return out;
}
