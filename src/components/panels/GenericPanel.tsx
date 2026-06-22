// src/components/panels/GenericPanel.tsx
// Fallback for entity types without a dedicated panel (e.g. assist_satellite).

import { Info } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";

export default function GenericPanel({ entity, mapping, onClose }: PanelProps) {
  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Info size={22} />} onClose={onClose}>
      <div className="center" style={{ margin: "8px 0 16px" }}>
        <span className="value-large">{entity?.state ?? "unknown"}</span>
      </div>
      <div className="field">
        <label className="entity-label">Entity</label>
        <div className="body-text muted">{mapping.entityId}</div>
      </div>
      {entity && (
        <p className="muted body-text mt">
          Updated {new Date(entity.last_updated).toLocaleTimeString()}
        </p>
      )}
    </BasePanel>
  );
}
