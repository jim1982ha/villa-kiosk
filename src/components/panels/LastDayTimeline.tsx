// src/components/panels/LastDayTimeline.tsx
// The "Last 24 hours" field every simple device panel ends with (a label
// plus a StateTimeline) — extracted since most panels repeated this exact
// block verbatim. Panels with extra needs (a legend, two timelines) still
// compose StateTimeline directly instead of using this.

import StateTimeline from "./StateTimeline";
import type { StateHistoryPoint } from "@/types/ha.types";

export default function LastDayTimeline({
  data, colorFor, loading,
}: {
  data: StateHistoryPoint[];
  colorFor: (state: string) => string;
  loading?: boolean;
}) {
  return (
    <div className="field">
      <label className="entity-label">Last 24 hours</label>
      <StateTimeline data={data} colorFor={colorFor} loading={loading} />
    </div>
  );
}
