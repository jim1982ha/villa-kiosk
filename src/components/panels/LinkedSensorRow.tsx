// src/components/panels/LinkedSensorRow.tsx
// A device's linked entity when it is a SENSOR (a binary_sensor — a lock's door contact): its band, under the device's
// own band in every window (BasePanel), over the same range. A sensor cannot be
// switched, and the toggle drawn for it read as one that could (owner, 2026-10-21: "show a thinner band showing the
// state of it"). The band is the windows' own StateTimeline, slim as the camera's; its words, its colours and the
// line under the name are the reading's (config/reading) — the one binary rule, as its own window.

import { useHA } from "@/ha/HAStateStore";
import { readingOf, stateWords } from "@/config/reading";
import { historyStateColor } from "@/utils/stateColors";
import StateTimeline from "./StateTimeline";
import { useFollowerBand, useSharedRange } from "./historyRange";

/** The band's height (px): thinner than the device's own band above it, thick enough to read. */
export const LINKED_BAND_PX = 28;

/** ⚠️ UNDER THE DEVICE'S OWN BAND, AT ITS WIDTH AND OVER ITS RANGE (owner, 2026-10-21: "taking the same width as the
 *  bigger bar … so that it's easy to compare states of both devices over the same scale"): it sat at the top in the
 *  switch's row, a short bar of a fixed day beside the name. Its name above it; its state in its legend. */
export default function LinkedSensorRow({ entityId, label, role }: {
  entityId: string;
  label: string;
  /** What it is to the device, after its name (owner, 2026-10-21): "Door sensor (linked entity)",
   *  "Staircase motion (motion sensor)". */
  role: "linked entity" | "motion sensor";
}) {
  const { entities } = useHA();
  const entity = entities[entityId];
  const range = useSharedRange();
  // ⚠️ THE DEVICE BAND'S WINDOW, NEVER ITS OWN (useFollowerBand): it moved back on its own when this sensor was
  // silent, and stayed on today when the device's band had moved
  const { data, status, end } = useFollowerBand(entityId);
  const reading = readingOf(entityId, entity, "binary_sensor");
  return (
    <div className="field panel-linked-history">
      <div className="panel-linked-label" title={`${label} (${role})`}>{label} <span className="muted">({role})</span></div>
      <StateTimeline
        data={data}
        status={status}
        hours={range.hours}
        grainMs={range.grainMs}
        end={end}
        height={LINKED_BAND_PX}
        colorFor={reading.stateColor ?? historyStateColor(entityId)}
        labelFor={stateWords(entityId, entity?.attributes.device_class as string | undefined)}
      />
    </div>
  );
}
