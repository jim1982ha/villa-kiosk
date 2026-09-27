// src/components/panels/historyRange.tsx
// The shared "how far back" control for every history view in a device panel —
// the state timeline, the numeric line chart, and the multi-series group chart.
//
// One definition, because the three used to disagree by construction: each
// fetched a hardcoded 24 hours, so a panel showing both a timeline and a
// sparkline could not offer a range on one without the other silently staying
// on a different window. The hook hands back the chosen range AND the rendered
// picker, so a caller adds both with one line and cannot wire up half of it.
//
// ⚠️ ONE TABLE FOR EVERY HISTORY VIEW, THE WEATHER WINDOW INCLUDED. It kept a
// second one (12 h – 30 days, with the recorder's statistics period) and its
// own picker; a range is a range whichever recorder path reads it, so each
// entry here carries both resolutions and a view picks which ranges it offers.

import { useState, type ReactNode } from "react";
import type { StatisticsPeriod } from "@/utils/statisticsSeries";

export interface HistoryRange {
  hours: number;
  /** Heading for the section ("Last 12 hours"). */
  title: string;
  /* No timeline bucket width per range any more: every device trend is drawn
     in the ONE five-minute interval (utils/trendInterval, 2.496.179). */
  /** The recorder-statistics bucket for a MEASUREMENT over this range (at most
   *  ~720 points a line), and for a TOTAL (rain: per hour, or per day). */
  period: StatisticsPeriod;
  totalPeriod: StatisticsPeriod;
}

export type RangeKey = "1h" | "12h" | "24h" | "7d" | "30d";

const RANGES: (HistoryRange & { key: RangeKey; label: string })[] = [
  { key: "1h", label: "1h", hours: 1, title: "Last hour", period: "5minute", totalPeriod: "hour" },
  { key: "12h", label: "12h", hours: 12, title: "Last 12 hours", period: "5minute", totalPeriod: "hour" },
  { key: "24h", label: "24h", hours: 24, title: "Last 24 hours", period: "5minute", totalPeriod: "hour" },
  { key: "7d", label: "7d", hours: 168, title: "Last 7 days", period: "hour", totalPeriod: "day" },
  { key: "30d", label: "30d", hours: 720, title: "Last 30 days", period: "hour", totalPeriod: "day" },
];

/** What a device panel offers — raw state history, so no 30 days of it. */
export const DEVICE_RANGES: readonly RangeKey[] = ["1h", "12h", "24h", "7d"];
/** What the Weather window offers — statistics, so a month is cheap. */
export const WEATHER_RANGES: readonly RangeKey[] = ["12h", "24h", "7d", "30d"];

const DEFAULT_KEY: RangeKey = "24h";

/** The range behind a key. */
export function historyRange(key: RangeKey): HistoryRange {
  return RANGES.find((r) => r.key === key)!;
}

/**
 * A segmented choice — the pill row of the history pickers — and the choice
 * it holds. ONE control for every "which period" in the app: the device
 * panels' and the Weather window's rolling ranges (useHistoryRange) and the
 * Energy window's calendar ones; both windows put it in their header.
 */
export function useSegmentedChoice<K extends string>(
  options: readonly { key: K; label: ReactNode; title?: string }[], initial: K, ariaLabel: string, className: string,
): { key: K; picker: ReactNode } {
  const [picked, setPicked] = useState<K>(initial);
  const key = options.some((o) => o.key === picked) ? picked : initial;
  const picker = (
    <div className={`segmented ${className}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.key} type="button" className={o.key === key ? "active" : ""}
          onClick={() => setPicked(o.key)} aria-pressed={o.key === key} title={o.title} aria-label={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
  return { key, picker };
}

/** Returns the active range plus a ready-rendered picker for it. */
export function useHistoryRange(
  offered: readonly RangeKey[] = DEVICE_RANGES, className = "timeline-ranges",
): { range: HistoryRange; picker: ReactNode } {
  const { key, picker } = useSegmentedChoice(RANGES.filter((r) => offered.includes(r.key)), DEFAULT_KEY, "History range", className);
  return { range: historyRange(key), picker };
}

/** The heading row every history section uses: its title on the left, the
 *  range picker on the right. Keeps the three views visually identical. */
export function HistoryHeader({ title, picker }: { title: string; picker: ReactNode }) {
  return (
    <div className="timeline-head">
      <label className="entity-label">{title}</label>
      {picker}
    </div>
  );
}
