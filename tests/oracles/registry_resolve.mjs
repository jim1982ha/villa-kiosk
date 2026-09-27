// What Home Assistant's registries say about each entity
// (src/ha/registryResolve.ts), and when the kiosk re-reads them
// (HAStateStore's one on-connected pass) — round 10, 2.496.160.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const R = await import("@/ha/registryResolve");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const rows = [
  { entity_id: "light.own_area", area_id: "a_up", device_id: "d1" },
  { entity_id: "light.from_device", area_id: null, device_id: "d1" },
  { entity_id: "sensor.hidden", hidden_by: "user", device_id: "d2" },
  { entity_id: "sensor.diag", entity_category: "diagnostic" },
  { entity_id: "switch.nowhere" },
];
const f = R.entityRegistryFacts(rows);
ck("hidden or config/diagnostic: kept out of auto-built lists; only the user-hidden one is 'hidden in HA'",
   [...f.suppressed].sort().join() === "sensor.diag,sensor.hidden" && [...f.hiddenInHa].join() === "sensor.hidden");
ck("device ids straight off the rows", f.deviceIds["light.from_device"] === "d1" && f.deviceIds["sensor.hidden"] === "d2" && !("switch.nowhere" in f.deviceIds));
const p = R.entityPlaces(rows, [{ id: "d1", area_id: "a_down" }], [
  { area_id: "a_up", name: "Bedroom", floor_id: "f2" }, { area_id: "a_down", name: "Living", floor_id: "f1" },
], [{ floor_id: "f1", name: "1F", level: null }, { floor_id: "f2", name: "2F", level: null }]);
ck("an entity's own area wins over its device's", p.areaNames["light.own_area"] === "Bedroom");
ck("  ...and with none of its own it inherits the device's", p.areaNames["light.from_device"] === "Living");
ck("the floor follows the same area (1F = 1, 2F = 2 — resolveEntityFloor reads the name)", p.floorNumbers["light.from_device"] === 1 && p.floorNumbers["light.own_area"] === 2);
ck("no area: left out, not guessed", !("switch.nowhere" in p.areaNames) && !("switch.nowhere" in p.floorNumbers));

const st = readFileSync(new URL("../../src/ha/HAStateStore.tsx", import.meta.url), "utf8");
const connectBody = st.slice(st.indexOf("const connect = useCallback"), st.indexOf("EVERY (RE)CONNECT, ONE PASS"));
const pass = st.slice(st.indexOf("EVERY (RE)CONNECT, ONE PASS"), st.indexOf("const subscribe = useCallback"));
ck("connect() opens and subscribes, and loads nothing itself (the first connect loaded the states twice)",
   !/hydrate\(|get_config/.test(connectBody.replace(/\/\/.*$/gm, "")));
ck("every (re)connect runs ONE pass — after the subscriptions — loading the states, the config AND the registry (a reconnect re-read only the states)",
   /if \(connection !== "connected"\) return;/.test(pass) && /await subscribedRef\.current;/.test(pass)
   && pass.indexOf("await subscribedRef.current") < pass.indexOf("hydrate()") && /"get_config"/.test(pass) && /refreshRegistryData\(\)/.test(pass));
ck("the provider resolves nothing itself", /entityRegistryFacts\(rows\)/.test(st) && /entityPlaces\(rows, devices, areas, floors\)/.test(st) && !/deviceAreaById/.test(st));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the registries, resolved once and re-read on every reconnect");
