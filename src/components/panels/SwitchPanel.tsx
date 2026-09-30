// src/components/panels/SwitchPanel.tsx
// Generic switch + future pump entities.

import { ToggleLeft } from "lucide-react";
import BasePanel from "./BasePanel";
import ControlFrame from "./ControlFrame";
import type { PanelProps } from "@/types/panel.types";

export default function SwitchPanel({ entity, mapping, onClose }: PanelProps) {
  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<ToggleLeft size={22} />} onClose={onClose}>
      <ControlFrame entity={entity} mapping={mapping} device="switch" power />

    </BasePanel>
  );
}
