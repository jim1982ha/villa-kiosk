// src/utils/colorUtils.ts
// Colour helpers (HS -> RGB for Hue-style lights), adapted from the 3Dash pattern.

import { clamp } from "./geometry";
export interface RGB {
  r: number; // 0-1
  g: number;
  b: number;
}

/** HA hs_color is [hue 0-360, saturation 0-100]. Returns RGB in 0-1. */
export function hsToRgb(hue: number, sat: number): RGB {
  const s = sat / 100;
  const h = ((hue % 360) + 360) % 360;
  const c = s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = 1 - c;
  return { r: r + m, g: g + m, b: b + m };
}

/** Approximate colour temperature (Kelvin) to RGB in 0-1. */
export function kelvinToRgb(kelvin: number): RGB {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  // NOT named `clamp`: that name belongs to utils/geometry's shared helper, and
  // this does something else — it clamps to a byte AND normalises to 0-1. A
  // local shadow with different semantics is how a reader comes to believe the
  // shared rule is being applied when it is not.
  const channel = (v: number) => clamp(v, 0, 255) / 255;
  return { r: channel(r), g: channel(g), b: channel(b) };
}

/** brightness 0-255 -> 0-100 % */
export const brightnessToPct = (b: number): number => Math.round((b / 255) * 100);

/** "#rrggbb" for an RGB in 0-1 — what a colour input holds. */
export function rgbToHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}

/** A "#rrggbb" as hue 0-360 / saturation 0-100 (the colour's value dropped: a light's brightness is its own slider);
 *  null for anything else. */
export function hexToHs(hex: string): { hue: number; sat: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const sat = max === 0 ? 0 : (d / max) * 100;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return { hue: Math.round((hue + 360) % 360), sat: Math.round(sat) };
}
