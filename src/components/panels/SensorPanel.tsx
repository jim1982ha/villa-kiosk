// src/components/panels/SensorPanel.tsx
// Numeric sensors + binary_sensor (leak) presentation.

import { useEffect, useState } from "react";
import { Activity, Droplets, ShieldCheck, AlertTriangle } from "lucide-react";
import BasePanel from "./BasePanel";
import Sparkline from "./Sparkline";
import type { PanelProps } from "@/types/panel.types";
import type { HistoryPoint } from "@/types/ha.types";
import { useConfig } from "@/config/ConfigContext";
import { fetchHistory } from "@/ha/HAHistoryAPI";
import { levelForValue, type AlertLevel } from "@/config/ThresholdConfig";

const LEVEL_COLOR: Record<AlertLevel, string> = {
  normal: "var(--status-on)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
};

export default function SensorPanel({ entity, mapping, onClose }: PanelProps) {
  const { config } = useConfig();
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const isBinary = mapping.type === "binary_sensor";
  const numeric = Number(entity?.state);
  const unit = entity?.attributes.unit_of_measurement ?? "";
  const threshold = config.alertThresholds[mapping.entityId];
  const level: AlertLevel =
    isBinary
      ? entity?.state === (threshold?.alertState ?? "on") ? "danger" : "normal"
      : Number.isFinite(numeric) ? levelForValue(numeric, threshold) : "normal";

  useEffect(() => {
    if (isBinary || !config.haUrl || !config.haToken) return;
    let cancelled = false;
    fetchHistory(config.haUrl, config.haToken, mapping.entityId, 24)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mapping.entityId, isBinary, config.haUrl, config.haToken]);

  const icon = isBinary ? <Droplets size={22} /> : <Activity size={22} />;

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={icon} onClose={onClose}>
      {isBinary ? (
        <div className="center" style={{ padding: "12px 0 6px" }}>
          {level === "danger" ? (
            <div className="status-pill danger" style={{ fontSize: 20, padding: "14px 24px" }}>
              <AlertTriangle size={22} /> LEAK DETECTED
            </div>
          ) : (
            <div className="status-pill on" style={{ fontSize: 20, padding: "14px 24px" }}>
              <ShieldCheck size={22} /> No leak
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="center" style={{ margin: "6px 0 18px" }}>
            <span className="value-large" style={{ color: LEVEL_COLOR[level] }}>
              {Number.isFinite(numeric) ? numeric : entity?.state ?? "--"}
            </span>{" "}
            <span className="value-unit">{unit}</span>
          </div>
          <div className="field">
            <label className="entity-label">Last 24 hours</label>
            <Sparkline data={history} color={LEVEL_COLOR[level]} />
          </div>
        </>
      )}

      <p className="muted body-text mt">
        Updated {entity ? new Date(entity.last_updated).toLocaleTimeString() : "—"}
      </p>
    </BasePanel>
  );
}
