// src/components/panels/LightPanel.tsx
import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import BasePanel from "./BasePanel";
import PowerToggle from "./PowerToggle";
import StateTimeline from "./StateTimeline";
import type { PanelProps } from "@/types/panel.types";
import type { StateHistoryPoint } from "@/types/ha.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { brightnessToPct } from "@/utils/colorUtils";
import { onOffColor } from "@/utils/stateColors";

export default function LightPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const on = entity?.state === "on";
  const modes = (entity?.attributes.supported_color_modes ?? []) as string[];
  const supportsBrightness = modes.some((m) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "xy"].includes(m));
  const supportsTemp = modes.includes("color_temp");

  const [brightness, setBrightness] = useState(entity?.attributes.brightness ?? 255);
  const [kelvin, setKelvin] = useState(entity?.attributes.color_temp_kelvin ?? 4000);
  const [history, setHistory] = useState<StateHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStateHistory(mapping.entityId, 24).then((h) => !cancelled && setHistory(h)).catch(() => {});
    return () => { cancelled = true; };
  }, [mapping.entityId]);

  return (
    <BasePanel title={mapping.label} room={mapping.room} icon={<Lightbulb size={22} />} onClose={onClose}>
      <PowerToggle on={on} onClick={() => HAServices.toggleLight(ws, mapping.entityId)} />

      {supportsBrightness && (
        <div className="field">
          <label className="entity-label">Brightness · {brightnessToPct(brightness)}%</label>
          <input
            type="range" min={1} max={255} value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            onPointerUp={() => HAServices.setLightBrightness(ws, mapping.entityId, brightness)}
          />
        </div>
      )}

      {supportsTemp && (
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

      <div className="field">
        <label className="entity-label">Last 24 hours</label>
        <StateTimeline data={history} colorFor={onOffColor} />
      </div>
    </BasePanel>
  );
}
