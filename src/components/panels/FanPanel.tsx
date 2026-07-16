// src/components/panels/FanPanel.tsx
import { Fan } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { formatRuntime } from "@/utils/time";

// Named labels for the common discrete-speed-count cases (matches how HA's
// own more-info dialog reads a fan with a small, fixed number of steps —
// see percentage_step). Anything else falls back to a plain "{pct}%" label.
const SPEED_LABELS: Record<number, string[]> = {
  1: ["On"],
  2: ["Low", "High"],
  3: ["Low", "Medium", "High"],
  4: ["Low", "Medium", "High", "Max"],
};

export default function FanPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const presets = (entity?.attributes.preset_modes ?? []) as string[];
  const currentPreset = entity?.attributes.preset_mode;
  const runtime = entity ? formatRuntime(entity.last_changed) : "";

  // Continuous speed, exposed as discrete steps (same idea as HA's own fan
  // more-info card) rather than a free-drag slider — a separate control from
  // preset_modes above; a fan entity can report either, neither or both.
  const pct = entity?.attributes.percentage;
  const step = entity?.attributes.percentage_step as number | undefined;
  const levelCount = typeof step === "number" && step > 0 ? Math.round(100 / step) : 0;
  const levels = levelCount > 0
    ? Array.from({ length: levelCount }, (_, i) => {
      const value = Math.round(((i + 1) / levelCount) * 100);
      const label = SPEED_LABELS[levelCount]?.[i] ?? `${value}%`;
      return { value, label };
    })
    : [];
  const closestLevel = typeof pct === "number" && levels.length
    ? levels.reduce((a, b) => (Math.abs(b.value - pct) < Math.abs(a.value - pct) ? b : a))
    : undefined;

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Fan size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={() => HAServices.toggleFan(ws, mapping.entityId)} />

      {levels.length > 0 && (
        <div className="field">
          <label className="entity-label">Speed</label>
          <div className="row-buttons">
            {levels.map((l) => (
              <button
                key={l.value}
                className={`btn ${on && closestLevel?.value === l.value ? "active" : "ghost"}`}
                style={{ flex: 1 }}
                onClick={() => HAServices.setFanPercentage(ws, mapping.entityId, l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
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
