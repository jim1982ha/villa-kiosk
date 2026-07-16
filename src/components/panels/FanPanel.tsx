// src/components/panels/FanPanel.tsx
import { useEffect, useRef, useState } from "react";
import { Fan } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { formatRuntime } from "@/utils/time";

export default function FanPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const presets = (entity?.attributes.preset_modes ?? []) as string[];
  const currentPreset = entity?.attributes.preset_mode;
  const runtime = entity ? formatRuntime(entity.last_changed) : "";

  // Continuous speed (0-100%) — a separate control from preset_modes above; a
  // fan entity can report either, neither or both (see HA's fan domain docs).
  const pct = entity?.attributes.percentage;
  const hasPercentage = typeof pct === "number";
  const step = (entity?.attributes.percentage_step as number | undefined) || 1;
  const [percentage, setPercentageState] = useState<number>(hasPercentage ? pct! : 0);
  // Same "ignore live updates mid-drag" pattern as CoverPanel's position slider —
  // otherwise a state event arriving while dragging snaps the thumb back.
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current && typeof pct === "number") setPercentageState(pct);
  }, [pct]);

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Fan size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={() => HAServices.toggleFan(ws, mapping.entityId)} />

      {hasPercentage && (
        <div className="field">
          <label className="entity-label">Speed · {percentage}%</label>
          <input
            type="range" min={0} max={100} step={step} value={percentage}
            onPointerDown={() => { dragging.current = true; }}
            onChange={(e) => setPercentageState(Number(e.target.value))}
            onPointerUp={() => {
              dragging.current = false;
              HAServices.setFanPercentage(ws, mapping.entityId, percentage);
            }}
          />
        </div>
      )}

      {presets.length > 0 && (
        <div className="field">
          <label className="entity-label">Preset</label>
          <div className="row-buttons scroll">
            {presets.map((p) => (
              <button
                key={p}
                className={`btn ${currentPreset === p ? "active" : "ghost"}`}
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
