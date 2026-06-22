// src/components/panels/FanPanel.tsx
import { Fan, Power } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { formatRuntime } from "@/utils/time";

export default function FanPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const presets = (entity?.attributes.preset_modes ?? []) as string[];
  const current = entity?.attributes.preset_mode;
  const runtime = entity ? formatRuntime(entity.last_changed) : "";

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Fan size={22} />} onClose={onClose}>
      <button className={`big-toggle ${on ? "on" : ""}`} onClick={() => HAServices.toggleFan(ws, mapping.entityId)}>
        <Power size={24} /> {on ? "On" : "Off"}
      </button>

      {presets.length > 0 && (
        <div className="field">
          <label className="entity-label">Speed</label>
          <div className="row-buttons scroll">
            {presets.map((p) => (
              <button
                key={p}
                className={`btn ${current === p ? "active" : "ghost"}`}
                onClick={() => HAServices.setFanPreset(ws, mapping.entityId, p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {on && <p className="muted body-text mt">Running for {runtime}</p>}
    </BasePanel>
  );
}
