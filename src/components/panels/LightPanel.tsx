// src/components/panels/LightPanel.tsx
import { useState } from "react";
import { Lightbulb } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import LastDayTimeline from "./LastDayTimeline";
import UnavailableNotice from "./UnavailableNotice";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useStateHistory } from "@/hooks/useStateHistory";
import { brightnessToPct } from "@/utils/colorUtils";
import { onOffColor, isUnavailable } from "@/utils/stateColors";

export default function LightPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const unavailable = isUnavailable(entity);
  const on = entity?.state === "on";
  const modes = (entity?.attributes.supported_color_modes ?? []) as string[];
  const supportsBrightness = modes.some((m) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "xy"].includes(m));
  const supportsTemp = modes.includes("color_temp");

  const [brightness, setBrightness] = useState(entity?.attributes.brightness ?? 255);
  const [kelvin, setKelvin] = useState(entity?.attributes.color_temp_kelvin ?? 4000);
  const history = useStateHistory(mapping.entityId);

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Lightbulb size={22} />} onClose={onClose}>
      {unavailable ? <UnavailableNotice device="light" /> : (
        <PowerToggle on={on} onClick={() => HAServices.toggleLight(ws, mapping.entityId)} />
      )}

      {!unavailable && supportsBrightness && (
        <div className="field">
          <label className="entity-label">Brightness · {brightnessToPct(brightness)}%</label>
          <input
            type="range" min={1} max={255} value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            onPointerUp={() => HAServices.setLightBrightness(ws, mapping.entityId, brightness)}
          />
        </div>
      )}

      {!unavailable && supportsTemp && (
        <div className="field">
          <label className="entity-label">Colour temperature · {kelvin}K</label>
          <input
            type="range"
            min={entity?.attributes.min_color_temp_kelvin ?? 2700}
            max={entity?.attributes.max_color_temp_kelvin ?? 6500}
            value={kelvin}
            onChange={(e) => setKelvin(Number(e.target.value))}
            onPointerUp={() => HAServices.setLightColorTemp(ws, mapping.entityId, kelvin)}
          />
        </div>
      )}

      <LastDayTimeline data={history} colorFor={onOffColor} />
    </BasePanel>
  );
}
