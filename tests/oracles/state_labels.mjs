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
// the stretch no longer kept has its own words, every state of the device labelFor's (owner, 2026-10-20)
{
  // drawn: the band's legend words a state with labelFor, and the two stretches with nothing to show with their own
  const { h, draw, text } = await import("../consistency/screen.mjs");
  const StateTimeline = (await import("@/components/panels/StateTimeline")).default;
  const { NOT_KEPT, NO_RECORD } = await import("@/utils/stateColors");
  const H = 3_600_000, end = Date.UTC(2026, 9, 24, 12);
  const said = text(draw(h(StateTimeline, { data: [{ t: end - 24 * H, state: NOT_KEPT }, { t: end - 20 * H, state: NO_RECORD },
    { t: end - 10 * H, state: "off" }], hours: 24, end, grainMs: H, status: "ok", colorFor: () => "red", labelFor: leak })));
  eq("the band words states with labelFor, not prettyState; nothing kept and no record yet in their own words",
     said.includes("No leak") && !said.includes("Off") && said.includes("No longer kept") && said.includes("No record yet"), true);
}
const sites = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".tsx") && n !== "StateTimeline.tsx" && n !== "CameraPanel.tsx")) {
  for (const m of strip(readFileSync(new URL(f, DIR), "utf8")).matchAll(/<StateTimeline\b[\s\S]*?\/>/g)) sites.push({ f, ok: /labelFor=\{/.test(m[0]) });
}
// One site since 2.496.188: every panel that charts states goes through
// LastDayTimeline (history_section.mjs holds that rule).
eq(`every entity history bar was found (${sites.length})`, sites.length >= 1, true);
const missing = sites.filter((s) => !s.ok).map((s) => s.f);
eq("  ...and each is handed the entity's wording", missing.join(), "");

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a state reads the same wherever it is shown");
process.exit(fail ? 1 : 0);
