// ONE owner of a device's name (owner, 2026-10-28): every screen calls a device what VESTA calls it (EntityMap.labelOf:
// the owner's own label, else the villa's system's name, else a tidied id). The presence window, the Energy window,
// the Cockpit's updates and Settings' "Asleep between reports" list read the villa's system's raw name instead, and
// the device pickers showed it: a device renamed in VESTA kept its old name there. The pickers' search now matches
// BOTH names, so a renamed device is never unfindable. By value through each screen's pure module, then the whole
// tree audited for who still reads the villa's system's name, and why.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ck, done, tsFiles } from "../consistency/check.mjs";
const { labelOf, matchesName } = await import("@/config/EntityMap");
const { presenceWhy } = await import("@/config/presence");
const { updatesWaiting } = await import("@/config/updatesWaiting");
const { energyStatName, energySetup } = await import("@/config/energyModel");

const e = (id, state, attrs = {}) => ({ entity_id: id, state, attributes: attrs, last_changed: "2026-10-28T06:00:00Z" });
const S = "binary_sensor.example_empty";
const ents = Object.fromEntries([
  e(S, "off", { friendly_name: "Example empty", people: ["person.a"], sensors: ["binary_sensor.example_motion"] }),
  e("person.a", "home", { friendly_name: "Platform person" }),
  e("binary_sensor.example_motion", "on", { device_class: "motion", friendly_name: "Platform motion" }),
  e("input_number.example_empty_grace", "5", { friendly_name: "Example empty - grace", unit_of_measurement: "min" }),
  e("update.example_firmware", "on", { friendly_name: "Platform pump Firmware" }),
  e("update.example_titled", "on", { friendly_name: "Platform broker Update", title: "Broker" }),
  e("sensor.example_meter_energy", "1", { friendly_name: "Platform meter energy" }),
  e("light.example_unnamed", "on", { friendly_name: "Platform lamp" }),
].map((x) => [x.entity_id, x]));
const entityMap = {
  "person.a": { label: "Guest host" },
  "binary_sensor.example_motion": { label: "Hall motion" },
  "input_number.example_empty_grace": { label: "Away grace" },
  "update.example_firmware": { label: "Pool pump Firmware" },
  "update.example_titled": { label: "Broker box" },
  "sensor.example_meter_energy": { label: "Pool meter energy" },
};

console.log("  each screen's name is VESTA's:");
const why = presenceWhy(S, ents, () => "loading", entityMap);
ck("the presence window: the person and the latest movement by VESTA's name",
   why.people.map((p) => p.name).join() === "Guest host" && why.lastActivity?.name === "Hall motion", [why.people, why.lastActivity]);
ck("  ...a setting too, while its (i) still says where to find it in the villa's system, by that system's name",
   why.settings.map((s) => s.name).join() === "Away grace" && why.settings[0].explain === "In the villa's system: Example empty - grace."
   && why.lastActivity.full === "In the villa's system: Platform motion.", why.settings);
const updates = updatesWaiting(ents, new Set(), entityMap);
ck("the Cockpit's updates: VESTA's name without \"Firmware\"; a software's own title stays (it names the software)",
   JSON.stringify(updates) === JSON.stringify(["Broker", "Pool pump"]), updates);
ck("the Energy window: a statistic by VESTA's name, without \"energy\"",
   energyStatName("sensor.example_meter_energy", entityMap, ents) === "Pool meter", energyStatName("sensor.example_meter_energy", entityMap, ents));
{
  const prefs = { energy_sources: [], device_consumption: [{ stat_consumption: "sensor.example_meter_energy" },
    { stat_consumption: "sensor.example_other", name: "Named in Energy settings" }] };
  const names = energySetup(prefs, (id) => energyStatName(id, entityMap, ents)).devices.map((d) => d.name);
  ck("  ...through the setup the window builds (a name given in the Energy settings themselves still wins)",
     names.join() === "Pool meter,Named in Energy settings", names);
}
ck("labelOf, the one rule all of them read: VESTA's label, else the villa's system's name",
   labelOf("light.example_unnamed", entityMap, ents) === "Platform lamp" && labelOf("person.a", entityMap, ents) === "Guest host");

console.log("\n  the pickers find a device by either name (owner, 2026-10-28):");
const found = (q) => Object.keys(ents).filter((id) => matchesName(q, id, entityMap, ents)).sort().join();
ck("by VESTA's name", found("guest HOST") === "person.a", found("guest HOST"));
ck("  ...by the villa's system's name", found("platform person") === "person.a", found("platform person"));
ck("  ...by its id", found("example_meter") === "sensor.example_meter_energy", found("example_meter"));
ck("  ...and nothing else matches", found("no such name") === "", found("no such name"));
ck("  ...an empty search lists every entity", found("") === Object.keys(ents).sort().join());

console.log("\n  who still reads the villa's system's name, and why (the whole tree, comments aside):");
const SRC = new URL("../../src/", import.meta.url).pathname;
const readers = new Set();
for (const f of tsFiles(SRC)) {
  const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => { if (ts.isIdentifier(n) && n.text === "friendly_name") readers.add(f.slice(SRC.length)); ts.forEachChild(n, visit); };
  visit(sf);
}
// Each one feeds the shared rule (displayLabelFor) with the stored label, or names the villa's system itself.
const ALLOWED = {
  "config/EntityMap.ts": "the rule itself: labelOf, matchesName",
  "types/ha.types.ts": "the attribute's type",
  "agent/agentView.ts": "displayLabelFor with the stored label: the Agent's copy of every screen's name",
  "components/panels/openDevice.ts": "displayLabelFor with the window's mapping label",
  "config/summaryGroups.ts": "displayLabelFor with the stored label",
  "pages/Dashboard.tsx": "displayLabelFor with the stored label (the motion toast)",
  "components/settings/MappingFields.tsx": "the Label field's placeholder: the name it falls back to, and from where",
  "config/mappingEdits.ts": "the first label a new mapping is made with",
  "config/haScenes.ts": "a scene: read live, never in the entity map",
  "config/weatherStation.ts": "words to find the station by, never shown",
  "config/presence.ts": "the (i)'s \"In the villa's system: …\", that system's own name",
};
const extra = [...readers].filter((f) => !(f in ALLOWED)).sort(), gone = Object.keys(ALLOWED).filter((f) => !readers.has(f));
ck("every file reading the villa's system's name is one of these, each with its reason", extra.length === 0, extra);
ck("  ...and each of them still does (the list is the tree's, not a memory)", gone.length === 0, gone);
for (const f of ["components/settings/UnavailableByDesign.tsx", "components/settings/EntityPicker.tsx",
  "components/panels/CameraDeviceButtons.tsx", "components/panels/EnergyPanel.tsx", "config/updatesWaiting.ts"])
  ck(`  ...${f.split("/").pop()} reads none of it`, !readers.has(f));

{
  // the one search a picker runs (the tree, not the text): EntityPicker filters its list with matchesName
  const calls = new Set();
  const sf = ts.createSourceFile("p.tsx", readFileSync(`${SRC}components/settings/EntityPicker.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) calls.add(n.expression.text); ts.forEachChild(n, visit); };
  visit(sf);
  ck("  ...the entity picker searches with matchesName and names each row with labelOf", calls.has("matchesName") && calls.has("labelOf"), [...calls]);
}

done("✅ a device has one name, VESTA's, on every screen; the pickers find it by either name");
