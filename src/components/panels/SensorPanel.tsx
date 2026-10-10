// src/components/panels/SensorPanel.tsx
// A sensor's window: an on/off sensor (worded by its device class), a
// measurement, or a sensor whose state is words (an access point's
// "connected"). WHAT the reading is — words, number, colour, pill, alarm — is
// config/reading's, the one answer the grouped device window and "Also on
// this device" share; this window only lays it out.

import { Activity } from "lucide-react";
import BasePanel from "./BasePanel";
import LastDayTimeline from "./LastDayTimeline";
import NumericHistory from "./NumericHistory";
import ReadingPill from "./ReadingPill";
import type { PanelProps } from "@/types/panel.types";
import { useConfig } from "@/config/ConfigContext";
import { historyOf, readingOf } from "@/config/reading";
import { binarySensorClassInfo } from "@/config/BinarySensorClasses";
import { effectiveSensorClass, SENSOR_CLASS_ICON } from "@/config/SensorClasses";

export default function SensorPanel({ entity, mapping, onClose }: PanelProps) {
  const { config } = useConfig();
  const r = readingOf(mapping.entityId, entity, mapping.type, config.alertThresholds);
  const isBinary = r.kind === "binary";
  const unit = entity?.attributes.unit_of_measurement ?? "";

  // Same resolution the 3D badge uses (babylon/badgeIconKeys.ts) — device_class,
  // falling back to unit_of_measurement for sensors that don't report one — so
  // the panel that opens from tapping a badge never shows a different glyph
  // than the badge itself. Activity is the generic fallback either couldn't
  // resolve (matches the badge's own TYPE_ICON_KEY.sensor default territory).
  const BinaryIcon = binarySensorClassInfo(entity?.attributes.device_class).icon;
  const sensorClass = !isBinary
    ? effectiveSensorClass(entity?.attributes.device_class as string | undefined, unit)
    : undefined;
  const SensorIcon = (sensorClass && SENSOR_CLASS_ICON[sensorClass]) || Activity;
  const icon = isBinary ? <BinaryIcon size={22} /> : <SensorIcon size={22} />;

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={icon} history={false} onClose={onClose}>
      <div className="center" style={{ padding: "12px 0 6px", margin: isBinary ? undefined : "6px 0 12px" }}>
        {r.pill ? (
          <ReadingPill r={r} icon={BinaryIcon} size={22} style={{ fontSize: "var(--text-xl)", padding: "14px 24px" }} />
        ) : (
          <>
            {/* ⚠️ THE SAME RULE THE BADGE USES (utils/entityValue, inside
                config/reading): a 6570.989 W sensor reads "6.6 kW" here as on
                the badge in the villa behind it. */}
            <span className="value-large" style={{ color: r.color }}>{r.value}</span>{" "}
            {r.unit && <span className="value-unit">{r.unit}</span>}
          </>
        )}
      </div>
      {/* ONE history, by what the sensor reports — config/reading's historyOf,
          the rule the grouped device window shares. */}
      {historyOf(r) === "states" ? <LastDayTimeline entityId={mapping.entityId} colorFor={r.stateColor ?? undefined} />
        : historyOf(r) === "words" ? <LastDayTimeline entityId={mapping.entityId} legend />
        : <NumericHistory series={[{ id: mapping.entityId, label: "Reading", unit, color: r.seriesColor }]} />}
    </BasePanel>
  );
}
