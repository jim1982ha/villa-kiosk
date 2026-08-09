// src/components/panels/CoverPanel.tsx
import { useState, useEffect, useRef } from "react";
import { Blinds, ChevronUp, ChevronDown, Square } from "lucide-react";
import BasePanel from "./BasePanel";
import LastDayTimeline from "./LastDayTimeline";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable, statusKeyFor, STATUS_PILL_CLASS } from "@/utils/stateColors";

export default function CoverPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const pos = entity?.attributes.current_position;
  const hasPosition = typeof pos === "number";
  const [position, setPosition] = useState<number>(hasPosition ? pos! : 0);
  // While the user is dragging the slider, ignore live HA updates: a state event
  // arriving mid-drag would otherwise snap `position` back to the device's value,
  // so the release would send the stale number (or nothing changed). Resume
  // syncing once the drag ends.
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current && typeof pos === "number") setPosition(pos);
  }, [pos]);

  const stateLabel = unavailable
    ? "UNAVAILABLE"
    : entity?.state === "open"
      ? hasPosition && position < 100
        ? `Partially open (${position}%)`
        : "Open"
      : entity?.state === "closed"
        ? "Closed"
        : entity?.state ?? "Unknown";

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Blinds size={22} />} onClose={onClose}>
      <div className="center" style={{ marginBottom: 16 }}>
        <span className={`status-pill ${STATUS_PILL_CLASS[statusKeyFor(entity?.state ?? "", mapping.entityId)]}`}>{stateLabel}</span>
      </div>

      {/* The pill above already reads UNAVAILABLE — the shared component's
          hover/assistive text carries the detail (see UnavailableNotice). */}

      <div className="row-buttons" style={unavailable ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <button className="btn" style={{ flex: 1 }} disabled={unavailable} onClick={() => HAServices.openCover(ws, mapping.entityId)}>
          <ChevronUp size={20} /> Open
        </button>
        <button className="btn ghost" style={{ flex: 1 }} disabled={unavailable} onClick={() => HAServices.stopCover(ws, mapping.entityId)}>
          <Square size={16} /> Stop
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={unavailable} onClick={() => HAServices.closeCover(ws, mapping.entityId)}>
          <ChevronDown size={20} /> Close
        </button>
      </div>

      {/* Position slider only when the device reports current_position. */}
      {!unavailable && hasPosition && (
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

      <LastDayTimeline entityId={mapping.entityId} />
    </BasePanel>
  );
}
