// src/components/panels/GenericPanel.tsx
// Fallback for entity types without a dedicated panel (e.g. assist_satellite).

import { Info } from "lucide-react";
import BasePanel from "./BasePanel";
import LastDayTimeline from "./LastDayTimeline";
import type { PanelProps } from "@/types/panel.types";
import { isUnavailable } from "@/utils/stateColors";
import UnavailableNotice from "./UnavailableNotice";

export default function GenericPanel({ entity, mapping, onClose }: PanelProps) {
  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Info size={22} />} history={false} onClose={onClose}>
      {isUnavailable(entity) ? <UnavailableNotice /> : (
        <div className="center" style={{ margin: "8px 0 16px" }}>
          <span className="value-large">{entity?.state ?? "unknown"}</span>
        </div>
      )}
      <div className="field">
        <label className="entity-label">Entity</label>
        <div className="body-text muted">{mapping.entityId}</div>
      </div>
      <LastDayTimeline entityId={mapping.entityId} legend />
    </BasePanel>
  );
}
