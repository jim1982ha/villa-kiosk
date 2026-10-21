// src/utils/panelRules.ts
// The per-device rules behind the control panels — a fan's speed levels, a
// cover's state words, a thermostat's step and range, what a light supports.
//
// ⚠️ THEY LIVED IN THE .tsx PANELS (round 11, 2.496.165), where no oracle can
// load them, and two were wrong there: a 0.1 °C thermostat step displayed
// "22.900000000000002" (target ± step, unrounded), and the thermostat always
// said "°C" whatever Home Assistant's unit system. Pure now:
// tests/oracles/panel_rules.mjs.

import { hsToRgb } from "./colorUtils";

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
    brightness: modes.some((m) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy", "white"].includes(m)),
    temperature: modes.includes("color_temp"),
  };
}

/** The colour modes a light takes a colour in (the villa's system's supported_color_modes). */
const COLOUR_MODES = ["hs", "rgb", "rgbw", "rgbww", "xy"];

/** The choices a light's window offers beside its On button (owner, 2026-10-19: an LED strip's colours and effects
 *  sat nowhere). `colour`: the field a colour is sent in — `hs_color` for a light that takes hue/saturation, else
 *  `rgb_color` (an rgb/rgbw/rgbww/xy light; the villa's system converts it to the light's own mode); null for a light
 *  that takes no colour. `temperatureInRow`: a white-only light (color_temp and no colour) has its temperature slider
 *  there instead. `effects`: its effect_list. `any`: whether there is a row at all — a light with none of these keeps
 *  the big On button. */
export interface LightChoices {
  colour: "hs_color" | "rgb_color" | null;
  temperatureInRow: boolean;
  effects: string[];
  any: boolean;
}

export function lightChoices(attrs: Record<string, unknown> | undefined): LightChoices {
  const modes = Array.isArray(attrs?.supported_color_modes) ? (attrs.supported_color_modes as unknown[]).map(String) : [];
  const colour = modes.includes("hs") ? "hs_color" : modes.some((m) => COLOUR_MODES.includes(m)) ? "rgb_color" : null;
  const temperatureInRow = !colour && modes.includes("color_temp");
  const effects = Array.isArray(attrs?.effect_list)
    ? (attrs.effect_list as unknown[]).filter((e): e is string => typeof e === "string" && e !== "") : [];
  return { colour, temperatureInRow, effects, any: !!colour || temperatureInRow || effects.length > 0 };
}

/** The data of the `light.turn_on` that sets this colour (hue 0-360, saturation 0-100) on this light: in the field
 *  lightChoices chose; null for a light that takes no colour. */
export function lightColourData(choices: Pick<LightChoices, "colour">, hue: number, sat: number): Record<string, unknown> | null {
  const h = Math.round(((hue % 360) + 360) % 360), s = Math.round(Math.min(100, Math.max(0, sat)));
  if (choices.colour === "hs_color") return { hs_color: [h, s] };
  if (choices.colour === "rgb_color") {
    const c = hsToRgb(h, s);
    return { rgb_color: [c.r, c.g, c.b].map((v) => Math.round(v * 255)) };
  }
  return null;
}

/** The `light.turn_on` data that runs one of the light's effects; null for a name its effect_list does not hold. */
export function lightEffectData(choices: Pick<LightChoices, "effects">, effect: string): Record<string, unknown> | null {
  return choices.effects.includes(effect) ? { effect } : null;
}

/** The `light.turn_on` data for a colour temperature, in kelvin (whole). */
export function lightTemperatureData(kelvin: number): Record<string, unknown> {
  return { color_temp_kelvin: Math.round(kelvin) };
}

/** A light's SCENE CHOICE: a `select` of the light's own device that picks its scenes (owner, 2026-10-20: an LED
 *  strip's Effect list was only "off" and "Scene", its 38 scenes sat in a select of the same device nobody showed).
 *  Generic, never a villa's names: the select is on the light's device (the villa system's device registry,
 *  `entityDeviceIds`) and its id says it is the scene choice — `select.scene` or `select.<…>_scene`, the add-on's own
 *  rule (ha-commands.json `sceneSelect`: the one select every profile reads and may pick in; tests/oracles holds the
 *  two equal) — and has options. Its first such by id; null for a light with none. */
export function sceneSelectOf(
  lightId: string,
  entities: Readonly<Record<string, { state: string; attributes: Record<string, unknown> } | undefined>>,
  entityDeviceIds: Readonly<Record<string, string>>,
): string | null {
  const dev = entityDeviceIds[lightId];
  if (!dev) return null;
  const named = (id: string) => /^(?:.+_)?scene$/.test(id.slice(id.indexOf(".") + 1));
  const found = Object.keys(entityDeviceIds)
    .filter((id) => entityDeviceIds[id] === dev && id.startsWith("select.") && named(id)
      && sceneOptions(entities[id]?.attributes).length > 0)
    .sort();
  return found[0] ?? null;
}

/** The controls a camera's own DEVICE offers, shown as buttons on its video (owner, 2026-10-21: "when there is PTZ
 *  control and siren entity available for a camera … show them as clickable icons"): its move buttons — a `button`
 *  whose object id ends in `move_`/`pan_`/`tilt_` + up, down, left or right, as the camera integrations name them —
 *  and its siren (the first `siren` of the device). Found through the villa's device registry, never by a camera's
 *  name; null when its device has neither. */
export interface CameraControls {
  moves: Partial<Record<"up" | "down" | "left" | "right", string>>;
  siren: string | null;
}

export function cameraControlsOf(
  cameraId: string, entityDeviceIds: Readonly<Record<string, string>>,
): CameraControls | null {
  const dev = entityDeviceIds[cameraId];
  if (!dev) return null;
  const mine = Object.keys(entityDeviceIds).filter((id) => entityDeviceIds[id] === dev).sort();
  const moves: CameraControls["moves"] = {};
  for (const id of mine) {
    const m = id.startsWith("button.") ? /(?:^|_)(?:move|pan|tilt)_(up|down|left|right)$/.exec(id.slice(7)) : null;
    if (m && !moves[m[1] as keyof CameraControls["moves"]]) moves[m[1] as keyof CameraControls["moves"]] = id;
  }
  const siren = mine.find((id) => id.startsWith("siren.")) ?? null;
  return Object.keys(moves).length || siren ? { moves, siren } : null;
}

/** The cameras a camera's window steps through and its picker lists: ONE per camera device of the villa (owner,
 *  2026-10-21: "why do I see Tapo Storage Room HD Stream (Direct) … since the one configured in the villa is Tapo
 *  Storage Room HD Stream?" — every `camera.*` the villa's system had was listed, and a Tapo camera gives two streams
 *  of one device). Per device: the stream placed in the villa (the entity map), else the device's own entity when it is
 *  a camera, else the first; never one hidden or not a villa device (`devices`, VillaDevices) — unless placed on the
 *  map, which lists it whatever the villa's system says (its badge stands there). The open camera is
 *  always in it (stepping on from where it stands). Unsorted: the window sorts by name. */
export function cameraChoices(
  ids: readonly string[], current: string,
  devices: { has(id: string): boolean; deviceOf(id: string): string; isHidden(id: string): boolean },
  placed: (id: string) => boolean,
): string[] {
  const byDevice = new Map<string, string[]>();
  for (const id of [...ids].sort()) {
    if (!id.startsWith("camera.")) continue;
    const dev = devices.deviceOf(id);
    // ⚠️ A CAMERA PLACED ON THE MAP IS LISTED, HIDDEN OR NOT (owner, 2026-10-21: "why don't I see the Tapo Server Room
    // camera … while it's well defined in the Kiosk configuration"): its placed stream was hidden in the villa's
    // system, which made its whole device "no device" — gone from the list while its badge stood on the map.
    if (!placed(id) && (devices.isHidden(id) || !devices.has(dev))) continue;
    byDevice.set(dev, [...(byDevice.get(dev) ?? []), id]);
  }
  const out = [...byDevice].map(([dev, cams]) => cams.find(placed) ?? (cams.includes(dev) ? dev : cams[0]));
  return out.includes(current) || !ids.includes(current) ? out : [...out, current];
}

/** A scene select's options (its `options` attribute, names only). */
export function sceneOptions(attrs: Record<string, unknown> | undefined): string[] {
  return Array.isArray(attrs?.options) ? (attrs.options as unknown[]).filter((o): o is string => typeof o === "string" && o !== "") : [];
}

/** What picking one scene sends, in order: the select's option first; then, when the light's effect_list has an
 *  effect named "Scene" (any case: the light's own mode that runs the chosen scene), `light.turn_on` with it. A name
 *  the select does not offer sends nothing. */
export function scenePick(
  choices: Pick<LightChoices, "effects">, lightId: string, selectId: string, options: readonly string[], option: string,
): { domain: "select" | "light"; service: string; data: Record<string, unknown>; entityId: string }[] {
  if (!options.includes(option)) return [];
  const mode = choices.effects.find((e) => e.toLowerCase() === "scene");
  return [
    { domain: "select", service: "select_option", data: { option }, entityId: selectId },
    ...(mode ? [{ domain: "light" as const, service: "turn_on", data: { effect: mode }, entityId: lightId }] : []),
  ];
}
