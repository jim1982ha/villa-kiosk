// src/components/panels/CoverPanel.tsx
import { useState, useEffect, useRef } from "react";
import { Blinds, ChevronUp, ChevronDown, Square } from "lucide-react";
import BasePanel from "./BasePanel";
import StateTimeline from "./StateTimeline";
import type { PanelProps } from "@/types/panel.types";
import type { StateHistoryPoint } from "@/types/ha.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { coverColor } from "@/utils/stateColors";

export default function CoverPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const pos = entity?.attributes.current_position;
  const hasPosition = typeof pos === "number";
  const [position, setPosition] = useState<number>(hasPosition ? pos! : 0);
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);
  // While the user is dragging the slider, ignore live HA updates: a state event
  // arriving mid-drag would otherwise snap `position` back to the device's value,
  // so the release would send the stale number (or nothing changed). Resume
  // syncing once the drag ends.
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current && typeof pos === "number") setPosition(pos);
  }, [pos]);

  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(mapping.entityId, 24).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [mapping.entityId]);

  const stateLabel =
    entity?.state === "open"
      ? hasPosition && position < 100
        ? `Partially open (${position}%)`
        : "Open"
      : entity?.state === "closed"
        ? "Closed"
        : entity?.state ?? "Unknown";

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Blinds size={22} />} onClose={onClose}>
      <div className="center" style={{ marginBottom: 16 }}>
        <span className="status-pill off">{stateLabel}</span>
      </div>

      <div className="row-buttons">
        <button className="btn" style={{ flex: 1 }} onClick={() => HAServices.openCover(ws, mapping.entityId)}>
          <ChevronUp size={20} /> Open
        </button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => HAServices.stopCover(ws, mapping.entityId)}>
          <Square size={16} /> Stop
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => HAServices.closeCover(ws, mapping.entityId)}>
          <ChevronDown size={20} /> Close
        </button>
      </div>

      {/* Position slider only when the device reports current_position. */}
      {hasPosition && (
        <div className="field">
          <label className="entity-label">Position · {position}%</label>
          <input
            type="range" min={0} max={100} value={position}
            onPointerDown={() => { dragging.current = true; }}
            onChange={(e) => setPosition(Number(e.target.value))}
            onPointerUp={() => {
              dragging.current = false;
              HAServices.setCoverPosition(ws, mapping.entityId, position);
            }}
          />
        </div>
      )}

      <div className="field">
        <label className="entity-label">Last 24 hours</label>
        <StateTimeline data={history} colorFor={coverColor} />
      </div>
    </BasePanel>
  );
}
