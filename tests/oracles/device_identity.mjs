// One answer to "which device is this, and what does tapping it open"
// (src/config/deviceGroups.ts, 2.496.260). The panel router and the map knew
// explicit groups only, Cockpit and the counts the full fold, and every other
// opener the raw entity id: the Onsen pump's energy-meter fault opened the
// meter in one place and the pump in another, Settings listed that meter as
// "not shown anywhere", and grouping a lock's battery with it swapped the
// lock's controls for a read-only summary. Driven by value through the real
// fold, then the callers are pinned.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceFolding, deviceOf, deviceReadings, unshownEntities, groupEdit } = await import("@/config/deviceGroups");

const ent = (id, state = "1") => ({ entity_id: id, state, attributes: { friendly_name: id } });
const ids = ["switch.pump", "sensor.pump_power", "sensor.pump_energy", "sensor.pump_current", "button.pump_restart",
  "device_tracker.pump", "binary_sensor.pump_overheat", "lock.door", "sensor.door_battery", "sensor.lonely", "light.hall"];
const entities = Object.fromEntries(ids.map((id) => [id, ent(id)]));
// Placed: the pump's power sensor (its badge), the lock, a hall light.
const entityMap = Object.fromEntries(["sensor.pump_power", "lock.door", "light.hall"].map((id) => [id, { entityId: id, type: id.split(".")[0] }]));
const registry = Object.fromEntries([
  ...["switch.pump", "sensor.pump_power", "sensor.pump_energy", "sensor.pump_current", "button.pump_restart", "device_tracker.pump", "binary_sensor.pump_overheat"].map((id) => [id, "dev-pump"]),
  ["lock.door", "dev-door"], ["sensor.door_battery", "dev-door"]]);
const fold = deviceFolding(entityMap, [], registry);
const suppressed = new Set(["binary_sensor.pump_overheat"]);   // HA marks it diagnostic

console.log("  which device:");
ck("anything of the pump opens the pump's placed badge entity", ["switch.pump", "sensor.pump_energy", "button.pump_restart"].every((id) => deviceOf(fold, id) === "sensor.pump_power"));
ck("  ...a placed entity, and one with no device, is its own", deviceOf(fold, "sensor.pump_power") === "sensor.pump_power" && deviceOf(fold, "sensor.lonely") === "sensor.lonely");

console.log("\n  also on this device:");
const r = deviceReadings("sensor.pump_power", fold, entities, suppressed, []);
ck("the pump's other READINGS, sorted — energy and current; not the restart button, not the network tracker, not itself",
   r.join() === "sensor.pump_current,sensor.pump_energy", r);
ck("  ...a reading HA hides as diagnostic is left out unless the owner grouped it on purpose",
   !r.includes("binary_sensor.pump_overheat")
   && deviceReadings("sensor.pump_power", deviceFolding(entityMap, [{ id: "g", primaryEntityId: "sensor.pump_power", memberEntityIds: ["binary_sensor.pump_overheat"] }], registry),
        entities, suppressed, [{ id: "g", primaryEntityId: "sensor.pump_power", memberEntityIds: ["binary_sensor.pump_overheat"] }]).includes("binary_sensor.pump_overheat"));
ck("the lock lists its battery", deviceReadings("lock.door", fold, entities, suppressed, []).join() === "sensor.door_battery");

console.log("\n  not shown anywhere (Advanced Settings):");
const un = unshownEntities({ entities, entityMap, folding: fold, suppressed, knownType: () => true });
ck("a reading of a placed device is NOT 'not shown anywhere' (it is, in that device's panel)", !un.includes("sensor.pump_energy") && !un.includes("sensor.door_battery"), un);
ck("  ...a placed one is not listed, a hidden one is not listed",
   !un.includes("light.hall") && !un.includes("binary_sensor.pump_overheat"), un);
ck("  ...and a reading with no placed device IS listed", un.includes("sensor.lonely"), un);

console.log("\n  one entity, one group (groupEdit):");
const c0 = { deviceGroups: [{ id: "g1", primaryEntityId: "lock.door", memberEntityIds: ["sensor.door_battery"] }] };
ck("creating a group on an entity already in one is refused, with the reason", typeof groupEdit(c0, { kind: "create", primaryEntityId: "sensor.door_battery", id: "n" }) === "string");
ck("adding a member already in a group is refused", /already part of a group/.test(groupEdit({ deviceGroups: [...c0.deviceGroups, { id: "g2", primaryEntityId: "light.hall", memberEntityIds: [] }] }, { kind: "add", groupId: "g2", memberEntityId: "sensor.door_battery" })));
ck("accepting a suggestion whose member is already grouped is refused (it was not checked at all)",
   typeof groupEdit(c0, { kind: "accept", primaryEntityId: "light.hall", memberEntityId: "sensor.door_battery", id: "n" }) === "string");
const acc = groupEdit(c0, { kind: "accept", primaryEntityId: "lock.door", memberEntityId: "sensor.extra", id: "n" });
ck("a primary's second suggestion ADDS to its group (no second group under one primary)",
   typeof acc !== "string" && acc.deviceGroups.length === 1 && acc.deviceGroups[0].memberEntityIds.join() === "sensor.door_battery,sensor.extra", acc);
const rm = groupEdit(c0, { kind: "remove-member", groupId: "g1", memberEntityId: "sensor.door_battery" });
ck("removing a member", typeof rm !== "string" && rm.deviceGroups[0].memberEntityIds.length === 0);

console.log("\n  the callers:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const d = src("pages/Dashboard.tsx"), router = src("components/panels/PanelRouter.tsx"), base = src("components/panels/BasePanel.tsx");
ck("the Cockpit, the summary bar, the Agent and Facility open the DEVICE",
   (d.match(/onOpenEntity=\{openDevicePanel\}/g) ?? []).length === 1
   && /const handOver = useCallback\(\(from: Surface, entityId: string\) => \{\s*closeSurface\(from\);\s*openDevicePanel\(entityId\);/.test(d)
   && ["cockpit", "agent", "facility"].every((w) => d.includes(`onOpenEntity={(id) => handOver("${w}", id)}`))
   && /openEntityPanel\(identity\.deviceOf\(entityId\)\)/.test(d));
ck("  ...a list row and the camera's next/prev open exactly the entity they name",
   /setClusterGroup\(null\); openEntityPanel\(id\)/.test(d) && /setCategoryGroup\(null\); openEntityPanel\(id\)/.test(d));
ck("the open panel lists its device's readings, each opening its own panel",
   /identity\.readingsOf\(activePanel\.entityId\)/.test(d) && /readings: panelReadings,/.test(d) && /onOpenReading: openEntityPanel,/.test(d)
   && /readings\.map\(\(r\) =>/.test(base) && /onOpenReading\(r\.id\)/.test(base));
ck("grouping never trades controls for a summary: only a READING-led group opens the combined view",
   /if \(group && \(mapping\.type === "sensor" \|\| mapping\.type === "binary_sensor"\)\)/.test(router)
   && /deviceReadings=\{false\}/.test(src("components/panels/DeviceGroupPanel.tsx")));
ck("Settings' 'not shown anywhere' and the group editor ask deviceGroups, not their own rules",
   /unshownEntities\(\{/.test(src("components/settings/BindingsTable.tsx")) && !/!config\.entityMap\[id\] && !suppressedEntityIds\.has\(id\)/.test(src("components/settings/BindingsTable.tsx"))
   && /groupEdit\(config, e\)/.test(src("components/settings/GroupedDevices.tsx")) && /groupEdit\(c, e\)/.test(src("components/settings/GroupedDevices.tsx"))
   && !/groupedEntityIds|upsertGroup/.test(src("components/settings/GroupedDevices.tsx")));

done("✅ one device identity for every opener");
