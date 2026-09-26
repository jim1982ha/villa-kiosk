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

import type { StatisticsPeriod } from "@/utils/statisticsSeries";
import type { EnergyPeriodKind } from "@/config/energyModel";
import { fmtChartTime } from "./chartUtils";

export type EnergyRangeKey = "day" | "week" | "month" | "year";

export interface EnergyRange {
  key: EnergyRangeKey;
  /** The picker's word. */
  label: string;
  /** The recorder's bucket. */
  period: StatisticsPeriod;
  /** Which buckets it shows (energyModel.periodStarts). */
  kind: EnergyPeriodKind;
  /** What one bucket is called ("Per hour", "Busiest day"). */
  unit: "hour" | "day" | "month";
  /** A bucket's label, on the axis and in the tooltip. */
  bucketLabel: (t: number) => string;
  /** The buckets that carry an x label, of `n`. */
  ticks: (n: number) => number[];
}

const every = (n: number) => Array.from({ length: n }, (_, i) => i);
const weekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric" });

export const ENERGY_RANGES: readonly EnergyRange[] = [
  { key: "day", label: "Day", period: "hour", kind: "hoursToday", unit: "hour", bucketLabel: fmtChartTime, ticks: () => [0, 6, 12, 18, 23] },
  { key: "week", label: "Week", period: "day", kind: "last7", unit: "day", bucketLabel: weekday, ticks: every },
  { key: "month", label: "Month", period: "day", kind: "last30", unit: "day", bucketLabel: weekday, ticks: () => [0, 7, 14, 21, 29] },
  { key: "year", label: "Year", period: "month", kind: "last12Months", unit: "month", bucketLabel: (t) => new Date(t).toLocaleDateString([], { month: "short" }), ticks: every },
];

export function energyRange(key: EnergyRangeKey): EnergyRange {
  return ENERGY_RANGES.find((r) => r.key === key)!;
}
