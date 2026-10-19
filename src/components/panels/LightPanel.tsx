// src/components/panels/LightPanel.tsx
import { Lightbulb } from "lucide-react";
import BasePanel from "./BasePanel";
import ControlFrame from "./ControlFrame";
import LightChoices from "./LightChoices";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { brightnessToPct } from "@/utils/colorUtils";
import { lightChoices, lightColourData, lightEffectData, lightSupport, lightTemperatureData } from "@/utils/panelRules";
import { useLiveDraft } from "@/hooks/useLiveDraft";

export default function LightPanel({ entity, mapping, onClose }: PanelProps) {
  const { ws } = useHA();
  const modes = (entity?.attributes.supported_color_modes ?? []) as string[];
  const { brightness: supportsBrightness, temperature: supportsTemp } = lightSupport(modes);
  // Its colours, a white-only light's temperature, its effects: beside a compact On button (2.496.428). A light
  // with none of them keeps the big button alone.
  const choices = lightChoices(entity?.attributes);
  const send = (data: Record<string, unknown> | null) => { if (data) void HAServices.setLight(ws, mapping.entityId, data); };
  // They FOLLOW the light until dragged (useLiveDraft) — they were set once
  // and never re-synced, so a drag started from a stale value.
  const brightness = useLiveDraft<number>(entity?.attributes.brightness as number | undefined, 255,
    (v) => HAServices.setLightBrightness(ws, mapping.entityId, v));
  const kelvin = useLiveDraft<number>(entity?.attributes.color_temp_kelvin as number | undefined, 4000,
    (v) => HAServices.setLight(ws, mapping.entityId, lightTemperatureData(v)));

  const temperature = supportsTemp && (
    <div className="field">
      <label className="entity-label">Colour temperature · {kelvin.value}K</label>
      <input
        type="range"
        min={entity?.attributes.min_color_temp_kelvin ?? 2700}
        max={entity?.attributes.max_color_temp_kelvin ?? 6500}
        {...kelvin.rangeProps}
      />
    </div>
  );

  return (
    <BasePanel title={mapping.label} entityId={mapping.entityId} icon={<Lightbulb size={22} />} onClose={onClose}>
      <ControlFrame entity={entity} mapping={mapping} device="light" power
        beside={choices.any && (
          <LightChoices
            choices={choices}
            attrs={entity?.attributes}
            temperature={temperature}
            onColour={(hue, sat) => send(lightColourData(choices, hue, sat))}
            onEffect={(effect) => send(lightEffectData(choices, effect))}
          />
        )}
      >
      {supportsBrightness && (
        <div className="field">
          <label className="entity-label">Brightness · {brightnessToPct(brightness.value)}%</label>
          <input
            type="range" min={1} max={255} {...brightness.rangeProps}
          />
        </div>
      )}

      {/* A light with a colour keeps its temperature here; a white-only one has it beside the On button. */}
      {!choices.temperatureInRow && temperature}
      </ControlFrame>

    </BasePanel>
  );
}
