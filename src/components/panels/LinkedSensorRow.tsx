// src/components/panels/LinkedSensorRow.tsx
// A device's linked entity when it is a SENSOR (a binary_sensor — a lock's door contact): the linked-entity row of
// every window (BasePanel), with a thin band of the sensor's last 24 h where the switch would be. A sensor cannot be
// switched, and the toggle drawn for it read as one that could (owner, 2026-10-21: "show a thinner band showing the
// state of it"). The band is the windows' own StateTimeline, slim as the camera's; its words, its colours and the
// line under the name are the reading's (config/reading) — the one binary rule, as its own window.

import { useHA } from "@/ha/HAStateStore";
import { readingOf, rowText, stateWords } from "@/config/reading";
import { useStateHistory } from "@/hooks/useStateHistory";
import { historyStateColor } from "@/utils/stateColors";
import StateTimeline from "./StateTimeline";

/** The band's span: the last day, as a window's history opens (LastDayTimeline). */
const BAND_HOURS = 24;
/** The band's height (px): thin, so the row keeps the height the switch gave it. */
export const LINKED_BAND_PX = 10;

export default function LinkedSensorRow({ entityId, label }: { entityId: string; label: string }) {
  const { entities } = useHA();
  const entity = entities[entityId];
  const { data, status, lastSeen } = useStateHistory(entityId, BAND_HOURS);
  const reading = readingOf(entityId, entity, "binary_sensor");
  return (
    <div className="panel-linked-row panel-linked-sensor">
      <div className="panel-linked-text">
        <div className="panel-linked-label" title={label}>{label}</div>
        <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>
          {entity ? rowText(entityId, entity) : "Unavailable"} · linked entity
        </div>
      </div>
      <div className="panel-linked-band" aria-label={`${label}: the last ${BAND_HOURS} hours`}>
        <StateTimeline
          data={data}
          status={status}
          hours={BAND_HOURS}
          end={lastSeen}
          height={LINKED_BAND_PX}
          // too thin to carry its legend: its state is said beside it, its colours in its own window
          legend={false}
          colorFor={reading.stateColor ?? historyStateColor(entityId)}
          labelFor={stateWords(entityId, entity?.attributes.device_class as string | undefined)}
        />
      </div>
    </div>
  );
}
