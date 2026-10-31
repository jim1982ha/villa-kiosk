// src/components/panels/GenericPanel.tsx
// Fallback for entity types without a dedicated panel (e.g. assist_satellite).

import { Info } from "lucide-react";
import BasePanel from "./BasePanel";
import LastDayTimeline from "./LastDayTimeline";
import type { PanelProps } from "@/types/panel.types";
import { isOffline } from "@/utils/stateColors";

export default function GenericPanel({ entity, mapping, onClose }: PanelProps) {
  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Info size={22} />} onClose={onClose}
      history={<LastDayTimeline entityId={mapping.entityId} palette />}>
      {/* its state, unless contact is LOST (the frame's notice says so: BasePanel); "unknown" is a state, shown as one */}
      {!isOffline(entity) && (
        <div className="center" style={{ margin: "8px 0 16px" }}>
          <span className="value-large">{entity?.state ?? "unknown"}</span>
        </div>
      )}
      <div className="field">
        <label className="entity-label">Entity</label>
        <div className="body-text muted">{mapping.entityId}</div>
      </div>
    </BasePanel>
  );
}
