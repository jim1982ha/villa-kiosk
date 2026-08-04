// src/components/panels/SensorPanel.tsx
// Numeric sensors + binary_sensor presentation (contextual per device_class).
// A THIRD case lives here too: a "sensor" whose state is text/enum, not a
// number (e.g. an access point reporting "connected"/"disconnected") — see
// isEnum below.

import { useEffect, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import BasePanel from "./BasePanel";
import Sparkline from "./Sparkline";
import StateTimeline from "./StateTimeline";
import type { PanelProps } from "@/types/panel.types";
import type { HistoryPoint, StateHistoryPoint } from "@/types/ha.types";
import { useConfig } from "@/config/ConfigContext";
import { fetchHistory, fetchStateHistory } from "@/ha/HAHistoryAPI";
import { levelForValue, type AlertLevel } from "@/config/ThresholdConfig";
import { binarySensorClassInfo } from "@/config/BinarySensorClasses";
import { effectiveSensorClass, SENSOR_CLASS_ICON } from "@/config/SensorClasses";
import { binarySensorColor, paletteColorFor, isUnavailable } from "@/utils/stateColors";

const LEVEL_COLOR: Record<AlertLevel, string> = {
  normal: "var(--status-on)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
};

export default function SensorPanel({ entity, mapping, onClose }: PanelProps) {
  const { config } = useConfig();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [stateHistory, setStateHistory] = useState<StateHistoryPoint[]>([]);
  // Distinguishes "still fetching" from "HA genuinely has no history yet" —
  // see useStateHistory's docstring for why this matters (same gap, this
  // panel just doesn't go through that shared hook, since it fetches ONE of
  // two different history shapes depending on isBinary/isEnum).
  const [historyLoading, setHistoryLoading] = useState(true);

  const isBinary = mapping.type === "binary_sensor";
  const unavailable = isUnavailable(entity);
  const numeric = Number(entity?.state);
  // A plain "sensor" whose current state doesn't parse as a number is a
  // text/enum sensor (connectivity status, a weather condition string, …) —
  // fetchHistory's numeric-only filter would silently drop every point for
  // one of these (that's why a device like an access point's "connected" /
  // "disconnected" state used to show "Not enough history yet" despite HA
  // holding real history for it), so it gets the raw state-history path below
  // instead of the numeric Sparkline one.
  const isEnum = !isBinary && entity != null && !Number.isFinite(numeric);
  const unit = entity?.attributes.unit_of_measurement ?? "";
  const threshold = config.alertThresholds[mapping.entityId];
  // What this SPECIFIC binary_sensor reports — a leak sensor, a motion PIR, a
  // door contact, etc. — read from HA's own device_class attribute, so the
  // wording/icon/danger-styling below matches what's actually being
  // monitored instead of assuming every binary_sensor is a leak alarm.
  const classInfo = binarySensorClassInfo(entity?.attributes.device_class);
  // A per-entity threshold override (config.alertThresholds, currently only
  // seeded from DEFAULT_THRESHOLDS — no in-app editor) always wins; otherwise
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
    // History is fetched token-less through the add-on's Supervisor proxy.
    let cancelled = false;
    setHistoryLoading(true);
    if (isBinary || isEnum) {
      fetchStateHistory(mapping.entityId, 24)
        .then((h) => { if (!cancelled) { setStateHistory(h); setHistoryLoading(false); } })
        .catch(() => { if (!cancelled) setHistoryLoading(false); });
    } else {
      fetchHistory(mapping.entityId, 24)
        .then((h) => { if (!cancelled) { setHistory(h); setHistoryLoading(false); } })
        .catch(() => { if (!cancelled) setHistoryLoading(false); });
    }
    return () => {
      cancelled = true;
    };
  }, [mapping.entityId, isBinary, isEnum]);

  const BinaryIcon = classInfo.icon;
  // Same resolution the 3D badge uses (babylon/badgeIconKeys.ts) — device_class,
  // falling back to unit_of_measurement for sensors that don't report one — so
  // the panel that opens from tapping a badge never shows a different glyph
  // than the badge itself. Activity is the generic fallback either couldn't
  // resolve (matches the badge's own TYPE_ICON_KEY.sensor default territory).
  const sensorClass = !isBinary
    ? effectiveSensorClass(entity?.attributes.device_class as string | undefined, unit)
    : undefined;
  const SensorIcon = (sensorClass && SENSOR_CLASS_ICON[sensorClass]) || Activity;
  const icon = isBinary ? <BinaryIcon size={22} /> : <SensorIcon size={22} />;
  const enumPalette = isEnum ? paletteColorFor(stateHistory.map((p) => p.state)) : undefined;
  const enumDistinctStates = isEnum ? [...new Set(stateHistory.map((p) => p.state))] : [];

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={icon} onClose={onClose}>
      {isBinary ? (
        <>
          <div className="center" style={{ padding: "12px 0 6px" }}>
            {/* unavailable MUST win over the device_class off-label below —
                showing e.g. "Dry"/"No motion" (classInfo.offLabel) for a
                sensor HA has actually lost contact with claims a confirmed
                reading that was never taken. */}
            <div
              className={`status-pill ${unavailable ? "unavailable" : binaryPillTone}`}
              style={{ fontSize: "var(--text-xl)", padding: "14px 24px" }}
            >
              {unavailable
                ? <AlertTriangle size={22} />
                : level === "danger" ? <AlertTriangle size={22} /> : <BinaryIcon size={22} />}
              {unavailable
                ? "UNAVAILABLE"
                : level === "danger" ? binaryStateText.toUpperCase() : binaryStateText}
            </div>
          </div>
          <div className="field">
            <label className="entity-label">Last 24 hours</label>
            <StateTimeline
              data={stateHistory}
              colorFor={(s) => binarySensorColor(s, alertState)}
              loading={historyLoading}
            />
          </div>
        </>
      ) : (
        <>
          <div className="center" style={{ margin: "6px 0 18px" }}>
            <span
              className="value-large"
              style={{ color: unavailable ? "var(--status-warning)" : isEnum ? "var(--text-primary)" : LEVEL_COLOR[level] }}
            >
              {unavailable ? "Unavailable" : isEnum ? (entity?.state ?? "--") : Number.isFinite(numeric) ? numeric : entity?.state ?? "--"}
            </span>{" "}
            {!unavailable && !isEnum && <span className="value-unit">{unit}</span>}
          </div>
          <div className="field">
            <label className="entity-label">Last 24 hours</label>
            {isEnum ? (
              <StateTimeline
                data={stateHistory}
                colorFor={enumPalette!}
                legend={enumDistinctStates.map((s) => ({ state: s, color: enumPalette!(s) }))}
                loading={historyLoading}
              />
            ) : (
              <Sparkline data={history} color={LEVEL_COLOR[level]} unit={unit} loading={historyLoading} />
            )}
          </div>
        </>
      )}
    </BasePanel>
  );
}
