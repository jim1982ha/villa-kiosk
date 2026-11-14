// src/components/panels/LinkedSensorRow.tsx
// A device's linked entity when it is a SENSOR (a binary_sensor — a lock's door contact): its band, under the device's
// own band in every window (BasePanel), over the same range. A sensor cannot be
// switched, and the toggle drawn for it read as one that could (owner, 2026-10-21: "show a thinner band showing the
// state of it"). The band is the windows' own StateTimeline, slim as the camera's; its words, its colours and the
// line under the name are the reading's (config/reading) — the one binary rule, as its own window.

import type { ReactNode } from "react";
import { useHA } from "@/ha/HAStateStore";
import { readingOf, stateWords } from "@/config/reading";
import { historyStateColor } from "@/utils/stateColors";
import StateTimeline from "./StateTimeline";
import { useFollowerBand, useSharedRange } from "./historyRange";
import { AlignedToChart, useChartFrame } from "./chartFrame";
import { HOUR_MS } from "@/utils/localDay";

/** The band's height (px): thinner than the device's own band above it, thick enough to read. */
export const LINKED_BAND_PX = 28;

/** ⚠️ UNDER THE DEVICE'S OWN BAND, AT ITS WIDTH AND OVER ITS RANGE (owner, 2026-10-21: "taking the same width as the
 *  bigger bar … so that it's easy to compare states of both devices over the same scale"): it sat at the top in the
 *  switch's row, a short bar of a fixed day beside the name. Its name above it; its state in its legend. */
export default function LinkedSensorRow({ entityId, label, role, control }: {
  entityId: string;
  label: string;
  /** A linked entity that CAN be switched (a light, a switch): its switch, before its name. Its band is then its own
   *  domain's states (owner, 2026-11-14: the switch row moved here from the top of the window, under the history,
   *  where a camera's motion sensor sits). */
  control?: ReactNode;
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
  const reading = control ? null : readingOf(entityId, entity, "binary_sensor");
  // ⚠️ UNDER THE WINDOW'S CHART, EXACTLY (owner, 2026-11-14): its bar over the plot's own columns and time (chartFrame)
  const frame = useChartFrame();
  const span = frame?.window;
  const name = <div className="panel-linked-label" data-tip={`${label} (${role})`}>{label} <span className="muted">({role})</span></div>;
  return (
    <div className="field panel-linked-history">
      {control ? <div className="panel-linked-head">{control}{name}</div> : name}
      <AlignedToChart frame={frame}>
      <StateTimeline
        data={data}
        status={status}
        hours={span ? (span.to - span.from) / HOUR_MS : range.hours}
        grainMs={range.grainMs}
        end={span ? span.to : end}
        height={LINKED_BAND_PX}
        colorFor={reading?.stateColor ?? historyStateColor(entityId)}
        labelFor={stateWords(entityId, entity?.attributes.device_class as string | undefined)}
      />
      </AlignedToChart>
    </div>
  );
}
