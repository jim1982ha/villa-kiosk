// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { useEffect, useState } from "react";
import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import StateTimeline from "./StateTimeline";
import type { PanelProps } from "@/types/panel.types";
import type { StateHistoryPoint } from "@/types/ha.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { useOptimisticToggle } from "@/hooks/useOptimisticToggle";
import { onOffColor } from "@/utils/stateColors";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(mapping.entityId, 24).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [mapping.entityId]);

  const toggle = useOptimisticToggle(mapping.entityId, () => HAServices.toggleEntity(ws, mapping.entityId));

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<ToggleLeft size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={toggle} />

      <div className="field">
        <label className="entity-label">Last 24 hours</label>
        <StateTimeline data={history} colorFor={onOffColor} />
      </div>
    </BasePanel>
  );
}
