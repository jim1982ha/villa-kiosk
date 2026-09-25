// A state reads the same in the pill and in the history bar's tooltip.
//
// ⚠️ REPORTED 2026-09-25: a leak sensor's panel said "No leak" in its pill and
// "Off" when you hovered its own history bar. The pill had an inline copy of
// the device-class wording; the tooltip used the generic prettyState. Both now
// ask stateLabelFor. This checks the wording, and that every history bar of a
// real entity is handed it.
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { stateLabelFor } = await import("@/config/BinarySensorClasses");

let fail = 0;
const eq = (n, got, want) => { const ok = got === want; console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  →  ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`}`); if (!ok) fail++; };

console.log("  the wording:");
const leak = stateLabelFor("binary_sensor.leak_sensor", "moisture");
eq("a leak sensor that is off reads \"No leak\"", leak("off"), "No leak");
eq("  ...and on, \"Leak detected\"", leak("on"), "Leak detected");
eq("  ...and unavailable, \"Unavailable\" — never \"No leak\"", leak("unavailable"), "Unavailable");
eq("a motion sensor's on is its own word, not \"On\"", stateLabelFor("binary_sensor.motion_sensor", "motion")("on") !== "On", true);
eq("a lock keeps its readable state", stateLabelFor("lock.front", undefined)("unlocked"), "Unlocked");
eq("a light keeps its readable state", stateLabelFor("light.hall", undefined)("on"), "On");

console.log("\n  the bars:");
const DIR = new URL("../../src/components/panels/", import.meta.url);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const timeline = strip(readFileSync(new URL("StateTimeline.tsx", DIR), "utf8"));
const body = timeline.slice(timeline.indexOf("export default function StateTimeline("));
eq("the tooltip words states with labelFor, not prettyState", /\{labelFor\(/.test(body) && !/\{prettyState\(/.test(body), true);
const sites = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".tsx") && n !== "StateTimeline.tsx" && n !== "CameraPanel.tsx")) {
  for (const m of strip(readFileSync(new URL(f, DIR), "utf8")).matchAll(/<StateTimeline\b[\s\S]*?\/>/g)) sites.push({ f, ok: /labelFor=\{/.test(m[0]) });
}
eq(`every entity history bar was found (${sites.length})`, sites.length >= 4, true);
const missing = sites.filter((s) => !s.ok).map((s) => s.f);
eq("  ...and each is handed the entity's wording", missing.join(), "");

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a state reads the same wherever it is shown");
process.exit(fail ? 1 : 0);
