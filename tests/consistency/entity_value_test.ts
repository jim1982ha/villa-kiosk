// tests/entity_value_test.ts
// Run: npm run test:entity-value   (node strips the types; no runner, no deps)
//
// src/utils/entityValue.ts imports nothing at runtime but a .ts-suffixed
// sibling, which is the only reason this file can exist.
//
// ⚠️ THE CASE THIS FILE EXISTS FOR: the two surfaces disagreed. The rule for
// writing a reading lived at line 9268 of EntityVisuals.ts, a 9,858-line
// Babylon class that cannot be loaded without a GPU context, so every DOM
// panel answered the question its own way. The SAME 6570.989 W reading printed
// "6.6 kW" on the wall tablet and "6570.989 W" in the panel beside it.
// CONTEXT.md's opening rule is that the two surfaces must never describe the
// villa differently.

import {
  formatUnitValue, formatUnitParts, formatSensorValue, formatSensorParts,
  compactValue, clampPill, clampToLabelWidth, prettyState,
} from "../../src/utils/entityValue.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

const ent = (state: string, unit?: string, attrs: Record<string, unknown> = {}) =>
  ({ entity_id: "sensor.x", state, attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...attrs } }) as never;

console.log("— the reading that started this: one value, one spelling —");
eq("6570.989 W → 6.6 kW", formatUnitValue(6570.989, "W"), "6.6 kW");
eq("…and the badge agrees", formatSensorValue(ent("6570.989", "W")), "6.6 kW");
eq("…and so does the panel's value part", formatSensorParts(ent("6570.989", "W")).value, "6.6");
eq("…with the unit split off for its own span", formatSensorParts(ent("6570.989", "W")).unit, "kW");

console.log("— SI prefixes, not a per-site threshold —");
eq("999 W stays W", formatUnitValue(999, "W"), "999 W");
eq("1000 W becomes kW", formatUnitValue(1000, "W"), "1 kW");
eq("Wh scales too", formatUnitValue(2500, "Wh"), "2.5 kWh");
eq("VA scales too", formatUnitValue(1500, "VA"), "1.5 kVA");
eq("negative scales on magnitude", formatUnitValue(-1500, "W"), "-1.5 kW");

console.log("— units that hug their sign never split —");
eq("percent hugs", formatUnitValue(73.4, "%"), "73%");
eq("percent has no separate unit", formatUnitParts(73.4, "%").unit, "");
eq("degrees hug", formatUnitValue(25.05, "°C"), "25.1°C");
eq("degrees have no separate unit", formatUnitParts(25.05, "°C").unit, "");

console.log("— trailing zeros dropped —");
eq("25.0 → 25", formatUnitValue(25.0, "°C"), "25°C");
eq("6.60 → 6.6", formatUnitValue(6600, "W"), "6.6 kW");

console.log("— enum states —");
eq("not_home → Not home", prettyState("not_home"), "Not home");
eq("…through the sensor rule too", formatSensorValue(ent("not_home")), "Not home");
eq("nominal hidden when the caller asks", formatSensorValue(ent("connected"), { hideNominal: true }), "");
eq("nominal SHOWN when it does not", formatSensorValue(ent("connected")), "Connected");

console.log("— unavailable is nobody's reading —");
eq("unavailable → empty", formatSensorValue(ent("unavailable")), "");
eq("unknown → empty", formatSensorValue(ent("unknown")), "");

console.log("— the badge's own two preferences are FLAGS, not the rule —");
eq("badge hides a nominal status", compactValue("sensor", ent("connected")), "");
eq("badge clamps to 16 chars",
   compactValue("sensor", ent("a_very_long_status_indeed")).length, 16);
eq("clampPill leaves a short value alone", clampPill("6.6 kW"), "6.6 kW");
eq("clampPill ellipsises a long one", clampPill("0123456789abcdefg"), "0123456789abcde…");

console.log("— per-domain attributes —");
eq("light reports brightness as %", compactValue("light", ent("on", undefined, { brightness: 128 })), "50%");
eq("a light that is off reads nothing", compactValue("light", ent("off", undefined, { brightness: 128 })), "");
eq("fan reports percentage", compactValue("fan", ent("on", undefined, { percentage: 40 })), "40%");
eq("cover reports position even when closed",
   compactValue("cover", ent("closed", undefined, { current_position: 0 })), "0%");
eq("climate reports the CURRENT temperature, not the target",
   compactValue("climate", ent("heat", undefined, { current_temperature: 21.6, temperature: 24 })), "22°");
eq("a lock has no reading", compactValue("lock", ent("locked")), "");

console.log("— the width clamp the solver and the renderer must share —");
{
  const m = {
    labelMaxWidthPx: 180, pillValuePadPx: 20, pillValueCharPx: 8,
    cardPadLeftPx: 4, cardHeightPx: 28, cardValuePadPx: 6, cardValueCharPx: 8,
  };
  eq("a short value passes through", clampToLabelWidth("6.6 kW", m, false), "6.6 kW");
  check("a long value is cut to what the pill can draw",
        clampToLabelWidth("x".repeat(80), m, false).length === 20,
        `len ${clampToLabelWidth("x".repeat(80), m, false).length}`);
  check("the card form reserves less room for text than the pill",
        clampToLabelWidth("x".repeat(80), m, true).length
          < clampToLabelWidth("x".repeat(80), m, false).length);
  eq("a zero advance disables the clamp rather than dividing by zero",
     clampToLabelWidth("xxxx", { ...m, pillValueCharPx: 0 }, false), "xxxx");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
