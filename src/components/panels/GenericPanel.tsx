// src/components/panels/GenericPanel.tsx
// Fallback for entity types without a dedicated panel (e.g. assist_satellite).

import { Info } from "lucide-react";
import BasePanel from "./BasePanel";
import StateTimeline from "./StateTimeline";
import { useHistoryRange, HistoryHeader } from "./historyRange";
import type { PanelProps } from "@/types/panel.types";
import { useStateHistory } from "@/hooks/useStateHistory";
import { paletteColorFor } from "@/utils/stateColors";

export default function GenericPanel({ entity, mapping, onClose }: PanelProps) {
  const { range, picker } = useHistoryRange();
  const { data: history, loading: historyLoading } = useStateHistory(mapping.entityId, range.hours);

  const colorFor = paletteColorFor(history.map((p) => p.state));
  const distinctStates = [...new Set(history.map((p) => p.state))];

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Info size={22} />} history={false} onClose={onClose}>
      <div className="center" style={{ margin: "8px 0 16px" }}>
        <span className="value-large">{entity?.state ?? "unknown"}</span>
      </div>
      <div className="field">
        <label className="entity-label">Entity</label>
        <div className="body-text muted">{mapping.entityId}</div>
      </div>
      <div className="field">
        <HistoryHeader title={range.title} picker={picker} />
        <StateTimeline
          data={history}
          colorFor={colorFor}
          legend={distinctStates.map((s) => ({ state: s, color: colorFor(s) }))}
          loading={historyLoading}
          hours={range.hours}
        bucketMinutes={range.bucketMinutes}
        />
      </div>
    </BasePanel>
  );
}
