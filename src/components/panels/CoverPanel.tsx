// src/components/panels/CoverPanel.tsx
import { Blinds, ChevronUp, ChevronDown, Square } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { coverPill } from "@/config/reading";
import { useLiveDraft } from "@/hooks/useLiveDraft";
import ControlFrame from "./ControlFrame";
import CommandButton from "./CommandButton";
import { actionColor } from "@/utils/stateColors";

export default function CoverPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const pos = entity?.attributes.current_position;
  const hasPosition = typeof pos === "number";
  // Follows the device until dragged (useLiveDraft): a state event mid-drag
  // would otherwise snap it back and the release would send a stale number.
  const position = useLiveDraft<number>(hasPosition ? pos as number : undefined, 0,
    (v) => HAServices.setCoverPosition(ws, mapping.entityId, v));
  const pill = coverPill(mapping.entityId, entity?.state, hasPosition ? position.value : undefined);
  // what a command moves: the blind's state ("opening") or, on one that reports only it, its position
  const moves = `${entity?.state} ${pos}`;

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Blinds size={22} />} onClose={onClose}>
      {/* ab0ffb46 routed Cover through the shared notice in a comment only —
          the bespoke pill carried no detail. The notice, as every panel. */}
      <ControlFrame entity={entity} mapping={mapping} pill={pill}>

      <div className="row-buttons">
        {/* each in the colour of where it leads (stateColors.actionColor); Stop leads nowhere: plain */}
        <CommandButton className="btn action" style={{ flex: 1, ["--state" as string]: actionColor(mapping.entityId, "open") }}
          watch={moves} send={() => HAServices.openCover(ws, mapping.entityId)}>
          <ChevronUp size={20} /> Open
        </CommandButton>
        <CommandButton className="btn plain" style={{ flex: 1 }} watch={moves} send={() => HAServices.stopCover(ws, mapping.entityId)}>
          <Square size={16} /> Stop
        </CommandButton>
        <CommandButton className="btn action" style={{ flex: 1, ["--state" as string]: actionColor(mapping.entityId, "closed") }}
          watch={moves} send={() => HAServices.closeCover(ws, mapping.entityId)}>
          <ChevronDown size={20} /> Close
        </CommandButton>
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
