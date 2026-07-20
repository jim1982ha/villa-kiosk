// src/components/panels/DeviceGroupPanel.tsx
// Combined view for a device group (config.deviceGroups) — several HA
// entities that are really one physical device (e.g. a temp+humidity combo
// sensor exposed as two entities). Opened instead of the primary entity's
// normal type-based panel (see PanelRouter): every member's current value,
// plus one dual-axis 24h graph when there are exactly two numeric series
// (the common case) or a stacked sparkline per series otherwise.

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import BasePanel from "./BasePanel";
import Sparkline from "./Sparkline";
import DualSparkline from "./DualSparkline";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { fetchHistory } from "@/ha/HAHistoryAPI";
import type { DeviceGroup } from "@/config/AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import type { HistoryPoint } from "@/types/ha.types";

interface Props {
  group: DeviceGroup;
  primaryMapping: EntityMapping;
  onClose: () => void;
}

const SERIES_COLORS = ["var(--status-on)", "var(--accent)", "var(--status-warning)", "var(--status-danger)"];

export default function DeviceGroupPanel({ group, primaryMapping, onClose }: Props) {
  const { entities } = useHA();
  const { config } = useConfig();
  const ids = [group.primaryEntityId, ...group.memberEntityIds];
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});

  const rows = ids.map((id) => {
    const entity = entities[id];
    const mapping = config.entityMap[id];
    const numeric = Number(entity?.state);
    return {
      id,
      label: mapping?.label ?? entity?.attributes.friendly_name ?? id,
      unit: (entity?.attributes.unit_of_measurement as string | undefined) ?? "",
      value: entity?.state ?? "—",
      numeric: Number.isFinite(numeric) ? numeric : undefined,
    };
  });
  const numericRows = rows.filter((r) => r.numeric !== undefined);
  const numericIds = numericRows.map((r) => r.id).join(",");

  useEffect(() => {
    // History is fetched token-less through the add-on's Supervisor proxy.
    if (!numericIds) return;
    let cancelled = false;
    Promise.all(
      numericIds.split(",").map((id) =>
        fetchHistory(id, 24).then((h) => [id, h] as const),
      ),
    )
      .then((entries) => { if (!cancelled) setHistory(Object.fromEntries(entries)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [numericIds]);

  return (
    <BasePanel
      title={group.label ?? primaryMapping.label}
      room={primaryMapping.room}
      icon={<Layers size={22} />}
      onClose={onClose}
    >
      <div className="row-buttons" style={{ marginBottom: 18 }}>
        {rows.map((r) => (
          <div key={r.id} className="center" style={{ flex: 1, minWidth: 90 }}>
            <div className="value-large" style={{ fontSize: 26 }}>{r.value}</div>
            <div className="muted body-text">{r.unit || r.label}</div>
          </div>
        ))}
      </div>

      {numericRows.length === 2 ? (
        <div className="field">
          <label className="entity-label">Last 24 hours</label>
          <DualSparkline
            a={{ data: history[numericRows[0].id] ?? [], color: SERIES_COLORS[0], unit: numericRows[0].unit, label: numericRows[0].label }}
            b={{ data: history[numericRows[1].id] ?? [], color: SERIES_COLORS[1], unit: numericRows[1].unit, label: numericRows[1].label }}
          />
          <div className="row" style={{ gap: 16, marginTop: 8, fontSize: 12 }}>
            <span className="muted">
              <span style={{ color: SERIES_COLORS[0] }}>●</span> {numericRows[0].label}
            </span>
            <span className="muted">
              <span style={{ color: SERIES_COLORS[1] }}>┄</span> {numericRows[1].label}
            </span>
          </div>
        </div>
      ) : (
        numericRows.map((r, i) => (
          <div className="field" key={r.id}>
            <label className="entity-label">{r.label} — last 24 hours</label>
            <Sparkline data={history[r.id] ?? []} color={SERIES_COLORS[i % SERIES_COLORS.length]} unit={r.unit} />
          </div>
        ))
      )}
    </BasePanel>
  );
}
