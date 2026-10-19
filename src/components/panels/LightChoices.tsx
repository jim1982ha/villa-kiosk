// src/components/panels/LightChoices.tsx
// A light's colour and effect choices, beside its compact On button (ControlFrame's `beside`, PowerToggle.PowerSection).
//
// Owner, 2026-10-19: an LED strip's window showed a huge On button, its brightness and its history — the colours and
// the effects the strip has were nowhere. What a light offers is utils/panelRules.lightChoices (its
// supported_color_modes and effect_list), and every command is that module's data for `light.turn_on`.
//
// THE COLOUR CONTROL: a row of preset swatches (one tap, large enough for a finger) and a last swatch that is the
// light's CURRENT colour and opens the device's own colour picker (a colour input: built into the browser, nothing
// fetched, on an iPad and an iPhone alike). A colour wheel drawn here would be a canvas and a gesture handler to
// maintain for what the platform already gives. A white-only light (colour temperature, no colour) has its
// temperature slider here instead, passed in by the panel that owns it.

import type { ReactNode } from "react";
import { Palette } from "lucide-react";
import Dropdown from "@/components/common/Dropdown";
import { hexToHs, hsToRgb, rgbToHex } from "@/utils/colorUtils";
import type { LightChoices as Choices } from "@/utils/panelRules";

/** The preset colours, as hue/saturation — saturation 0 is white. Generic, the same for every light. */
export const LIGHT_PRESETS: readonly { name: string; hue: number; sat: number }[] = [
  { name: "White", hue: 0, sat: 0 },
  { name: "Red", hue: 0, sat: 100 },
  { name: "Orange", hue: 30, sat: 100 },
  { name: "Yellow", hue: 55, sat: 100 },
  { name: "Green", hue: 120, sat: 100 },
  { name: "Cyan", hue: 180, sat: 100 },
  { name: "Blue", hue: 225, sat: 100 },
  { name: "Purple", hue: 275, sat: 100 },
  { name: "Pink", hue: 320, sat: 100 },
];

/** The light's current colour as hue/saturation, from what it reports (hs_color, else rgb_color); null when it
 *  reports none (off, or in a white mode). */
export function currentHs(attrs: Record<string, unknown> | undefined): { hue: number; sat: number } | null {
  const hs = attrs?.hs_color;
  if (Array.isArray(hs) && typeof hs[0] === "number" && typeof hs[1] === "number") return { hue: hs[0], sat: hs[1] };
  const rgb = attrs?.rgb_color;
  if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every((v) => typeof v === "number")) {
    return hexToHs(rgbToHex({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }));
  }
  return null;
}

/** Is the light showing this preset — near its hue and saturation (a light rounds what it is sent). */
export function presetIsCurrent(p: { hue: number; sat: number }, cur: { hue: number; sat: number } | null): boolean {
  if (!cur) return false;
  if (p.sat === 0 || cur.sat <= 10) return p.sat === 0 && cur.sat <= 10;
  const dh = Math.abs(((cur.hue - p.hue + 540) % 360) - 180);
  return dh <= 10 && Math.abs(cur.sat - p.sat) <= 15;
}

const css = (hue: number, sat: number) => {
  const c = hsToRgb(hue, sat);
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
};

interface Props {
  choices: Choices;
  /** The light's attributes (its current colour and effect). */
  attrs: Record<string, unknown> | undefined;
  /** The temperature slider, for a white-only light (choices.temperatureInRow). */
  temperature?: ReactNode;
  onColour: (hue: number, sat: number) => void;
  onEffect: (effect: string) => void;
  disabled?: boolean;
}

export default function LightChoices({ choices, attrs, temperature, onColour, onEffect, disabled }: Props) {
  const cur = currentHs(attrs);
  const effect = typeof attrs?.effect === "string" ? attrs.effect : "";
  const effectOptions = [
    // A light whose effect is none of its list (or none at all) shows the word, never the list's first effect as if
    // it were running.
    ...(choices.effects.includes(effect) ? [] : [{ value: "", label: "Effect" }]),
    ...choices.effects.map((e) => ({ value: e, label: e })),
  ];
  return (
    <div className="light-choices">
      {choices.colour && (
        <div className="light-swatches" role="group" aria-label="Colour">
          {LIGHT_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className={`light-swatch${presetIsCurrent(p, cur) ? " on" : ""}`}
              style={{ background: css(p.hue, p.sat) }}
              title={p.name}
              aria-label={p.name}
              aria-pressed={presetIsCurrent(p, cur)}
              disabled={disabled}
              onClick={() => onColour(p.hue, p.sat)}
            />
          ))}
          <label
            className="light-swatch light-swatch-custom"
            style={{ background: cur ? css(cur.hue, cur.sat) : undefined }}
            title="Another colour"
          >
            <Palette size={16} aria-hidden />
            <input
              type="color"
              aria-label="Another colour"
              value={cur ? rgbToHex(hsToRgb(cur.hue, cur.sat)) : "#ffffff"}
              disabled={disabled}
              onChange={(e) => { const hs = hexToHs(e.target.value); if (hs) onColour(hs.hue, hs.sat); }}
            />
          </label>
        </div>
      )}
      {choices.temperatureInRow && temperature}
      {choices.effects.length > 0 && (
        <Dropdown
          className="light-effect"
          ariaLabel="Effect"
          value={choices.effects.includes(effect) ? effect : ""}
          options={effectOptions}
          disabled={disabled}
          onChange={(v) => { if (v) onEffect(v); }}
        />
      )}
    </div>
  );
}
