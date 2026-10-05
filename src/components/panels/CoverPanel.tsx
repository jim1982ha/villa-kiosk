// src/components/panels/CoverPanel.tsx
import { Blinds, ChevronUp, ChevronDown, Square } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { statusKeyFor, STATUS_PILL_CLASS } from "@/utils/stateColors";
import { coverStateLabel } from "@/utils/panelRules";
import { useLiveDraft } from "@/hooks/useLiveDraft";
import ControlFrame from "./ControlFrame";

export default function CoverPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const pos = entity?.attributes.current_position;
  const hasPosition = typeof pos === "number";
  // Follows the device until dragged (useLiveDraft): a state event mid-drag
  // would otherwise snap it back and the release would send a stale number.
  const position = useLiveDraft<number>(hasPosition ? pos as number : undefined, 0,
    (v) => HAServices.setCoverPosition(ws, mapping.entityId, v));
  const stateLabel = coverStateLabel(entity?.state, hasPosition ? position.value : undefined);

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Blinds size={22} />} onClose={onClose}>
      {/* ab0ffb46 routed Cover through the shared notice in a comment only —
          the bespoke pill carried no detail. The notice, as every panel. */}
      <ControlFrame entity={entity} mapping={mapping} device="cover">
        <div className="center" style={{ marginBottom: 16 }}>
          <span className={`status-pill ${STATUS_PILL_CLASS[statusKeyFor(entity?.state ?? "", mapping.entityId)]}`}>{stateLabel}</span>
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
          <label className="entity-label">Position · {position.value}%</label>
          <input
            type="range" min={0} max={100} {...position.rangeProps}
          />
        </div>
      )}
      </ControlFrame>

    </BasePanel>
  );
}
