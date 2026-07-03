// src/components/panels/ACPanel.tsx
import { useState, useEffect } from "react";
import { Snowflake, Minus, Plus } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { climateLimits } from "@/auth/permissions";
import { HAServices } from "@/ha/HAServiceCalls";

const MODE_LABELS: Record<string, string> = {
  cool: "Cool", heat: "Heat", fan_only: "Fan", auto: "Auto", off: "Off",
  dry: "Dry", heat_cool: "Heat/Cool",
};

export default function ACPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const { role } = useProfile();
  const a = entity?.attributes;
  const step = a?.target_temp_step ?? 0.5;
  // RBAC bounded controls: a profile with a climate range (guests) gets the
  // device limits narrowed to it — the stepper simply can't leave the band.
  const limits = role ? climateLimits(role) : null;
  const min = Math.max(a?.min_temp ?? 16, limits?.climateMin ?? -Infinity);
  const max = Math.min(a?.max_temp ?? 30, limits?.climateMax ?? Infinity);

  const [target, setTarget] = useState<number>(a?.temperature ?? 24);
  useEffect(() => {
    if (a?.temperature !== undefined) setTarget(a.temperature);
  }, [a?.temperature]);

  const commit = (t: number) => {
    const clamped = Math.min(max, Math.max(min, t));
    setTarget(clamped);
    HAServices.setTemperature(ws, mapping.entityId, clamped);
  };

  const hvacModes = (a?.hvac_modes ?? ["cool", "fan_only", "auto", "off"]) as string[];
  const fanModes = (a?.fan_modes ?? []) as string[];

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Snowflake size={22} />} onClose={onClose}>
      <div className="temp-display">
        <span className="value-unit">Current</span>
        <div className="big">{a?.current_temperature ?? "--"}°C</div>
      </div>

      <div className="temp-stepper">
        <button onClick={() => commit(target - step)} aria-label="Lower target temperature"><Minus size={26} /></button>
        <div className="target">{target}°C</div>
        <button onClick={() => commit(target + step)} aria-label="Raise target temperature"><Plus size={26} /></button>
      </div>
      {limits && (
        <div className="muted" style={{ textAlign: "center", fontSize: 13 }}>
          Adjustable between {min}–{max} °C
        </div>
      )}

      <div className="field">
        <label className="entity-label">Mode</label>
        <div className="row-buttons scroll">
          {hvacModes.map((m) => (
            <button
              key={m}
              className={`btn ${entity?.state === m ? "active" : "ghost"}`}
              onClick={() => HAServices.setHvacMode(ws, mapping.entityId, m)}
            >
              {MODE_LABELS[m] ?? m}
            </button>
          ))}
        </div>
      </div>

      {fanModes.length > 0 && (
        <div className="field">
          <label className="entity-label">Fan speed</label>
          <div className="row-buttons scroll">
            {fanModes.map((f) => (
              <button
                key={f}
                className={`btn ${a?.fan_mode === f ? "active" : "ghost"}`}
                onClick={() => HAServices.setFanMode(ws, mapping.entityId, f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </BasePanel>
  );
}
