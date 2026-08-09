// src/components/panels/LastDayTimeline.tsx
// The state-history field every simple device panel ends with: the shared
// range header plus a StateTimeline. Panels with extra needs (a legend, two
// timelines) compose StateTimeline directly and use useHistoryRange themselves.
//
// It owns the fetch rather than receiving `data`, which is what lets the range
// live here instead of being duplicated as state in every panel.

import StateTimeline from "./StateTimeline";
import { useStateHistory } from "@/hooks/useStateHistory";
import { useHistoryRange, HistoryHeader } from "./historyRange";

export default function LastDayTimeline({
  entityId, colorFor,
}: {
  entityId: string;
  colorFor: (state: string) => string;
}) {
  const { range, picker } = useHistoryRange();
  const { data, loading } = useStateHistory(entityId, range.hours);
  return (
    <div className="field">
      <HistoryHeader title={range.title} picker={picker} />
      <StateTimeline
        data={data}
        colorFor={colorFor}
        loading={loading}
        bucketMinutes={range.bucketMinutes}
      />
    </div>
  );
}
