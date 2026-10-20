// src/components/panels/ReadingHistory.tsx
// A sensor's history as its own window draws it: an on/off sensor's states, a sensor in words with a legend, a
// measurement as a chart — by config/reading's historyOf. ONE drawing for the sensor's window and for every other
// window that shows the same sensor's history (the villa's presence window, owner 2026-10-19: "show the mini-trend
// chart directly in this modal"), so the two never draw it differently.

import LastDayTimeline from "./LastDayTimeline";
import NumericHistory from "./NumericHistory";
import { useHA } from "@/ha/HAStateStore";
import { historyOf, readingOf } from "@/config/reading";
import { domainOf } from "@/utils/entityDomain";

export default function ReadingHistory({ entityId, mappingType }: {
  entityId: string;
  /** The device's mapped type; its domain when it has no mapping. */
  mappingType?: string;
}) {
  const { entities } = useHA();
  const entity = entities[entityId];
  const r = readingOf(entityId, entity, mappingType ?? domainOf(entityId));
  const unit = entity?.attributes.unit_of_measurement ?? "";
  return historyOf(r) === "states" ? <LastDayTimeline entityId={entityId} colorFor={r.stateColor ?? undefined} />
    : historyOf(r) === "words" ? <LastDayTimeline entityId={entityId} legend />
    : <NumericHistory series={[{ id: entityId, label: "Reading", unit, color: r.seriesColor }]} />;
}
