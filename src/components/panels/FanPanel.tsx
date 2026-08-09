// src/components/panels/FanPanel.tsx
import { Fan } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable } from "@/utils/stateColors";

// Named labels for the common discrete-speed-count cases (matches how HA's
// own more-info dialog reads a fan with a small, fixed number of steps —
// see percentage_step). Anything else falls back to a plain "{pct}%" label.
const SPEED_LABELS: Record<number, string[]> = {
  1: ["On"],
  2: ["Low", "High"],
  3: ["Low", "Medium", "High"],
  4: ["Low", "Medium", "High", "Max"],
  5: ["Low", "Med-Low", "Medium", "Med-High", "High"],
  6: ["1", "2", "3", "4", "5", "6"],
};

export default function FanPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = entity?.state === "on";
  const presets = (entity?.attributes.preset_modes ?? []) as string[];
  const currentPreset = entity?.attributes.preset_mode;

  // Continuous speed, exposed as discrete steps (same idea as HA's own fan
  // more-info card) rather than a free-drag slider — a separate control from
  // preset_modes above; a fan entity can report either, neither or both.
  const pct = entity?.attributes.percentage;
  // percentage_step can arrive as a number OR a numeric string depending on the
  // integration (Tuya/template fans often stringify it); coerce so a 5-speed
  // fan reporting "20" doesn't fail the type check and collapse to the preset
  // list (which is what made a 5-speed fan show only 3 buttons).
  const stepRaw = entity?.attributes.percentage_step;
  const step = typeof stepRaw === "number" ? stepRaw : Number(stepRaw);
  const levelCount = Number.isFinite(step) && step > 0 ? Math.round(100 / step) : 0;
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
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Fan size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="fan" /> : (
        <PowerToggle
          on={on} onClick={() => HAServices.toggleFan(ws, mapping.entityId)}
          label={mapping.label} requireConfirm={mapping.requireConfirm}
        />
      )}

      {!unavailable && levels.length > 0 && (
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

      {!unavailable && presets.length > 0 && (
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

    </BasePanel>
  );
}
