// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { formatRuntime } from "@/utils/time";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const runtime = entity ? formatRuntime(entity.last_changed) : "";

  const toggle = () => HAServices.toggleEntity(ws, mapping.entityId);

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<ToggleLeft size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={toggle} />

      {on && <p className="muted body-text mt">Running for {runtime}</p>}
    </BasePanel>
  );
}
