// tests/module_toggle_test.ts
// Run: npm run test:module-toggle   (node strips the types; no runner, no deps)
//
// ⚠️ THESE TWO CASES COULD NOT BE EXERCISED AT ANY PRICE BEFORE 2026-09-06.
// "absent means enabled" and "a save does not drop the operator's other
// settings" lived inside a 360-line React tab, reachable only by rendering it
// in a browser. Extracted, they are pure and this repo's existing bare-node
// harness runs them.

import { isModuleEnabled, setModuleEnabled } from "../../src/vesta/shared/reportsTypes.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

console.log("— absent means ON, which the backend gate also believes —");
check("a module nobody has configured is enabled",
  isModuleEnabled({ modules: {} }, "weather") === true);
check("a document with no modules key at all is enabled",
  isModuleEnabled({}, "weather") === true);
check("a null config does not throw and reads as enabled",
  isModuleEnabled(null, "weather") === true);
check("only an explicit false disables",
  isModuleEnabled({ modules: { weather: { enabled: false } } }, "weather") === false);
check("an explicit true is enabled",
  isModuleEnabled({ modules: { weather: { enabled: true } } }, "weather") === true);

console.log("\n— a toggle keeps every other setting —");
{
  const doc = {
    modules: { weather: { enabled: true }, power: { enabled: false } },
    notify_targets: ["a"], min_history_days: 7,
  };
  const next = setModuleEnabled(doc, "weather", false);
  check("the flipped module is flipped",
    next.modules?.weather?.enabled === false);
  check("the OTHER module is untouched",
    next.modules?.power?.enabled === false);
  // ⚠️ THE CASE THAT COSTS AN OPERATOR THEIR SETTINGS. A save that rebuilt the
  // document, rather than spreading it, silently dropped every sibling key.
  check("sibling keys survive the save",
    (next as typeof doc).notify_targets[0] === "a"
    && (next as typeof doc).min_history_days === 7);
  check("the input document is not mutated",
    doc.modules.weather.enabled === true);
  const added = setModuleEnabled({ modules: {} }, "new", false);
  check("a module absent from the document can still be turned off",
    added.modules?.new?.enabled === false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
