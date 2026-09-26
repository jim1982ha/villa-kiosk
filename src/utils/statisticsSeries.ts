// src/utils/statisticsSeries.ts
// The recorder's STATISTICS as a HistorySeries — the same value the states
// path (HAHistoryAPI.fetchHistory) returns, so a chart cannot tell which one
// fed it and neither can forget the gaps.
//
// ⚠️ THE GAPS WERE THE CALLER'S JOB ON THIS PATH, AND ONE CALLER FORGOT. The
// states path has always returned points AND gaps as one value ("there is no
// overload that hands back points alone"). Statistics came back as raw rows,
// so every renderer had to remember `bucketGaps` — the Weather lines did, the
// rain bars did not. And a request that failed, or a sensor the recorder had
// nothing for, arrived as `[]` — which the rain chart drew as "No rain in the
// last 24 h", 0.0 mm (2.496.88). Zero is a reading; nothing is not.
//
// Here the gaps are derived where the rows are read: a bucket the recorder did
// not write, or wrote without this field, is an outage (bucketGaps), and a
// statistic with NO rows in the window is an outage the width of the window.
//
// PURE — imports nothing that touches a browser, so tests/oracles runs it.

import { bucketGaps, type TimeWindow } from "./lineChart";
import type { HistorySeries, StatisticPeriod } from "@/types/ha.types";

/** A measurement's bucket (mean/min/max) or a total's (change). */
export type StatisticField = "mean" | "min" | "max" | "change";
export type StatisticsPeriod = "5minute" | "hour" | "day";

export const PERIOD_MS: Record<StatisticsPeriod, number> = {
  "5minute": 300_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** One statistic's rows, one field of them, over the window asked for. */
export function statisticsSeries(
  rows: readonly StatisticPeriod[] | undefined,
  field: StatisticField,
  period: StatisticsPeriod,
  window: TimeWindow,
): HistorySeries {
  const points = (rows ?? [])
    .map((r) => ({ t: r.start, v: r[field] }))
    .filter((p): p is { t: number; v: number } => typeof p.v === "number" && Number.isFinite(p.v));
  const gaps = points.length
    ? bucketGaps(points, PERIOD_MS[period], window)
    : [{ from: window.from, to: window.to }];
  return { points, gaps, window };
}

/** Where a history request stands. `failed` and an empty `ready` are
 *  different answers and a chart must say which ("couldn't load" vs "no
 *  readings") — collapsing both into `[]` is what drew the phantom 0 mm. */
export type HistoryStatus = "loading" | "ready" | "failed";

/** Sum of a totals series (rain, energy) — or undefined when there is
 *  nothing to sum, which is not the same as zero. */
export function seriesTotal(s: HistorySeries | undefined): number | undefined {
  if (!s || s.points.length === 0) return undefined;
  return s.points.reduce((a, p) => a + (p.v > 0 ? p.v : 0), 0);
}

/** The lowest and highest reading, or undefined with none. */
export function seriesExtent(s: HistorySeries | undefined): { min: number; max: number } | undefined {
  if (!s || s.points.length === 0) return undefined;
  let min = Infinity, max = -Infinity;
  for (const p of s.points) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
  return { min, max };
}
