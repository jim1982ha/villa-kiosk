// src/components/panels/historyRange.tsx
// The shared "how far back" control for every history view in a device panel —
// the state timeline, the numeric sparkline, and the multi-series group chart.
//
// One definition, because the three used to disagree by construction: each
// fetched a hardcoded 24 hours, so a panel showing both a timeline and a
// sparkline could not offer a range on one without the other silently staying
// on a different window. The hook hands back the chosen range AND the rendered
// picker, so a caller adds both with one line and cannot wire up half of it.

import { useState, type ReactNode } from "react";

export interface HistoryRange {
  hours: number;
  /** Heading for the section ("Last 12 hours"). */
  title: string;
  /** Timeline bucket width. A 7-day window at the 24-hour window's resolution
   *  would be thousands of segments wide, so each range carries its own. */
  bucketMinutes: number;
}

const RANGES: (HistoryRange & { key: string; label: string })[] = [
  { key: "1h", label: "1h", hours: 1, title: "Last hour", bucketMinutes: 1 },
  { key: "12h", label: "12h", hours: 12, title: "Last 12 hours", bucketMinutes: 5 },
  { key: "24h", label: "24h", hours: 24, title: "Last 24 hours", bucketMinutes: 10 },
  { key: "7d", label: "7d", hours: 168, title: "Last 7 days", bucketMinutes: 60 },
];

const DEFAULT_KEY = "24h";

/** Returns the active range plus a ready-rendered picker for it. */
export function useHistoryRange(): { range: HistoryRange; picker: ReactNode } {
  const [key, setKey] = useState(DEFAULT_KEY);
  const range = RANGES.find((r) => r.key === key) ?? RANGES[2];
  const picker = (
    <div className="segmented timeline-ranges" role="group" aria-label="History range">
      {RANGES.map((r) => (
        <button
          key={r.key}
          className={r.key === key ? "active" : ""}
          onClick={() => setKey(r.key)}
          aria-pressed={r.key === key}
          title={r.title}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
  return { range, picker };
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
