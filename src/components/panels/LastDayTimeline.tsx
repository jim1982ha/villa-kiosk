// src/components/panels/LastDayTimeline.tsx
// THE state-history section of a device panel: the shared range header, the
// fetch with its last-sighting look-back, where that fetch stands, and the
// StateTimeline. Every panel that charts STATES uses it — Generic and the
// binary/text Sensor panels had their own copies, and each had lost a piece:
// Generic drew an offline device's look-back window against "now" (its data
// fell off the chart), and Sensor had no look-back at all (2.496.188).
// Panels with two timelines (the camera's rail) compose StateTimeline
// directly.
//
// It owns the fetch rather than receiving `data`, which is what lets the range
// live here instead of being duplicated as state in every panel.

import { useHA } from "@/ha/HAStateStore";
import { stateLabelFor } from "@/config/BinarySensorClasses";
import StateTimeline from "./StateTimeline";
import { useStateHistory, historyTitle } from "@/hooks/useStateHistory";
import { useHistoryRange, HistoryHeader } from "./historyRange";
import { historyStateColor, paletteColorFor } from "@/utils/stateColors";

export default function LastDayTimeline({
  entityId, colorFor, legend = false,
}: {
  entityId: string;
  /** Optional — the entity's own domain rules are used by default, which is
   *  what every simple panel wants. Each of them used to pass a hand-picked
   *  per-domain helper instead, and passing the wrong one was both easy and
   *  silent (a lock coloured by cover rules paints "locked" in the green a
   *  cover uses for OPEN). Only override for a genuinely non-standard read —
   *  binary_sensor's configurable alert state is the one real case. */
  colorFor?: (state: string) => string;
  /** States with no colour rule of their own (a text sensor, an unknown
   *  domain): a palette over the states the window actually holds, with a
   *  legend saying which is which. Ignored when `colorFor` is given. */
  legend?: boolean;
}) {
  const { range, picker } = useHistoryRange();
  const { data, status, lastSeen } = useStateHistory(entityId, range.hours);
  const { entities } = useHA();
  const palette = !colorFor && legend ? paletteColorFor(data.map((p) => p.state)) : undefined;
  const paint = colorFor ?? palette ?? historyStateColor(entityId);
  return (
    <div className="field">
      <HistoryHeader title={historyTitle(range.title, lastSeen)} picker={picker} />
      <StateTimeline
        data={data}
        colorFor={paint}
        status={status}
        hours={range.hours}
        end={lastSeen}
        labelFor={stateLabelFor(entityId, entities[entityId]?.attributes.device_class as string | undefined)}
        legend={palette && [...new Set(data.map((p) => p.state))].map((s) => ({ state: s, color: palette(s) }))}
      />
    </div>
  );
}
