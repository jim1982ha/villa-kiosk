// src/utils/statisticsSeries.ts
// The recorder's STATISTICS as a HistorySeries — the same value the states
// path (historySource `readings`) returns, so a chart cannot tell which one
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
import type { HistoryGap, HistorySeries, StatisticPeriod } from "@/types/ha.types";
import { DAY_MS, HOUR_MS } from "./localDay";

/** A measurement's bucket (mean/min/max) or a total's (change). */
export type StatisticField = "mean" | "min" | "max" | "change";
export type StatisticsPeriod = "5minute" | "hour" | "day" | "week" | "month";

export const PERIOD_MS: Record<StatisticsPeriod, number> = {
  "5minute": 300_000,
  hour: HOUR_MS,
  day: DAY_MS,
  // a year's history, one figure a week (owner, 2026-10-20: historyRange "1y")
  week: 7 * DAY_MS,
  // A calendar month is 28–31 days; the gap rule allows 1.5 buckets, so a
  // nominal 31 keeps every real month-to-month step inside it.
  month: 31 * DAY_MS,
};

/** How long after a bucket ends HA's recorder may take to compile it: until
 *  then, "no row" means "not yet", not "no reading". */
export const COMPILE_GRACE_MS = 15 * 60_000;

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

/** A coarse figure's step whose finer figures say when it was offline (rangeFilter FINER: an hour's five-minute ones, a
 *  day's hourly ones, a week's daily ones). */
export type MarkedPeriod = "hour" | "day" | "week";

/**
 * ⚠️ AN OUTAGE INSIDE ONE STEP OF THE FIGURES (owner, 2026-11-05: a power meter offline 22 minutes showed nothing on its
 * 1w chart, and an hourly mean hides it): each step of `coarse` that HAS its mean, inside which the recorder wrote no
 * finer figure for a slot (`finer`, one figure per `finerMs`: the device said nothing all that slot), marked the
 * step's whole width with `within`: drawn as a band, the line still drawn through it, its tooltip "Unavailable during
 * this hour". Only BETWEEN the finer figures (none before the first: older than the recorder keeps them, `keptFrom`
 * for the five-minute ones, or before the device existed) and after the last only once its slot is compiled
 * (COMPILE_GRACE_MS: a slot not written yet is no outage). Pure.
 */
export function finerOutages(coarse: HistorySeries, finer: HistorySeries, period: MarkedPeriod, finerMs: number,
  now: number, kept?: number): HistoryGap[] {
  if (coarse.points.length === 0) return [];
  const real = missingSlots(finer, finerMs, now, kept);
  const P = PERIOD_MS[period];
  return coarse.points.filter((p) => real.some((m) => m.from < p.t + P && m.to > p.t))
    .map((p) => ({ from: p.t, to: Math.min(p.t + P, coarse.window.to), within: period }));
}

/** The slots of `finer` (one figure per `finerMs`) the recorder wrote no figure for, BETWEEN its figures and after the
 *  last once compiled (finerOutages), from `kept` on: where a step's outage is (historySource reads the detail there). */
export function missingSlots(finer: HistorySeries, finerMs: number, now: number, kept?: number): { from: number; to: number }[] {
  const pts = finer.points;
  if (pts.length === 0) return [];
  const missing: { from: number; to: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > finerMs * 1.5) missing.push({ from: pts[i - 1].t + finerMs, to: pts[i].t });
  }
  const lastEnd = pts[pts.length - 1].t + finerMs;
  const compiled = Math.floor((Math.min(now, finer.window.to) - COMPILE_GRACE_MS - lastEnd) / finerMs);
  if (compiled >= 1) missing.push({ from: lastEnd, to: lastEnd + compiled * finerMs });
  return missing.filter((m) => kept === undefined || m.from >= kept);
}

/** Where a history request stands. `failed` and an empty `ready` are
 *  different answers and a chart must say which ("couldn't load" vs "no
 *  readings") — collapsing both into `[]` is what drew the phantom 0 mm. */
export type HistoryStatus = "loading" | "ready" | "failed";

/** What EVERY chart says when it has nothing to draw: null while loading (the
 *  caller draws its skeleton), else one of two different facts. The line
 *  charts said "Couldn't load" and the state timelines could not — they took
 *  a `loading` flag, so a failed request read "Not enough history yet", and a
 *  device group said it while still loading (2.496.188). */
export function emptyHistoryText(status: HistoryStatus): string | null {
  if (status === "loading") return null;
  return status === "failed" ? "Couldn't load this history." : "Not enough history yet.";
}

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

/** The highest reading and when, or null with none — today's UV peak. The
 *  first of equal maxima: the moment it was first reached. */
export function peakOf(s: HistorySeries | undefined): { v: number; t: number } | null {
  if (!s || s.points.length === 0) return null;
  let best = s.points[0];
  for (const p of s.points) if (p.v > best.v) best = p;
  return { v: best.v, t: best.t };
}
