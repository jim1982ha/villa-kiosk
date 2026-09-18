// tests/oracles/one_reading_rule.mjs
//
// ⚠️ THE DEFECT THIS REPO HAS NOW PRODUCED THREE TIMES, IN ONE FILE.
//
// A module is extracted to be the one owner of a rule. The extraction copies
// rather than moves, or unifies half the rule and leaves the other half inline.
// The oracle pins the OWNER, which no screen calls, and stays green for the
// life of the defect.
//
//   2.496.30  compactValue      — EntityVisuals kept a byte-identical private
//                                 copy; the export had no production caller.
//   this rel. prettyState       — StateTimeline kept its own, already differing
//                                 on the empty string.
//   this rel. the numeric half  — SummaryGroupPanel imported prettyState and
//                                 nothing else, so its row printed the RAW
//                                 state and unit beside a badge that scaled:
//                                 "6.6 kW" and "6570.989 W", one row apart.
//   this rel. OFF_STATES        — SummaryGroupPanel's own copy, in a file that
//                                 already imported from entityState.
//
// So this oracle does not pin behaviour. It pins OWNERSHIP, across the whole
// tracked source tree, by reading it as text. Behaviour lives in
// entity_value.mjs, which the first of these made load-bearing.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { deviceRowText } from "../../src/utils/entityValue.ts";

let fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

// Tracked source only — a file the commit cannot see is a file the gate cannot
// judge, and staging is what makes a new copy visible here.
// ⚠️ cwd MATTERS. run-all.sh cd's into tests/oracles/, so `git ls-files src`
// run from here lists nothing and EVERY ownership assertion below passes
// against an empty set. It did exactly that on the first run of this file.
const ROOT = new URL("../../", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const src = new Map(files.map((f) => [f, readFileSync(ROOT + f, "utf8")]));
// A scan that found nothing is a scan that proves nothing — fail loudly rather
// than report a clean sweep of an empty tree.
if (src.size < 100) {
  console.log(`    FAIL  the scan reached the source tree  →  ${src.size} files`);
  process.exit(1);
}
console.log(`  scanned ${src.size} tracked source files\n`);

const owns = (owner, label, re) => {
  const others = [...src].filter(([f, s]) => f !== owner && re.test(s)).map(([f]) => f);
  eq(`${label} is declared only in ${owner.split("/").pop()}`,
     others.length ? others.join(", ") : "nobody else", "nobody else");
};

console.log("  one declaration per rule:");
owns("src/utils/entityValue.ts", "prettyState", /(?:function|const)\s+prettyState\b/);
owns("src/utils/entityValue.ts", "compactValue", /(?:function|const)\s+compactValue\b/);
owns("src/utils/entityValue.ts", "clampPill", /(?:function|const)\s+clampPill\b/);
owns("src/utils/entityValue.ts", "formatSensorValue", /(?:function|const)\s+formatSensorValue\b/);
owns("src/utils/entityState.ts", "the off-states set",
     /new Set\(\[\s*"off",\s*"unavailable",\s*"unknown",\s*""\s*\]\)/);
owns("src/config/EntityMap.ts", "the variant-suffix regex", /\/__\[a-z0-9\]\+\$\/i/);

console.log("\n  and nobody re-implements the rule inline:");
// ⚠️ NARROW ON PURPOSE. `replace(/_/g, " ")` alone is a PRIMITIVE, not this
// rule, and the broad form flagged three legitimate users on its first run:
// CameraController Title-Cases a mesh name, LockPanel UPPERCASES a button, and
// EntityMap's prettifyRaw/norm are slug→label and a comparison normaliser.
// What prettyState owns is the PAIR — underscores to spaces, then capitalise
// the first character and nothing else.
// ...and the capitalise must land on the WHOLE string. EntityMap's prettifyRaw
// splits into words and Title-Cases each one after deduping a repeated prefix —
// a slug→label rule, not a state rule — so a window containing .split( or .map(
// is somebody else's business.
const PAIR = /replace\(\/_\/g,\s*" "\)((?:(?!\.split\(|\.map\()[\s\S]){0,120}?)(?:charAt\(0\)|\[0\])\.toUpperCase\(\)/;
const handRolled = [...src].filter(([f, s]) =>
  f !== "src/utils/entityValue.ts" && PAIR.test(s)).map(([f]) => f);
eq("nobody re-implements prettyState inline",
   handRolled.length ? handRolled.join(", ") : "nobody", "nobody");

console.log("\n  the device row asks the owner, it does not spell a reading:");
const SGP = src.get("src/components/panels/SummaryGroupPanel.tsx") ?? "";
// ⚠️ CALL SITES, NOT THE IMPORT LINE — AND THIS FILE GOT IT WRONG FIRST.
// The pin here was `/import \{...deviceRowText...\}/`, which survives deleting
// every call: the import stays (a comment beside it names the function too),
// the row goes back to pasting a raw state, and this line stays green. Its own
// sibling entity_value.mjs had already learned to count — "the badge has call
// sites for it" — and the file documenting that lesson committed the defect one
// directory over, the same day.
const sgpCode = SGP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
eq("SummaryGroupPanel calls deviceRowText, not just imports it",
   (sgpCode.match(/(?<!\.)\bdeviceRowText\(/g) ?? []).length >= 1, true);
eq("...and it is the module's, not a local redeclaration",
   /(?:function|const)\s+deviceRowText\b/.test(sgpCode), false);
// An exact-literal absence pin is unmatchable after any whitespace edit, so
// this asks the question by SHAPE: a unit appended to a state, however spaced.
eq("...and no raw state is pasted beside a raw unit anywhere in the file",
   /\$\{\s*unit\s*\?/.test(sgpCode), false);

console.log("\n  what the row actually writes:");
const E = (state, unit, attrs = {}) => ({
  entity_id: "sensor.x", state: String(state),
  attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...attrs },
});
// The reading that started the whole extraction. The badge clamps and hides a
// nominal; a row has space, so it does neither — but it SCALES, which is the
// half that was missing.
eq("6570.989 W scales, like the badge",  deviceRowText(E(6570.989, "W"), "sensor"), "6.6 kW");
eq("a nominal is SHOWN (a row has room)", deviceRowText(E("connected", ""), "sensor"), "Connected");
eq("an enum is tidied",                   deviceRowText(E("not_home", ""), "device_tracker"), "Not home");
eq("unavailable is named, not blank",     deviceRowText(E("unavailable", "W"), "sensor"), "Unavailable");
eq("climate shows current → target",
   deviceRowText(E("heat", "", { current_temperature: 24.4, temperature: 22 }), "climate"), "24° → 22°");
eq("climate with no current shows the target alone",
   deviceRowText(E("heat", "", { temperature: 22 }), "climate"), "→ 22°");
eq("climate with neither reads --",       deviceRowText(E("heat", ""), "climate"), "--");
eq("a row does NOT clamp to 16 (the badge's rule alone)",
   deviceRowText(E("a_very_long_status_indeed_truly", ""), "sensor").length > 16, true);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ one reading rule, one owner"}`);
process.exit(fail ? 1 : 0);
