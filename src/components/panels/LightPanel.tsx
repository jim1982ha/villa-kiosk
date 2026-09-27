// src/components/panels/LightPanel.tsx
import { Lightbulb } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { brightnessToPct } from "@/utils/colorUtils";
import { isUnavailable } from "@/utils/stateColors";
import { devicePower } from "@/utils/devicePower";
import { lightSupport } from "@/utils/panelRules";
import { useLiveDraft } from "@/hooks/useLiveDraft";

export default function LightPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = devicePower(entity, mapping.entityId).position === "on";
  const modes = (entity?.attributes.supported_color_modes ?? []) as string[];
  const { brightness: supportsBrightness, temperature: supportsTemp } = lightSupport(modes);
  // They FOLLOW the light until dragged (useLiveDraft) — they were set once
  // and never re-synced, so a drag started from a stale value.
  const brightness = useLiveDraft<number>(entity?.attributes.brightness as number | undefined, 255);
  const kelvin = useLiveDraft<number>(entity?.attributes.color_temp_kelvin as number | undefined, 4000);

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Lightbulb size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="light" /> : (
        <PowerToggle
          on={on} onClick={() => HAServices.power(ws, entity, mapping.entityId)}
          label={mapping.label} requireConfirm={mapping.requireConfirm}
        />
      )}

      {!unavailable && supportsBrightness && (
        <div className="field">
          <label className="entity-label">Brightness · {brightnessToPct(brightness.value)}%</label>
          <input
            type="range" min={1} max={255} value={brightness.value}
            onPointerDown={brightness.hold}
            onChange={(e) => brightness.set(Number(e.target.value))}
            onPointerUp={() => { brightness.release(); HAServices.setLightBrightness(ws, mapping.entityId, brightness.value); }}
          />
        </div>
      )}

      {!unavailable && supportsTemp && (
        <div className="field">
          <label className="entity-label">Colour temperature · {kelvin.value}K</label>
          <input
            type="range"
            min={entity?.attributes.min_color_temp_kelvin ?? 2700}
            max={entity?.attributes.max_color_temp_kelvin ?? 6500}
            value={kelvin.value}
            onPointerDown={kelvin.hold}
            onChange={(e) => kelvin.set(Number(e.target.value))}
            onPointerUp={() => { kelvin.release(); HAServices.setLightColorTemp(ws, mapping.entityId, kelvin.value); }}
          />
        </div>
      )}

    </BasePanel>
  );
}
