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
import { historyStateColor } from "@/utils/stateColors";

export default function LastDayTimeline({
  entityId, colorFor,
}: {
  entityId: string;
  /** Optional — the entity's own domain rules are used by default, which is
   *  what every simple panel wants. Each of them used to pass a hand-picked
   *  per-domain helper instead, and passing the wrong one was both easy and
   *  silent (a lock coloured by cover rules paints "locked" in the green a
   *  cover uses for OPEN). Only override for a genuinely non-standard read —
   *  binary_sensor's configurable alert state is the one real case. */
  colorFor?: (state: string) => string;
}) {
  const { range, picker } = useHistoryRange();
  const paint = colorFor ?? historyStateColor(entityId);
  const { data, loading, lastSeen } = useStateHistory(entityId, range.hours);
  return (
    <div className="field">
      {/* When the window had to be moved to find data, say so — an unlabelled
          chart of a different period is worse than no chart. */}
      <HistoryHeader
        title={lastSeen
          ? `${range.title} before ${new Date(lastSeen).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : range.title}
        picker={picker}
      />
      <StateTimeline
        data={data}
        colorFor={paint}
        loading={loading}
        bucketMinutes={range.bucketMinutes}
      />
    </div>
  );
}
