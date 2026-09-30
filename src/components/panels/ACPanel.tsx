// src/components/panels/ACPanel.tsx
import { Snowflake, Minus, Plus } from "lucide-react";
import BasePanel from "./BasePanel";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { climateLimits } from "@/auth/permissions";
import { HAServices } from "@/ha/HAServiceCalls";
import ControlFrame from "./ControlFrame";
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
  const a = entity?.attributes;
  const step = a?.target_temp_step ?? 0.5;
  // RBAC bounded controls: a profile with a climate range (guests) gets the
  // device limits narrowed to it — the stepper simply can't leave the band.
  const limits = role ? climateLimits(role) : null;
  const range = climateRange(a, limits);
  const { min, max } = range;
  // The target FOLLOWS the device (useLiveDraft); a step is clamped and
  // rounded to the step's precision (panelRules.climateStep).
  const target = useLiveDraft<number>(a?.temperature as number | undefined, 24,
    (v) => HAServices.setTemperature(ws, mapping.entityId, v));
  // A press sends at once; a refused one puts the device's set-point back.
  const commit = (dir: 1 | -1) => target.commit(climateStep(target.value, dir, step, range));

  const hvacModes = (a?.hvac_modes ?? ["cool", "fan_only", "auto", "off"]) as string[];
  const fanModes = (a?.fan_modes ?? []) as string[];

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Snowflake size={22} />} onClose={onClose}>
      <ControlFrame entity={entity} mapping={mapping} device="AC">
      <div className="temp-display">
        <span className="value-unit">Current</span>
        <div className="big">{fmtTemp(a?.current_temperature, unit)}</div>
      </div>

      <div className="temp-stepper">
        <button onClick={() => commit(-1)} aria-label="Lower target temperature"><Minus size={26} /></button>
        <div className="target">{fmtTemp(target.value, unit)}</div>
        <button onClick={() => commit(1)} aria-label="Raise target temperature"><Plus size={26} /></button>
      </div>
      {limits && (
        <div className="muted" style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
          Adjustable between {fmtTemp(min, unit)} and {fmtTemp(max, unit)}
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
      </ControlFrame>
    </BasePanel>
  );
}
