// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { useEffect, useState } from "react";
import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import StateTimeline from "./StateTimeline";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import type { StateHistoryPoint } from "@/types/ha.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { onOffColor, isUnavailable } from "@/utils/stateColors";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = entity?.state === "on";
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(mapping.entityId, 24).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [mapping.entityId]);

  const toggle = () => HAServices.toggleEntity(ws, mapping.entityId);

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<ToggleLeft size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="switch" /> : <PowerToggle on={on} onClick={toggle} />}

      <div className="field">
        <label className="entity-label">Last 24 hours</label>
        <StateTimeline data={history} colorFor={onOffColor} />
      </div>
    </BasePanel>
  );
}
