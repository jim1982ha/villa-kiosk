// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import LastDayTimeline from "./LastDayTimeline";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useStateHistory } from "@/hooks/useStateHistory";
import { onOffColor, isUnavailable } from "@/utils/stateColors";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = entity?.state === "on";
  const { data: history, loading: historyLoading } = useStateHistory(mapping.entityId);

  const toggle = () => HAServices.toggleEntity(ws, mapping.entityId);

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<ToggleLeft size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="switch" /> : <PowerToggle on={on} onClick={toggle} />}

      <LastDayTimeline data={history} colorFor={onOffColor} loading={historyLoading} />
    </BasePanel>
  );
}
