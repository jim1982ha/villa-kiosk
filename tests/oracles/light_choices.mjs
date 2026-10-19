// A light's colours and effects sit beside a compact On button (owner, 2026-10-19: an LED strip's window was a huge
// On button, its brightness and its history — the strip's colours and effects were nowhere).
//
// Three lights, by value through the rule (panelRules.lightChoices) and DRAWN through the power section the light's
// window uses (PowerToggle.PowerSection with LightChoices beside it, as ControlFrame draws it): a dimmable-only light
// keeps today's big button; a colour light with effects gets the compact button, the swatches and the effect picker;
// a white-only light gets its temperature slider there. Then what each choice SENDS, by value.
import { h, draw, inside, text } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const R = await import("@/utils/panelRules");
const { PowerSection } = await import("@/components/panels/PowerToggle");
const { default: LightChoices, LIGHT_PRESETS, currentHs, presetIsCurrent } = await import("@/components/panels/LightChoices");
const { hexToHs, rgbToHex, hsToRgb } = await import("@/utils/colorUtils");

// The app's Dropdown places its list in a layout effect; drawn on a server, React says so once per draw. Only that.
const error = console.error;
console.error = (m, ...rest) => { if (!String(m).includes("useLayoutEffect does nothing on the server")) error(m, ...rest); };

const TEMP = h("div", { className: "field" }, h("input", { type: "range", className: "temp-slider" }));
// The light window's power section, as ControlFrame + LightPanel compose it.
const section = (attrs) => {
  const choices = R.lightChoices(attrs);
  return draw(h(PowerSection, {
    on: true, onClick: () => {},
    beside: choices.any && h(LightChoices, { choices, attrs, temperature: TEMP, onColour: () => {}, onEffect: () => {} }),
  }));
};

// (a) dimmable only
const dim = { supported_color_modes: ["brightness"], brightness: 200 };
ck("a dimmable-only light offers nothing beside its button", JSON.stringify(R.lightChoices(dim)) === '{"colour":null,"temperatureInRow":false,"effects":[],"any":false}', R.lightChoices(dim));
const a = section(dim);
ck("  ...and keeps today's big On button, alone", /^<button class="big-toggle on"/.test(a) && !a.includes("power-row") && !a.includes("compact"), a);

// (b) an hs light with effects
const strip = { supported_color_modes: ["hs", "color_temp"], hs_color: [225, 100], effect_list: ["Rainbow", "Fireworks"], effect: "Rainbow" };
const bc = R.lightChoices(strip);
ck("an hs light with effects: a colour in hs_color, its effects, no temperature in the row", bc.colour === "hs_color" && bc.effects.join() === "Rainbow,Fireworks" && !bc.temperatureInRow && bc.any, bc);
const b = section(strip);
ck("  ...ONE row: the compact On button first", inside(b, "power-row").startsWith('<div class="power-row"><button class="big-toggle compact on"'), b);
ck("  ...then the swatches, every preset and the light's own colour picker", (b.match(/class="light-swatch[ "]/g) ?? []).length === LIGHT_PRESETS.length + 1
   && /<input type="color" aria-label="Another colour"/.test(b), b);
ck("  ...the current colour (blue) is the one marked", /class="light-swatch on"[^>]*aria-label="Blue"/.test(b) && (b.match(/light-swatch on/g) ?? []).length === 1, text(b));
ck("  ...and the effect picker showing the running effect", /aria-label="Effect: Rainbow"/.test(b) && text(inside(b, "dropdown")).includes("Rainbow"), text(b));
ck("  ...no temperature slider in the row (it stays under the brightness)", !b.includes("temp-slider"));
const noFx = section({ ...strip, effect: null });
ck("  ...an effect that is not running reads \"Effect\", never the list's first as if it ran", /aria-label="Effect: Effect"/.test(noFx), text(noFx));

// (c) colour temperature only
const white = { supported_color_modes: ["color_temp"], color_temp_kelvin: 3000 };
const cc = R.lightChoices(white);
ck("a white-only light: its temperature in the row, no colour, no effects", cc.temperatureInRow && cc.colour === null && cc.effects.length === 0 && cc.any, cc);
const c = section(white);
ck("  ...drawn: the compact button and the temperature slider beside it, no swatches, no picker",
   c.includes('class="big-toggle compact on"') && inside(c, "light-choices").includes("temp-slider") && !c.includes("light-swatch") && !c.includes("dropdown"), c);

// What each choice sends — light.turn_on's data, by value.
ck("an hs light is sent hs_color", JSON.stringify(R.lightColourData(bc, 225, 100)) === '{"hs_color":[225,100]}', R.lightColourData(bc, 225, 100));
const rgbw = R.lightChoices({ supported_color_modes: ["rgbw"] });
ck("an rgbw light is sent rgb_color (red, full)", rgbw.colour === "rgb_color" && JSON.stringify(R.lightColourData(rgbw, 0, 100)) === '{"rgb_color":[255,0,0]}', R.lightColourData(rgbw, 0, 100));
ck("  ...an xy light too (blue at 225°)", JSON.stringify(R.lightColourData(R.lightChoices({ supported_color_modes: ["xy"] }), 225, 100)) === '{"rgb_color":[0,64,255]}', R.lightColourData(R.lightChoices({ supported_color_modes: ["xy"] }), 225, 100));
ck("  ...white is saturation 0", JSON.stringify(R.lightColourData(bc, 0, 0)) === '{"hs_color":[0,0]}');
ck("a light that takes no colour is sent nothing", R.lightColourData(R.lightChoices(white), 0, 100) === null);
ck("an effect from its list is sent by name", JSON.stringify(R.lightEffectData(bc, "Fireworks")) === '{"effect":"Fireworks"}');
ck("  ...a name not in its list is sent nothing (the picker's \"Effect\" line)", R.lightEffectData(bc, "") === null && R.lightEffectData(bc, "Strobe") === null);
ck("a temperature is sent in whole kelvin", JSON.stringify(R.lightTemperatureData(3333.4)) === '{"color_temp_kelvin":3333}');

// The device's own colour picker hands back "#rrggbb": that colour, as the light takes it.
ck("the picker's colour reads back as hue/saturation", JSON.stringify(hexToHs("#0040ff")) === '{"hue":225,"sat":100}' && hexToHs("#ffffff").sat === 0 && hexToHs("blue") === null, hexToHs("#0040ff"));
ck("  ...and the picker opens on the light's current colour", rgbToHex(hsToRgb(225, 100)) === "#0040ff");
ck("a light reporting only rgb_color: its colour is still known", JSON.stringify(currentHs({ rgb_color: [255, 0, 0] })) === '{"hue":0,"sat":100}');
ck("a preset is marked within a light's rounding, not beyond", presetIsCurrent({ hue: 0, sat: 100 }, { hue: 356, sat: 92 }) && !presetIsCurrent({ hue: 0, sat: 100 }, { hue: 30, sat: 100 })
   && presetIsCurrent({ hue: 0, sat: 0 }, { hue: 40, sat: 4 }) && !presetIsCurrent({ hue: 0, sat: 100 }, { hue: 0, sat: 4 }));

// The caller: the light's window sends every choice through these, and gives ControlFrame the row only when there is one.
const panel = readFileSync(new URL("../../src/components/panels/LightPanel.tsx", import.meta.url), "utf8");
ck("the light's window sends what the rule builds", /onColour=\{\(hue, sat\) => send\(lightColourData\(choices, hue, sat\)\)\}/.test(panel)
   && /onEffect=\{\(effect\) => send\(lightEffectData\(choices, effect\)\)\}/.test(panel)
   && /HAServices\.setLight\(ws, mapping\.entityId, lightTemperatureData\(v\)\)/.test(panel)
   && /beside=\{choices\.any && \(/.test(panel));

done("✅ a light's colours and effects sit beside a compact On button");
