// The device list Advanced Settings edits (config/deviceRecord.ts — architecture review
// 2026-10-12, candidate 1), by value: every stored device ONE row, hand-linked or not, found by the
// name the map shows. A device bound to an object used to leave this list for another tab, and the
// search filtered on stored labels nobody sees.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const D = await import("@/config/deviceRecord");

const map = {
  "light.hall": { entityId: "light.hall", type: "light" },
  "light.patio": { entityId: "light.patio", type: "light", label: "light patio" },
  "fan.gone": { entityId: "fan.gone", type: "fan" },
};
const bindings = { "light.terrace_old": "light.patio", pool_lamp_mesh: "light.patio" };
const rows = D.deviceRows(map, bindings, new Set(["fan.gone"]));
ck("every stored device is a row — a hand-linked one included", rows.map((r) => r.id).join() === "light.hall,light.patio");
ck("  ...a removed one is not", !rows.some((r) => r.id === "fan.gone"));
ck("a row says which objects are linked to it by name", rows[1].objects.join() === "light.terrace_old,pool_lamp_mesh" && rows[0].objects.length === 0);

const patio = rows[1];
// the villa's system's entities (placeholder names): the patio light named "Patio2F Center" there, stored "light patio"
const ents = {
  "light.hall": { entity_id: "light.hall", state: "on", attributes: { friendly_name: "Hall ceiling" } },
  "light.patio": { entity_id: "light.patio", state: "off", attributes: { friendly_name: "Patio2F Center" } },
  "switch.pump": { entity_id: "switch.pump", state: "on", attributes: { friendly_name: "Pump relay" } },
  "sensor.pump_temp": { entity_id: "sensor.pump_temp", state: "26", attributes: { friendly_name: "Water temperature" } },
};
const src = { entityMap: { ...map, "light.patio": { ...map["light.patio"], label: "Terrace lamp" } }, entities: ents,
  resolvedRooms: { "light.patio": "Patio 2F", "switch.pump": "Pool", "sensor.pump_temp": "Pool", "light.hall": "Hall" } };
ck("found by the name the map shows (labelOf), and the villa's system's own", D.rowMatches(patio, "Terrace", src)
   && D.rowMatches(patio, "Patio2F Center", src) && !D.rowMatches(patio, "no such lamp", src));
ck("  ...by its id, its room, a linked object; case-insensitive",
   ["LIGHT.PATIO", "patio 2f", "terrace_old"].every((q) => D.rowMatches(patio, q, src)));
ck("  ...an empty search finds everything", D.rowMatches(patio, "  ", src));

// ⚠️ ONE DEVICE SEARCH (architecture review 2026-10-31 round 12 #2): typing "pool" found a device by its room in one
// box only. Every box, by value: the shown name, the villa's system's name, the room, the id
console.log("\n  one device search, every box (\"pool\" is a room here, \"Patio2F Center\" the villa's system's name):");
const texts = D.deviceSearchTexts("light.patio", src);
ck("what a device is found by: its name on screen, the villa's system's name, its room and its id",
   ["Terrace lamp", "Patio2F Center", "Patio 2F", "light.patio"].every((t) => texts.includes(t)), texts);
const pumpRow = { id: "switch.pump", mapping: { entityId: "switch.pump", type: "switch" }, objects: [] };
ck("Settings › Devices: by room and by the villa's system's name",
   D.rowMatches(pumpRow, "pool", src) && D.rowMatches(pumpRow, "pump relay", src));
ck("\"Add a device…\" (EntityPicker): by room too, of its domains only",
   D.entitySearch("pool", src).join() === "sensor.pump_temp,switch.pump" && D.entitySearch("pool", src, ["switch"]).join() === "switch.pump"
   && D.entitySearch("patio2f center", src).join() === "light.patio", D.entitySearch("pool", src));
ck("the device groups: by any of its devices' rooms or names, the lead's and the members'",
   D.groupMatches({ primaryEntityId: "light.hall", memberEntityIds: ["sensor.pump_temp"] }, "pool", src)
   && D.groupMatches({ primaryEntityId: "sensor.pump_temp", memberEntityIds: [] }, "water temp", src)
   && !D.groupMatches({ primaryEntityId: "light.hall", memberEntityIds: [] }, "pool", src));
const { deviceSearchRows } = await import("@/components/fm/DeviceSearchPicker");
const opts = [{ entityId: "light.hall", label: "Hall ceiling" }, { entityId: "light.patio", label: "Terrace lamp" },
  { entityId: "sensor.pump_temp", label: "Pool water" }, { entityId: "switch.pump", label: "Pump relay" }];
const tf = (q) => deviceSearchRows(opts, q, src).map((o) => o.entityId).join();
ck("the ticket form: by room and by the villa's system's name, the names starting with it first",
   tf("pool") === "sensor.pump_temp,switch.pump" && tf("patio2f") === "light.patio" && tf("p") .startsWith("sensor.pump_temp,switch.pump"),
   [tf("pool"), tf("patio2f"), tf("p")]);
ck("  ...a search from the name into the room (\"relay pool\"), as its own search did", tf("relay pool") === "switch.pump", tf("relay pool"));
ck("  ...every device for an empty search (the shared picker opens on a tap)", tf("") === opts.map((o) => o.entityId).join());

// ...and each box runs it: read through the compiler's tree, and the shared picker drawn in its free-text mode
{
  const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const ts = (await import("typescript")).default;
  const calls = (rel) => { const out = new Set(); const v = (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text); ts.forEachChild(n, v); }; v(parseTsx(rel)); return out; };
  ck("  ...each box calls it: the device groups (groupMatches), the ticket form (deviceSearchRows)",
     calls("components/settings/GroupedDevices.tsx").has("groupMatches") && calls("components/fm/DeviceSearchPicker.tsx").has("deviceSearchRows"));
  const dsp = parseTsx("components/fm/DeviceSearchPicker.tsx");
  const shell = elements(dsp, "SearchPicker");
  ck("the ticket form's box is the shared picker, in its free-text mode, saying what a free text becomes",
     shell.length === 1 && propText(shell[0], "text") === "{ value, onChange: onChangeText }" && /saved as free text/.test(propText(shell[0], "none") ?? "")
     && elements(dsp, "input").length === 0 && !/MAX_RESULTS|picker-dropdown/.test(dsp.getText()), shell.map((x) => x.getText().slice(0, 120)));
  const { h, draw } = await import("../consistency/screen.mjs");
  const { default: SearchPicker, SEARCH_ROWS } = await import("@/components/common/SearchPicker");
  const typed = draw(h(SearchPicker, { text: { value: "Spare pool pump", onChange: () => {} }, rows: () => [], onPick: () => {}, placeholder: "Search" }));
  const plain = draw(h(SearchPicker, { rows: () => [], onPick: () => {}, placeholder: "Search" }));
  ck("  ...free text: the box holds what was typed as the value; a plain search box starts empty",
     /value="Spare pool pump"/.test(typed) && /value=""/.test(plain), [typed.match(/<input[^>]*>/)?.[0], plain.match(/<input[^>]*>/)?.[0]]);
  ck("  ...one result cap for every picker (the shell's), none of its own in a caller",
     SEARCH_ROWS === 60 && !/\.slice\(0, 60\)/.test(parseTsx("components/settings/EntityPicker.tsx").getText()));
}

const ed = readFileSync(new URL("../../src/components/settings/ConfigEditor.tsx", import.meta.url), "utf8");
ck("Advanced Settings lists the villa model's deviceRows and filters with rowMatches on the shown name (no own list rule)",
   /const \{ rows: allRows, stale: staleIds, orphans: orphanIds \} = villa\.settings;/.test(ed)
   && /deviceRows\(entityMap, config\.meshBindings, dismissedIds\)/.test(readFileSync(new URL("../../src/config/VillaModel.tsx", import.meta.url), "utf8"))
   && /rowMatches\(r, search, searchSource\)/.test(ed) && !/boundEntityIds/.test(ed));

done("✅ one device list: every device once, found by the name it shows");
