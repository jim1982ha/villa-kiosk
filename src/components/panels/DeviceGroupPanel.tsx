// src/components/panels/DeviceGroupPanel.tsx
// Combined view for a device group (config.deviceGroups) — several HA
// entities that are really one physical device (e.g. a temp+humidity combo
// sensor exposed as two entities). Opened instead of the primary entity's
// normal type-based panel (see PanelRouter): every member's current value,
// plus one dual-axis 24h graph when there are exactly two numeric series
// (the common case) or a stacked line chart per series otherwise.

import { formatSensorParts } from "@/utils/entityValue";
import { Layers } from "lucide-react";
import BasePanel from "./BasePanel";
import NumericHistory from "./NumericHistory";
import UnavailableNotice from "./UnavailableNotice";
import { useHA } from "@/ha/HAStateStore";
import type { DeviceGroup } from "@/config/AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import { isUnavailable } from "@/utils/stateColors";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { readingKind } from "@/config/sensorReading";

interface Props {
  group: DeviceGroup;
  primaryMapping: EntityMapping;
  onClose: () => void;
}

/**
 * Colours for telling one plotted SERIES from another — nothing more.
 *
 * These were the status tokens (--status-on / --status-warning /
 * --status-danger), which quietly asserted something they had no basis for: a
 * group's second series was drawn in the app's "needs attention" red and its
 * third in the amber that means "Home Assistant has lost contact", purely
 * because of the order the members happened to be listed in. A humidity line
 * is not alarming for being second.
 *
 * The brand accents carry no status meaning, so they can be assigned by index
 * without claiming anything. Same reasoning as the rule against reusing the
 * --cat-* category hues for non-category UI (see CLAUDE.md): a colour that
 * means something specific elsewhere must not be spent on "these are
 * different lines".
 */
const SERIES_COLORS = ["var(--accent-teal)", "var(--accent)", "var(--accent-warm)", "var(--accent-strong)"];

export default function DeviceGroupPanel({ group, primaryMapping, onClose }: Props) {
  const { entities } = useHA();
  const entityLabel = useEntityLabel();
  const ids = [group.primaryEntityId, ...group.memberEntityIds];

  const rows = ids.map((id) => {
    const entity = entities[id];
    const numeric = Number(entity?.state);
    return {
      id,
      label: entityLabel(id),
      unit: (entity?.attributes.unit_of_measurement as string | undefined) ?? "",
      value: entity?.state ?? "—",
      // ⚠️ THE FORMATTED READING IS A SEPARATE FIELD, NOT AN OVERWRITE OF
      // `unit`. The line chart below plots the RAW series and labels its axis
      // from `r.unit`; scaling the label to "kW" while the points stay in
      // watts would put a wrong axis on a right chart. `display` is for the
      // row's headline number only — the one that has to match the badge.
      display: entity ? formatSensorParts(entity) : { value: "", unit: "" },
      numeric: Number.isFinite(numeric) ? numeric : undefined,
      unavailable: isUnavailable(entity),
      kind: readingKind(entity, "sensor"),
    };
  });
  // A reading with a unit is a measurement even while it is UNAVAILABLE —
  // that is exactly when its chart's shaded outage has something to say
  // (config/sensorReading, the rule the sensor panel shares).
  const numericRows = rows.filter((r) => r.kind === "measurement" && (r.numeric !== undefined || r.unit !== ""));
  return (
    <BasePanel
      title={group.label ?? primaryMapping.label}
      entityId={primaryMapping.entityId}
      icon={<Layers size={22} />}
      history={false}
      deviceReadings={false}
      onClose={onClose}
    >
      {/* EVERY member offline → the same shared notice every other panel shows
          (UnavailableNotice), instead of this panel's own "Unavailable" text —
          one presentation of "HA lost contact" across the whole app. */}
      {rows.length > 0 && rows.every((r) => r.unavailable) ? (
        <UnavailableNotice device="device" />
      ) : (
        <div className="row-buttons" style={{ marginBottom: 18 }}>
          {rows.map((r) => (
            <div key={r.id} className="center" style={{ flex: 1, minWidth: 90 }}>
              <div className="value-large" style={{ fontSize: "var(--text-2xl)" }}>
                {/* A SINGLE offline member inside an otherwise-live group can't
                    take over the whole panel, so it shows the shared pill
                    inline — same wording/styling, just scoped to that reading.
                    Unit stays on the SAME line as the value (73%, not 73 over
                    a second line with % on its own) — the value and its unit
                    were previously two stacked block divs; now one line, unit
                    a bit smaller, matching how SensorPanel already does it. */}
                {r.unavailable
                  ? <span className="status-pill unavailable">UNAVAILABLE</span>
                  : <>{r.display.value || r.value}{r.display.unit && <span className="value-unit" style={{ fontSize: "var(--text-md)", marginLeft: 3 }}>{r.display.unit}</span>}</>}
              </div>
              <div className="muted body-text">{r.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* One range for the whole group — a temp+humidity pair plotted over two
          different windows would invite exactly the wrong comparison. */}
      <NumericHistory named series={numericRows.map((r, i) => ({
        id: r.id, label: r.label, unit: r.unit, color: SERIES_COLORS[i % SERIES_COLORS.length] }))} />
    </BasePanel>
  );
}
