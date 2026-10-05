// src/utils/panelRules.ts
// The per-device rules behind the control panels — a fan's speed levels, a
// cover's state words, a thermostat's step and range, what a light supports.
//
// ⚠️ THEY LIVED IN THE .tsx PANELS (round 11, 2.496.165), where no oracle can
// load them, and two were wrong there: a 0.1 °C thermostat step displayed
// "22.900000000000002" (target ± step, unrounded), and the thermostat always
// said "°C" whatever Home Assistant's unit system. Pure now:
// tests/oracles/panel_rules.mjs.

/** Labels for a fan with N discrete speeds (HA's percentage_step). */
const SPEED_LABELS: Record<number, string[]> = {
  1: ["On"],
  2: ["Low", "High"],
  3: ["Low", "Medium", "High"],
  4: ["Low", "Medium", "High", "Max"],
  5: ["Low", "Med-Low", "Medium", "Med-High", "High"],
  6: ["1", "2", "3", "4", "5", "6"],
};

/** A fan's discrete speeds from its percentage_step — a number OR a numeric
 *  string (Tuya/template fans stringify it; the type check once collapsed a
 *  5-speed fan to its presets). Empty when it reports no step. */
export function fanLevels(stepRaw: unknown): { value: number; label: string }[] {
  const step = typeof stepRaw === "number" ? stepRaw : Number(stepRaw);
  const n = Number.isFinite(step) && step > 0 ? Math.round(100 / step) : 0;
  return Array.from({ length: n }, (_, i) => {
    const value = Math.round(((i + 1) / n) * 100);
    return { value, label: SPEED_LABELS[n]?.[i] ?? `${value}%` };
  });
}

/** The level nearest a reported percentage (undefined: none reported). */
export function nearestLevel<L extends { value: number }>(levels: readonly L[], pct: unknown): L | undefined {
  if (typeof pct !== "number" || levels.length === 0) return undefined;
  return levels.reduce((a, b) => (Math.abs(b.value - pct) < Math.abs(a.value - pct) ? b : a));
}

/** A cover's state in words: "Open", "Partially open (40%)", "Closed", or
 *  HA's own word for anything else (opening, closing…). */
export function coverStateLabel(state: string | undefined, position: number | undefined): string {
  if (state === "open") return typeof position === "number" && position < 100 ? `Partially open (${position}%)` : "Open";
  if (state === "closed") return "Closed";
  return state ?? "Unknown";
}

/** A thermostat's adjustable range: the device's own, narrowed to the
 *  profile's climate band (a guest's), with HA's defaults when unreported. */
export function climateRange(
  attrs: { min_temp?: number; max_temp?: number } | undefined,
  band: { climateMin?: number; climateMax?: number } | null,
): { min: number; max: number } {
  return {
    min: Math.max(attrs?.min_temp ?? 16, band?.climateMin ?? -Infinity),
    max: Math.min(attrs?.max_temp ?? 30, band?.climateMax ?? Infinity),
  };
}

/** One step of a thermostat's target: clamped to its range and ROUNDED to
 *  the step's own precision (a 0.1 step showed 22.900000000000002). */
export function climateStep(target: number, dir: 1 | -1, step: number, range: { min: number; max: number }): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const next = Number((target + dir * step).toFixed(decimals));
  return Math.min(range.max, Math.max(range.min, next));
}

/** A temperature in Home Assistant's own unit ("24°C", "75°F"); a bare degree
 *  when the unit is unknown or empty — never an assumed Celsius; "--" for no
 *  value. ONE formatter: the AC tile had its own (villaSummary.fmtClimateTemp,
 *  gone 2.496.263) that disagreed only on an empty unit. */
export function fmtTemp(v: number | undefined | null, unit?: string): string {
  return v === undefined || v === null ? `--${unit || "°"}` : `${v}${unit || "°"}`;
}

/** What a light can be asked for, from its supported_color_modes. */
export function lightSupport(modes: readonly string[]): { brightness: boolean; temperature: boolean } {
  return {
    brightness: modes.some((m) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "xy"].includes(m)),
    temperature: modes.includes("color_temp"),
  };
}
