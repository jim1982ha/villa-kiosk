// The control panels' per-device rules (src/utils/panelRules.ts, round 11,
// 2.496.165) — driven by value, and each panel pinned to them: a rule copied
// back into a .tsx would pass here and still be the one the screen runs.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const R = await import("@/utils/panelRules");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const band = { min: 16, max: 30 };

// Thermostat
ck("a 0.1 step from 22.8 is 22.9 — not 22.900000000000002", R.climateStep(22.8, 1, 0.1, band) === 22.9, R.climateStep(22.8, 1, 0.1, band));
ck("a 0.5 step: 21.5 → 21", R.climateStep(21.5, -1, 0.5, band) === 21, R.climateStep(21.5, -1, 0.5, band));
ck("a step is clamped to the range", R.climateStep(30, 1, 1, band) === 30 && R.climateStep(16, -1, 1, band) === 16);
const r = R.climateRange({ min_temp: 7, max_temp: 35 }, { climateMin: 20, climateMax: 26 });
ck("the range is the device's, narrowed to the profile's band", r.min === 20 && r.max === 26, r);
const d = R.climateRange(undefined, null);
ck("  ...HA's 16–30 when the device reports none", d.min === 16 && d.max === 30, d);
ck("a temperature in HA's unit — °F stays °F", R.fmtTemp(72, "°F") === "72°F" && R.fmtTemp(null, "°C") === "--°C", R.fmtTemp(72, "°F"));

// Fan
const five = R.fanLevels(20);
ck("a 20% step is five speeds, Low…High", five.length === 5 && five[0].label === "Low" && five[4].label === "High" && five[4].value === 100, five);
ck("  ...a STRINGIFIED step counts the same (Tuya/template fans)", R.fanLevels("20").length === 5);
ck("  ...no step, no levels", R.fanLevels(undefined).length === 0 && R.fanLevels(0).length === 0);
ck("  ...seven speeds fall back to percentages", R.fanLevels(100 / 7)[0].label === "14%", R.fanLevels(100 / 7)[0]);
ck("the nearest level to 55% of three is Medium (67 is nearer than 33)", R.nearestLevel(R.fanLevels(100 / 3), 55)?.label === "Medium");
ck("  ...none reported, none chosen", R.nearestLevel(five, undefined) === undefined);

// Cover
ck("a cover at 40% reads Partially open (40%)", R.coverStateLabel("open", 40) === "Partially open (40%)");
ck("  ...at 100% Open, without a position Open, closed Closed, moving is HA's word",
   R.coverStateLabel("open", 100) === "Open" && R.coverStateLabel("open", undefined) === "Open" && R.coverStateLabel("closed", 0) === "Closed" && R.coverStateLabel("opening", 20) === "opening");

// Light
ck("an rgb light takes brightness, not a colour temperature", JSON.stringify(R.lightSupport(["rgb"])) === '{"brightness":true,"temperature":false}');
ck("  ...onoff takes neither; color_temp both", !R.lightSupport(["onoff"]).brightness && R.lightSupport(["color_temp"]).temperature);

// The callers — each panel runs the shared rule, not its own copy.
const src = (f) => readFileSync(new URL(`../../src/components/panels/${f}`, import.meta.url), "utf8");
const ac = src("ACPanel.tsx"), fan = src("FanPanel.tsx"), light = src("LightPanel.tsx"), cover = src("CoverPanel.tsx");
ck("ACPanel steps through climateStep, reads HA's unit, writes no °C literal",
   /climateStep\(/.test(ac) && /unit_system\?\.temperature/.test(ac) && !/°C/.test(ac.replace(/\/\/.*$/gm, "")));
ck("FanPanel's levels come from fanLevels (no SPEED_LABELS of its own)", /fanLevels\(/.test(fan) && !/SPEED_LABELS/.test(fan));
ck("the light's sliders and the cover's follow the device (useLiveDraft, held while dragged)",
   (light.match(/useLiveDraft</g) ?? []).length === 2 && /\.hold\b/.test(light) && /useLiveDraft</.test(cover) && /position\.hold/.test(cover) && !/useState/.test(light));
for (const f of ["CoverPanel.tsx", "LockPanel.tsx", "GenericPanel.tsx", "ACPanel.tsx"])
  ck(`${f} shows the shared UnavailableNotice`, /<UnavailableNotice\b/.test(src(f)));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ panel rules hold");
process.exit(fail ? 1 : 0);
