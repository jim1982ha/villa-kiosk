// src/components/panels/DeviceGroupPanel.tsx
// Combined view for a device group (config.deviceGroups) — several HA
// entities that are really one physical device (e.g. a temp+humidity combo
// sensor exposed as two entities). Opened instead of the primary entity's
// normal type-based panel (see PanelRouter): every member's current value,
// plus one dual-axis 24h graph when there are exactly two numeric series
// (the common case) or a stacked line chart per series otherwise.

import { Layers } from "lucide-react";
import BasePanel from "./BasePanel";
import NumericHistory from "./NumericHistory";
import ReadingPill from "./ReadingPill";
import UnavailableNotice from "./UnavailableNotice";
import { useHA } from "@/ha/HAStateStore";
import type { DeviceGroup } from "@/config/AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { historyOf, readingOf } from "@/config/reading";
import { binarySensorClassInfo } from "@/config/BinarySensorClasses";
import { domainOf } from "@/utils/entityDomain";
import { useConfig } from "@/config/ConfigContext";
import LastDayTimeline from "./LastDayTimeline";

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
  const { config } = useConfig();
  const entityLabel = useEntityLabel();
  const ids = [group.primaryEntityId, ...group.memberEntityIds];

  // Each member's reading is config/reading's — the SAME answer its own
  // sensor window gives: its words, its pill, its alarm and the owner's
  // thresholds. ⚠️ This window used to assemble it from the pieces itself and
  // never asked for the thresholds: a temperature over its limit was red alone
  // and plain here, a detector in alarm lost its capitals and warning icon.
  const rows = ids.map((id) => {
    const entity = entities[id];
    const numeric = Number(entity?.state);
    const reading = readingOf(id, entity, domainOf(id) === "binary_sensor" ? "binary_sensor" : "sensor", config.alertThresholds);
    return {
      id,
      label: entityLabel(id),
      // ⚠️ THE CHART'S UNIT IS THE RAW ONE: it plots the raw series and labels
      // its axis from this; the reading's own unit is scaled with its headline
      // number ("kW"), which must match the badge.
      unit: (entity?.attributes.unit_of_measurement as string | undefined) ?? "",
      numeric: Number.isFinite(numeric) ? numeric : undefined,
      reading,
    };
  });
  // A reading with a unit is a measurement even while it is UNAVAILABLE —
  // that is exactly when its chart's shaded outage has something to say
  // (config/sensorReading, the rule the sensor panel shares).
  const numericRows = rows.filter((r) => historyOf(r.reading) === "numbers" && (r.numeric !== undefined || r.unit !== ""));
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
      {rows.length > 0 && rows.every((r) => r.reading.unavailable) ? (
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
                {r.reading.pill
                  // A pill at pill size — inside the large-number style an
                  // alarm's capitals ("SMOKE DETECTED") broke awkwardly — kept
                  // inside its column: on a phone it wraps within the pill
                  // rather than running into its neighbour.
                  ? <ReadingPill r={r.reading} size={18}
                      icon={binarySensorClassInfo(entities[r.id]?.attributes.device_class).icon}
                      style={{ fontSize: "var(--text-lg)", maxWidth: "100%", justifyContent: "center" }} />
                  : <span style={{ color: r.reading.color }}>{r.reading.value}{r.reading.unit && <span className="value-unit" style={{ fontSize: "var(--text-md)", marginLeft: 3 }}>{r.reading.unit}</span>}</span>}
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
      {/* each on/off or words member's own state history, drawn as in its own
          window (config/reading's historyOf — a words member had none here) */}
      {rows.filter((r) => historyOf(r.reading) !== "numbers").map((r) => (
        <div key={`h-${r.id}`}>
          <div className="muted body-text" style={{ margin: "12px 0 4px" }}>{r.label}</div>
          {historyOf(r.reading) === "states"
            ? <LastDayTimeline entityId={r.id} colorFor={r.reading.stateColor ?? undefined} />
            : <LastDayTimeline entityId={r.id} legend />}
        </div>
      ))}
    </BasePanel>
  );
}
