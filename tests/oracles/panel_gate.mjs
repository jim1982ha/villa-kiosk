// One gate for every way a device panel opens (auth/permissions.panelMapping,
// round 10, 2.496.159). The 3D tap and long-press each repeated the lookup and
// the permission check — the long-press against a stale entity snapshot (its
// hook did not depend on `entities`) — and a summary tile's opener checked
// nothing, relying on the tile.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { panelMapping } = await import("@/auth/permissions");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const map = {
  "light.a": { entityId: "light.a", type: "light", label: "A" },
  "sensor.power": { entityId: "sensor.power", type: "sensor", label: "Power", category: "energy", categoryPicked: true },
  "input_boolean.x": { entityId: "input_boolean.x", type: "sensor", label: "X" },
};
const power = { attributes: { device_class: "power" } };
ck("a guest may open a light's panel", panelMapping("light.a", map, "guest", undefined, { control: true })?.entityId === "light.a");
ck("a guest may NOT open an energy device's panel, from the model or from a tile",
   panelMapping("sensor.power", map, "guest", power, { control: true }) === null && panelMapping("sensor.power", map, "guest", power, { control: false }) === null);
ck("the owner may", panelMapping("sensor.power", map, "owner", power, { control: true }) !== null);
ck("nobody signed in, or a device of a type the kiosk does not know: no panel", panelMapping("light.a", map, null, undefined, { control: false }) === null && panelMapping("vacuum.zzz", map, "owner", undefined, { control: true }) === null);
ck("a mapping stored as 'sensor' before its domain was known opens as its real type", panelMapping("input_boolean.x", map, "owner", undefined, { control: true })?.type === "input_boolean");

const perms = readFileSync(new URL("../../src/auth/permissions.ts", import.meta.url), "utf8");
ck("from the model, control is required too (a tap may toggle)", /if \(opts\.control && !hasCapability\(role, "controlEntities"\)\) return null;/.test(perms));
const d = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
ck("tap and long-press ask the gate with control; a tile asks it without",
   (d.match(/panelMapping\(entityId, config\.entityMap, role, entities\[entityId\], \{ control: true \}\)/g) ?? []).length === 2
   && /panelMapping\(entityId, config\.entityMap, role, entities\[entityId\], \{ control: false \}\)/.test(d)
   && !/mappingForEntityId\(/.test(d));
const longPress = d.slice(d.indexOf("const onEntityLongPressed"), d.indexOf("// Announce motion"));
ck("the long-press re-judges with the CURRENT entity (its hook depends on `entities`)", /\[config\.entityMap, entities, role, spawnRipple\]/.test(longPress));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one gate for every way a panel opens");
