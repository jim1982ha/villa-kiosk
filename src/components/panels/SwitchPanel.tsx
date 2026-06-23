// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities (confirmation + runtime warning).

import { useState } from "react";
import { Power, ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { formatRuntime } from "@/utils/time";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const [confirming, setConfirming] = useState(false);
  const runtime = entity ? formatRuntime(entity.last_changed) : "";

  const toggle = () => {
    HAServices.toggleEntity(ws, mapping.entityId);
    setConfirming(false);
  };

  const onClick = () => {
    if (mapping.requiresConfirmation && !on) setConfirming(true);
    else toggle();
  };

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<ToggleLeft size={22} />} onClose={onClose}>
      <button className={`big-toggle ${on ? "on" : ""}`} onClick={onClick}>
        <Power size={24} /> {on ? "On" : "Off"}
      </button>

      {confirming && (
        <div className="modal-actions mt">
          <span className="body-text" style={{ marginRight: "auto" }}>Turn on {mapping.label}?</span>
          <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
          <button className="btn primary" onClick={toggle}>Confirm</button>
        </div>
      )}

      {on && <p className="muted body-text mt">Running for {runtime}</p>}
    </BasePanel>
  );
}
