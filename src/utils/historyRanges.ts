// src/utils/historyRanges.ts
// THE periods every history toggle offers, each with its time step and its recorder bucket — the table alone, pure,
// so an oracle drives it by value (tests/oracles/history_ranges.mjs). The toggle and its hook are
// components/panels/historyRange.tsx; the shared reader (ha/historySource) reads by `period`.

import { PERIOD_MS, type StatisticsPeriod } from "@/utils/statisticsSeries";

export interface HistoryRange {
  key: RangeKey;
  /** The toggle's word ("1w"). */
  label: string;
  hours: number;
  /** Heading for the section ("Last 7 days"). */
  title: string;
  /** THE time step its charts are drawn in (owner, 2026-10-20): five minutes up to a day, an hour for a week, a day for a month, a
   *  week for a year — a state band's slices and a numeric line's values alike (historySource reads by it). */
  grainMs: number;
  /** The recorder-statistics bucket for a MEASUREMENT over this range — its grain, as the recorder names it — and
   *  for a TOTAL (rain: an hour, a day or a week a bar). */
  period: StatisticsPeriod;
  totalPeriod: StatisticsPeriod;
}

// ⚠️ FIVE PERIODS, EACH WITH ITS TIME STEP, FOR EVERY HISTORY TOGGLE (owner, 2026-10-20: "1h, 24h, 1w at 5 min;
// 1m daily; 1y weekly" — "I expect you only have to implement these changes at a unique place"). It was 1h / 12h
// / 24h / 7d for a device and 12h / 24h / 7d / 30d for the Weather window, all in one five-minute step
// (utils/trendInterval, 2.496.179): a year of five-minute slices is 105,000 of them, and the villa's system keeps
// every change only for its recorder's days (10 by default) — a month or a year reads its long-term figures
// (historySource, by `period`), and a state band greys what is no longer kept.
export type RangeKey = "1h" | "24h" | "1w" | "1m" | "1y";

// ⚠️ THE STEP IS SAID ONCE (architecture review, 2026-10-20): `grainMs` is its `period`'s length (PERIOD_MS), never a
// second number that could say otherwise
const range = (r: Omit<HistoryRange, "grainMs">): HistoryRange => ({ ...r, grainMs: PERIOD_MS[r.period] });
export const RANGES: readonly HistoryRange[] = [
  // the title says the period the toggle names (owner, 2026-10-20: "1w" read "Last 7 days"); 1w is hourly (owner,
  // 2026-10-20: five-minute values over a week were 2,016 points a line)
  range({ key: "1h", label: "1h", hours: 1, title: "Last hour", period: "5minute", totalPeriod: "hour" }),
  range({ key: "24h", label: "24h", hours: 24, title: "Last 24 hours", period: "5minute", totalPeriod: "hour" }),
  range({ key: "1w", label: "1w", hours: 168, title: "Last week", period: "hour", totalPeriod: "day" }),
  range({ key: "1m", label: "1m", hours: 720, title: "Last month", period: "day", totalPeriod: "day" }),
  range({ key: "1y", label: "1y", hours: 8760, title: "Last year", period: "week", totalPeriod: "week" }),
];

/** Every key, in the toggle's order — the one list every history toggle shows. */
export const RANGE_KEYS: readonly RangeKey[] = RANGES.map((r) => r.key);

/** The period a toggle opens on. */
export const DEFAULT_KEY: RangeKey = "24h";

/** The range behind a key. */
export function historyRange(key: RangeKey): HistoryRange {
  return RANGES.find((r) => r.key === key)!;
}

