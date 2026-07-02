// src/components/panels/SensorPanel.tsx
// Numeric sensors + binary_sensor presentation (contextual per device_class).

import { useEffect, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import BasePanel from "./BasePanel";
import Sparkline from "./Sparkline";
import type { PanelProps } from "@/types/panel.types";
import type { HistoryPoint } from "@/types/ha.types";
import { useConfig } from "@/config/ConfigContext";
import { fetchHistory } from "@/ha/HAHistoryAPI";
import { levelForValue, type AlertLevel } from "@/config/ThresholdConfig";
import { binarySensorClassInfo } from "@/config/BinarySensorClasses";

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
  // What this SPECIFIC binary_sensor reports — a leak sensor, a motion PIR, a
  // door contact, etc. — read from HA's own device_class attribute, so the
  // wording/icon/danger-styling below matches what's actually being
  // monitored instead of assuming every binary_sensor is a leak alarm.
  const classInfo = binarySensorClassInfo(entity?.attributes.device_class);
  // A user's own Settings → Alert Thresholds override always wins; otherwise
  // fall back to the device_class's default problem state ("none" = this
  // class is purely informational — e.g. motion/occupancy — so it's never
  // auto-flagged as an alert).
  const defaultAlarmState = classInfo.alarmState === "none" ? undefined : classInfo.alarmState;
  const alertState = threshold?.alertState ?? defaultAlarmState;
  const level: AlertLevel =
    isBinary
      ? alertState !== undefined && entity?.state === alertState ? "danger" : "normal"
      : Number.isFinite(numeric) ? levelForValue(numeric, threshold) : "normal";
  const binaryStateText = entity?.state === "on" ? classInfo.onLabel : classInfo.offLabel;
  const binaryPillTone = level === "danger" ? "danger" : entity?.state === "on" ? "on" : "off";

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

  const BinaryIcon = classInfo.icon;
  const icon = isBinary ? <BinaryIcon size={22} /> : <Activity size={22} />;

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={icon} onClose={onClose}>
      {isBinary ? (
        <div className="center" style={{ padding: "12px 0 6px" }}>
          <div className={`status-pill ${binaryPillTone}`} style={{ fontSize: 20, padding: "14px 24px" }}>
            {level === "danger" ? <AlertTriangle size={22} /> : <BinaryIcon size={22} />}
            {level === "danger" ? binaryStateText.toUpperCase() : binaryStateText}
          </div>
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
