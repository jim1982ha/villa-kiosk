// src/components/panels/energyRanges.ts
// The Energy window's periods — Day, Week, Month, Year — one row each: the
// recorder's bucket, which buckets it shows, what a bucket is called, how
// one is labelled and which ones carry an x label. Today's hour-by-hour chart
// on the first screen is the Day row too.
//
// ⚠️ FIVE PARALLEL MAPS BEFORE THIS (round 7, 2.496.124): range → period,
// → buckets, → "hour/day/month", → label format, → tick positions, each
// keyed on the same four strings and agreeing only because they were edited
// together. Pure; tests/oracles/energy_ranges.mjs.

import { inVillaZone } from "@/utils/villaClock";
import type { StatisticsPeriod } from "@/utils/statisticsSeries";
import type { EnergyPeriodKind } from "@/config/energyModel";
import { fmtChartTime } from "./chartUtils";
import { dayShort, docDate } from "@/utils/dateText";
import type { RangeKey } from "@/utils/historyRanges";

// ⚠️ THE APP'S FIVE PERIODS (owner, 2026-10-20: every toggle the same — historyRange RANGE_KEYS). The Energy window
// shows four of them; "1h" stays in its toggle, greyed: the recorder's energy figures are hourly, so an hour is one
// bar. A year stays a bar a MONTH (12 bars, as the villa's own Energy dashboard and its bills), not 52 weekly ones.
export type EnergyRangeKey = Exclude<RangeKey, "1h">;

interface EnergyRange {
  key: EnergyRangeKey;
  /** The picker's word. */
  label: string;
  /** The recorder's bucket. */
  period: StatisticsPeriod;
  /** Which buckets it shows (energyModel.periodStarts). */
  kind: EnergyPeriodKind;
  /** What one bucket is called ("Per hour", "Busiest day"). */
  unit: "hour" | "day" | "month";
  /** A bucket's label on the axis ("04/11", where three to seven must fit). */
  bucketLabel: (t: number) => string;
  /** A bucket named whole, where it stands alone ("Busiest day 04/11/2026 · 12 kWh"). */
  bucketName: (t: number) => string;
  /** The buckets that carry an x label, of `n`. */
  ticks: (n: number) => number[];
}

const every = (n: number) => Array.from({ length: n }, (_, i) => i);
/** A day's short name alone ("Mon") — the last-seven-days chart's axis. */
export const weekdayShort = (t: number) => new Date(t).toLocaleDateString([], inVillaZone({ weekday: "short" }));

// ⚠️ ONE DAY FORMAT (architecture review 28): a week's and a month's bars said "Wed 4" (a month of them named no
// month) where every other chart's axis says "04/11" and its figures "04/11/2026" (dateText)
const month = (t: number) => new Date(t).toLocaleDateString([], inVillaZone({ month: "short" }));
export const ENERGY_RANGES: readonly EnergyRange[] = [
  { key: "24h", label: "24h", period: "hour", kind: "last24Hours", unit: "hour", bucketLabel: fmtChartTime, bucketName: fmtChartTime, ticks: () => [0, 6, 12, 18, 23] },
  { key: "1w", label: "1w", period: "day", kind: "last7", unit: "day", bucketLabel: dayShort, bucketName: docDate, ticks: every },
  { key: "1m", label: "1m", period: "day", kind: "last30", unit: "day", bucketLabel: dayShort, bucketName: docDate, ticks: () => [0, 7, 14, 21, 29] },
  { key: "1y", label: "1y", period: "month", kind: "last12Months", unit: "month", bucketLabel: month, bucketName: month, ticks: every },
];

export function energyRange(key: EnergyRangeKey): EnergyRange {
  return ENERGY_RANGES.find((r) => r.key === key)!;
}
