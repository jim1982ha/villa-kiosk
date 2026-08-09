// src/components/panels/LastDayTimeline.tsx
// The state-history field every simple device panel ends with: a range picker
// plus a StateTimeline. Panels with extra needs (a legend, two timelines)
// still compose StateTimeline directly.
//
// It owns the fetch rather than receiving `data`, which is what lets the range
// live here instead of being duplicated as state in every panel that shows a
// timeline. Callers pass the entity and how to colour a state, nothing else.

import { useState } from "react";
import StateTimeline from "./StateTimeline";
import { useStateHistory } from "@/hooks/useStateHistory";

/** Presets, shortest first. `hours` feeds both the fetch and the bucket size —
 *  a 7-day window bucketed at a 24-hour window's resolution would be thousands
 *  of segments wide, so each range carries its own. */
const RANGES = [
  { key: "1h", label: "1h", hours: 1, title: "Last hour", bucketMinutes: 1 },
  { key: "12h", label: "12h", hours: 12, title: "Last 12 hours", bucketMinutes: 5 },
  { key: "24h", label: "24h", hours: 24, title: "Last 24 hours", bucketMinutes: 10 },
  { key: "7d", label: "7d", hours: 168, title: "Last 7 days", bucketMinutes: 60 },
] as const;

const DEFAULT_RANGE = "24h";

export default function LastDayTimeline({
  entityId, colorFor,
}: {
  entityId: string;
  colorFor: (state: string) => string;
}) {
  const [rangeKey, setRangeKey] = useState<string>(DEFAULT_RANGE);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  const { data, loading } = useStateHistory(entityId, range.hours);

  return (
    <div className="field">
      {/* Label and picker share one row: the label already says which window
          is shown, so a separate caption under the buttons would repeat it. */}
      <div className="timeline-head">
        <label className="entity-label">{range.title}</label>
        <div className="segmented timeline-ranges" role="group" aria-label="History range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={r.key === rangeKey ? "active" : ""}
              onClick={() => setRangeKey(r.key)}
              aria-pressed={r.key === rangeKey}
              title={r.title}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <StateTimeline
        data={data}
        colorFor={colorFor}
        loading={loading}
        bucketMinutes={range.bucketMinutes}
      />
    </div>
  );
}
