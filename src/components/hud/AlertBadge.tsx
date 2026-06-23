// src/components/hud/AlertBadge.tsx
// Counts abnormal entities (leaks, out-of-threshold sensors) and lists them.

import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { levelForValue } from "@/config/ThresholdConfig";

export interface Alert {
  entityId: string;
  label: string;
  detail: string;
}

export function useAlerts(): Alert[] {
  const { entities } = useHA();
  const { config } = useConfig();
  return useMemo(() => {
    const out: Alert[] = [];
    for (const [entityId, t] of Object.entries(config.alertThresholds)) {
      const e = entities[entityId];
      if (!e) continue;
      const mapping = config.entityMap[entityId];
      const label = mapping?.label ?? e.attributes.friendly_name ?? entityId;

      if (entityId.startsWith("binary_sensor.")) {
        if (e.state === (t.alertState ?? "on")) out.push({ entityId, label, detail: "Triggered" });
        continue;
      }
      const v = Number(e.state);
      if (Number.isFinite(v) && levelForValue(v, t) === "danger") {
        const unit = e.attributes.unit_of_measurement ?? "";
        out.push({ entityId, label, detail: `${v}${unit}` });
      }
    }
    return out;
  }, [entities, config]);
}

export default function AlertBadge() {
  const alerts = useAlerts();
  const [open, setOpen] = useState(false);

  if (alerts.length === 0) {
    return (
      <button className="alert-badge ok" onClick={() => setOpen(false)} title="All clear">
        <ShieldCheck size={18} /> <span className="alert-badge-text">All clear</span>
      </button>
    );
  }

  return (
    <>
      <button className="alert-badge" onClick={() => setOpen((o) => !o)} title={`${alerts.length} alert${alerts.length > 1 ? "s" : ""}`}>
        <AlertTriangle size={18} /> <span className="alert-badge-text">{alerts.length} alert{alerts.length > 1 ? "s" : ""}</span>
      </button>
      {open && (
        <div className="alert-list">
          {alerts.map((a) => (
            <div className="row spread" key={a.entityId}>
              <span>{a.label}</span>
              <span className="danger-text">{a.detail}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
