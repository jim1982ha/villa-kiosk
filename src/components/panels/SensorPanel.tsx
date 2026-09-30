// src/components/panels/SensorPanel.tsx
// Numeric sensors + binary_sensor presentation (contextual per device_class).
// A THIRD case lives here too: a "sensor" whose state is text/enum, not a
// number (e.g. an access point reporting "connected"/"disconnected") — see
// isEnum below.

import { formatSensorParts } from "@/utils/entityValue";
import { Activity, AlertTriangle } from "lucide-react";
import BasePanel from "./BasePanel";
import LastDayTimeline from "./LastDayTimeline";
import NumericHistory from "./NumericHistory";
import type { PanelProps } from "@/types/panel.types";
import { useConfig } from "@/config/ConfigContext";
import type { AlertLevel } from "@/config/ThresholdConfig";
import { readingKind, readingLevel } from "@/config/sensorReading";
import { stateLabelFor, binarySensorClassInfo, alertStateFor } from "@/config/BinarySensorClasses";
import { effectiveSensorClass, SENSOR_CLASS_ICON } from "@/config/SensorClasses";
import { binarySensorColor, isUnavailable } from "@/utils/stateColors";

const LEVEL_COLOR: Record<AlertLevel, string> = {
  normal: "var(--status-on)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
};

export default function SensorPanel({ entity, mapping, onClose }: PanelProps) {
  const { config } = useConfig();

  // What kind of reading this is — config/sensorReading, the ONE answer the
  // grouped-device panel shares. A text sensor (an access point's
  // "connected") gets the state timeline, because the numeric history would
  // drop every point; an OFFLINE measurement keeps its chart (it used to
  // become "text" the moment its state stopped being a number).
  const kind = readingKind(entity, mapping.type);
  const isBinary = kind === "binary";
  const isEnum = kind === "text";
  const unavailable = isUnavailable(entity);
  const unit = entity?.attributes.unit_of_measurement ?? "";
  // One reading, written once — see utils/entityValue.
  const formatted = entity ? formatSensorParts(entity) : { value: "", unit: "" };
  const threshold = config.alertThresholds[mapping.entityId];
  // What this SPECIFIC binary_sensor reports — a leak sensor, a motion PIR, a
  // door contact, etc. — read from HA's own device_class attribute, so the
  // wording/icon/danger-styling below matches what's actually being
  // monitored instead of assuming every binary_sensor is a leak alarm.
  const classInfo = binarySensorClassInfo(entity?.attributes.device_class);
  // The same rule the map badge now reads — see BinarySensorClasses.alertStateFor.
  // This combination (per-entity override wins, else the device_class default,
  // "none" meaning never a fault) used to live here alone, which is why the
  // badge and this panel disagreed about every motion sensor in the villa.
  const alertState = alertStateFor(
    entity?.attributes.device_class as string | undefined, threshold?.alertState);
  const level: AlertLevel = readingLevel(entity, kind, threshold, alertState);
  // The pill and the history tooltip word a state the same way — stateLabelFor.
  // (An unavailable sensor never reaches this: the pill shows "Unavailable" first.)
  const labelFor = stateLabelFor(mapping.entityId, entity?.attributes.device_class as string | undefined);
  const binaryStateText = labelFor(entity?.state === "on" ? "on" : "off");
  const binaryPillTone = level === "danger" ? "danger" : entity?.state === "on" ? "on" : "off";

  // ONE of two history sections, by what the sensor reports: raw states for a
  // binary or text sensor (a numeric parse would drop every row) — the shared
  // state section, with its look-back for a sensor that is down for the whole
  // window — and numbers with their gaps for the rest (NumericHistory).

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

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={icon} history={false} onClose={onClose}>
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
          <LastDayTimeline entityId={mapping.entityId} colorFor={(s) => binarySensorColor(s, alertState)} />
        </>
      ) : (
        <>
          <div className="center" style={{ margin: "6px 0 18px" }}>
            <span
              className="value-large"
              style={{ color: unavailable ? "var(--status-warning)" : isEnum ? "var(--text-primary)" : LEVEL_COLOR[level] }}
            >
              {/* ⚠️ THE SAME RULE THE BADGE USES (utils/entityValue). This
                  printed the RAW state and the RAW unit, so a 6570.989 W
                  sensor read "6570.989" here and "6.6 kW" on the badge in the
                  villa behind it — the same sensor, one screen, two numbers.
                  No `clamp` and no `hideNominal`: this surface has room, and a
                  nominal status belongs on a row that has no coloured ring to
                  say it for them. */}
              {unavailable ? "Unavailable" : formatted.value || (entity?.state ?? "--")}
            </span>{" "}
            {!unavailable && formatted.unit && <span className="value-unit">{formatted.unit}</span>}
          </div>
          {isEnum ? <LastDayTimeline entityId={mapping.entityId} legend /> : (
            <NumericHistory series={[{ id: mapping.entityId, label: "Reading", unit, color: LEVEL_COLOR[level] }]} />
          )}
        </>
      )}
    </BasePanel>
  );
}
