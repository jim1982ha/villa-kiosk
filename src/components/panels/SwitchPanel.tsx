// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = devicePower(entity, mapping.entityId).position === "on";

  const toggle = () => HAServices.power(ws, entity, mapping.entityId);

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<ToggleLeft size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="switch" /> : (
        <PowerToggle on={on} onClick={toggle} label={mapping.label} requireConfirm={mapping.requireConfirm} />
      )}

    </BasePanel>
  );
}
