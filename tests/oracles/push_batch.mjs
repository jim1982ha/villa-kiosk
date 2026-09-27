// Live state events reach React once per window (utils/pushBatch), and the
// per-push work behind the summary bar scans the store ONCE (2.496.197).
//
// Before: one object spread and one full React fan-out per state_changed
// event; villaSummary scanned every entity four times per call; SummaryBar
// searched for the weather station twice per render; the villa model
// re-derived device folding (a function of config only) twice per push.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { PushBatch } = await import("@/utils/pushBatch");
const { villaSummary, domainIndex } = await import("@/config/villaSummary");
const { villaDevices, deviceFolding } = await import("@/config/deviceGroups");


console.log("  the batch:");
{
  const timers = []; let drained = [];
  const b = new PushBatch(250, (m) => drained.push([...m.values()]), (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, (t) => { timers[t - 1].cancelled = true; });
  b.push({ entity_id: "light.a", state: "on" });
  b.push({ entity_id: "light.b", state: "on" });
  b.push({ entity_id: "light.a", state: "off" });
  ck("three events arm ONE drain, for the window", timers.length === 1 && timers[0].ms === 250 && drained.length === 0);
  ck("the snapshot between drains shows the newest pending state over the base",
     b.overlay({ "light.a": { entity_id: "light.a", state: "on" }, "switch.c": { entity_id: "switch.c", state: "on" } })["light.a"].state === "off"
     && b.overlay({}).hasOwnProperty("switch.c") === false);
  timers[0].fn();
  ck("the drain carries the newest state per entity, once", drained.length === 1 && drained[0].length === 2 && drained[0].find((e) => e.entity_id === "light.a").state === "off");
  ck("  ...and nothing is pending after it (the base is returned as is)", b.size === 0 && b.overlay({ x: 1 }).x === 1);
  b.push({ entity_id: "light.a", state: "on" }); b.dispose();
  ck("dispose forgets the pending events and cancels the timer", b.size === 0 && timers[1].cancelled === true);
  b.push({ entity_id: "light.z", state: "on" }); b.flush();
  ck("flush drains immediately", drained.length === 2 && timers[2].cancelled === true);
}

console.log("\n  one scan per summary:");
{
  let reads = 0;
  const entities = new Proxy({
    "lock.front": { entity_id: "lock.front", state: "locked", attributes: {} },
    "light.a": { entity_id: "light.a", state: "on", attributes: {} },
    "climate.ac": { entity_id: "climate.ac", state: "cool", attributes: { current_temperature: 24 } },
    "sensor.pw": { entity_id: "sensor.pw", state: "120", attributes: { device_class: "power", unit_of_measurement: "W" } },
  }, { ownKeys(t) { reads++; return Reflect.ownKeys(t); } });
  const s = villaSummary({ entities, devices: { has: () => true }, resolvedRooms: {}, thresholds: {} });
  ck("villaSummary enumerates the store exactly once", reads === 1, reads);
  ck("  ...and every fact still comes out", s.locks.locked.length === 1 && s.lights.on.length === 1 && s.climate.avgCurrentTemp === 24 && s.power.totalW === 120);
  const idx = domainIndex(entities);
  ck("the index groups by domain", idx.get("light").length === 1 && idx.get("sensor")[0].entity_id === "sensor.pw" && idx.get("cover") === undefined);
}

console.log("\n  folding computed once:");
{
  const entityMap = { "sensor.t": { type: "sensor" }, "sensor.h": { type: "sensor" } };
  const entities = { "sensor.t": { entity_id: "sensor.t", state: "1", attributes: {} }, "sensor.h": { entity_id: "sensor.h", state: "2", attributes: {} } };
  const folding = deviceFolding(entityMap, [{ id: "g", primaryEntityId: "sensor.t", memberEntityIds: ["sensor.h"] }], {});
  const seen = { n: 0 };
  const spy = { get: (k) => { seen.n++; return folding.get(k); }, has: (k) => folding.has(k) };
  const v = villaDevices({ entityMap, deviceGroups: [], dismissedEntityIds: [], mappedEntityIds: new Set(), entities, entityDeviceIds: {}, folding: spy });
  ck("a folding passed in is the one used (the member folds into its primary)", seen.n > 0 && v.ids.join() === "sensor.t", v.ids);
  const src = readFileSync(new URL("../../src/config/VillaModel.tsx", import.meta.url), "utf8");
  ck("the villa model memoises it on config + registry and hands it to BOTH device sets",
     /useMemo\(\(\) => deviceFolding\(entityMap, deviceGroups, entityDeviceIds\), \[entityMap, deviceGroups, entityDeviceIds\]\)/.test(src) && (src.match(/entityDeviceIds, folding \}\)/g) ?? []).length === 2);
}

console.log("\n  the callers:");
{
  const st = readFileSync(new URL("../../src/ha/HAStateStore.tsx", import.meta.url), "utf8");
  ck("state_changed pushes into the batch and notifies the 3D layer at once", /batchRef\.current\?\.push\(ns\);/.test(st) && /notify\(ns\);/.test(st) && !/setEntities\(\(prev\) => \(\{ \.\.\.prev, \[ns\.entity_id\]: ns \}\)\)/.test(st));
  ck("  ...the snapshot lays the pending events over the last drain", /batchRef\.current!\.overlay\(entitiesRef\.current\)/.test(st));
  ck("  ...and a full hydrate supersedes the batch", /batchRef\.current\?\.dispose\(\);\s*setEntities\(map\);/.test(st));
  const sb = readFileSync(new URL("../../src/components/hud/SummaryBar.tsx", import.meta.url), "utf8");
  ck("the summary bar finds the station once and hands it to the tiles", (sb.match(/findWeatherStation\(/g) ?? []).length === 1 && /useMemo\(\(\) => findWeatherStation\(visibleEntities, entityDeviceIds\)/.test(sb));
}

done("✅ React sees the socket once per window; each render scans once");

