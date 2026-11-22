// src/components/panels/CoverPanel.tsx
import { Blinds, ChevronUp, ChevronDown, Square } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHAActions } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { coverPill } from "@/config/reading";
import { useLiveDraft } from "@/hooks/useLiveDraft";
import ControlFrame from "./ControlFrame";
import { useStatusRule } from "./PanelActionsContext";
import CommandButton from "./CommandButton";

export default function CoverPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHAActions();
  const pos = entity?.attributes.current_position;
  const hasPosition = typeof pos === "number";
  // Follows the device until dragged (useLiveDraft): a state event mid-drag
  // would otherwise snap it back and the release would send a stale number.
  const position = useLiveDraft<number>(hasPosition ? pos as number : undefined, 0,
    (v) => HAServices.setCoverPosition(ws, mapping.entityId, v));
  const pill = coverPill(mapping.entityId, entity?.state, hasPosition ? position.value : undefined, useStatusRule());
  // what a command moves: the blind's state ("opening") or, on one that reports only it, its position
  const moves = `${entity?.state} ${pos}`;

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Blinds size={22} />} onClose={onClose}>
      {/* ab0ffb46 routed Cover through the shared notice in a comment only —
          the bespoke pill carried no detail. The notice, as every panel. */}
      <ControlFrame entity={entity} mapping={mapping} pill={pill}>

      <div className="row-buttons">
        {/* plain, as every button that acts (colour code rule 1, owner 2026-11-22): the pill above says the state */}
        <CommandButton icon={<ChevronUp size={20} />} style={{ flex: 1 }}
          watch={moves} send={() => HAServices.openCover(ws, mapping.entityId)}> Open</CommandButton>
        <CommandButton icon={<Square size={16} />} style={{ flex: 1 }} watch={moves}
          send={() => HAServices.stopCover(ws, mapping.entityId)}> Stop</CommandButton>
        <CommandButton icon={<ChevronDown size={20} />} style={{ flex: 1 }}
          watch={moves} send={() => HAServices.closeCover(ws, mapping.entityId)}> Close</CommandButton>
      </div>

      {/* Position slider only when the device reports current_position. */}
      {hasPosition && (
        <div className="field">
          <label className="eyebrow">Position · {position.value}%</label>
          <input
            type="range" min={0} max={100} {...position.rangeProps}
          />
        </div>
      )}
      </ControlFrame>

    </BasePanel>
  );
}
