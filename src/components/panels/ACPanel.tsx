// src/components/panels/ACPanel.tsx
import { Snowflake, Minus, Plus } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { climateLimits } from "@/auth/permissions";
import { HAServices } from "@/ha/HAServiceCalls";
import { isUnavailable } from "@/utils/stateColors";
import UnavailableNotice from "./UnavailableNotice";
import { climateRange, climateStep, fmtTemp } from "@/utils/panelRules";
import { useLiveDraft } from "@/hooks/useLiveDraft";

const MODE_LABELS: Record<string, string> = {
  cool: "Cool", heat: "Heat", fan_only: "Fan", auto: "Auto", off: "Off",
  dry: "Dry", heat_cool: "Heat/Cool",
};

export default function ACPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws, haConfig } = useHA();
  // Home Assistant's own unit — the readings are in it (it said "°C" always).
  const unit = haConfig?.unit_system?.temperature;
  const { role } = useProfile();
  const unavailable = isUnavailable(entity);
  const a = entity?.attributes;
  const step = a?.target_temp_step ?? 0.5;
  // RBAC bounded controls: a profile with a climate range (guests) gets the
  // device limits narrowed to it — the stepper simply can't leave the band.
  const limits = role ? climateLimits(role) : null;
  const range = climateRange(a, limits);
  const { min, max } = range;
  // The target FOLLOWS the device (useLiveDraft); a step is clamped and
  // rounded to the step's precision (panelRules.climateStep).
  const target = useLiveDraft<number>(a?.temperature as number | undefined, 24);
  const commit = (dir: 1 | -1) => {
    const next = climateStep(target.value, dir, step, range);
    target.set(next);
    HAServices.setTemperature(ws, mapping.entityId, next);
  };

  const hvacModes = (a?.hvac_modes ?? ["cool", "fan_only", "auto", "off"]) as string[];
  const fanModes = (a?.fan_modes ?? []) as string[];

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Snowflake size={22} />} onClose={onClose}>
      {unavailable && <UnavailableNotice device="AC" />}

      <div className="temp-display">
        <span className="value-unit">Current</span>
        <div className="big">{fmtTemp(unavailable ? null : a?.current_temperature, unit)}</div>
      </div>

      <div className={`temp-stepper${unavailable ? " is-unavailable" : ""}`}>
        <button onClick={() => commit(-1)} aria-label="Lower target temperature" disabled={unavailable}><Minus size={26} /></button>
        <div className="target">{fmtTemp(unavailable ? null : target.value, unit)}</div>
        <button onClick={() => commit(1)} aria-label="Raise target temperature" disabled={unavailable}><Plus size={26} /></button>
      </div>
      {limits && !unavailable && (
        <div className="muted" style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
          Adjustable between {fmtTemp(min, unit)} and {fmtTemp(max, unit)}
        </div>
      )}

      {!unavailable && (
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
      )}

      {!unavailable && fanModes.length > 0 && (
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
