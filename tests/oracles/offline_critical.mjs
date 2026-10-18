// What "offline" means, and which offline device is red (owner, 2026-10-18 — architecture review, offline devices).
//
// #4: the Cockpit listed every "unknown" device as Unavailable — a wind chill on a warm day, a light switch's gesture
// sensor between gestures — while the VESTA Agent calls only "unavailable" lost (since 2026-10-04). One meaning now:
// lost contact = "unavailable", or an entity the villa's system does not have.
// #2: every offline device was red. ONE list of critical devices — the villa's "critical devices offline" rule's,
// read by the proxy (GET /critical-devices) — makes an offline device red; any other is amber, and the villa's
// health is danger only for an alarm or a critical device offline.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { isOffline, isUnavailable } = await import("@/utils/stateColors");
const { villaDevices, deviceFolding } = await import("@/config/deviceGroups");
const { buildAttentionItems, groupAttention, villaHealthFrom, lineSources, attentionTone } = await import("@/config/attention");
const { parseCriticalDevices } = await import("@/ha/criticalDevices");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const e = (id, state) => ({ entity_id: id, state, attributes: { friendly_name: id } });

console.log("  one meaning of offline:");
ck("unavailable is offline", isOffline(e("sensor.x", "unavailable")) === true);
ck("unknown is NOT offline (a sensor with no value to give)", isOffline(e("sensor.x", "unknown")) === false);
ck("an entity the villa's system does not have is offline", isOffline(undefined) === true);
ck("  ...and a value still cannot be shown for unknown (isUnavailable keeps that question)",
   isUnavailable(e("sensor.x", "unknown")) === true);

const entities = {
  "sensor.windchill": e("sensor.windchill", "unknown"),
  "sensor.th_humidity": e("sensor.th_humidity", "unavailable"),
  "lock.door": e("lock.door", "unavailable"),
  "sensor.door_battery": e("sensor.door_battery", "unavailable"),
};
const ids = Object.keys(entities);
const entityMap = Object.fromEntries(ids.map((id) => [id, { entityId: id, type: id.split(".")[0], label: id }]));
const folding = deviceFolding(entityMap, [], { "lock.door": "dev-door", "sensor.door_battery": "dev-door" });
const d = villaDevices({ entityMap, deviceGroups: [], dismissed: new Set(), mappedEntityIds: new Set(ids),
  entities, entityDeviceIds: { "lock.door": "dev-door", "sensor.door_battery": "dev-door" }, folding });
ck("the Cockpit's offline list leaves out the unknown sensor and keeps the lost ones",
   !d.unavailable.includes("sensor.windchill") && d.unavailable.includes("sensor.th_humidity") && d.unavailable.includes("lock.door"),
   d.unavailable);

console.log("  one list of critical devices:");
const build = (critical) => buildAttentionItems({ unavailableIds: d.unavailable, entities, entityMap, alertThresholds: {},
  resolvedRooms: {}, fmData: EMPTY_FM_DATA, selectableIds: d.ids, folding, critical });
// the rule names the lock's BATTERY sensor; the model shows the lock: the device is critical
const items = build(new Set(["sensor.door_battery"]));
const door = items.find((i) => i.entityId === "lock.door" || i.entityId === "sensor.door_battery");
const th = items.find((i) => i.entityId === "sensor.th_humidity");
ck("a device on the rule's list offline is critical, whichever of its entities the rule names", door?.critical === true, items);
ck("  ...one not on it is not", th?.critical === false, th);
ck("  ...red for the critical one, amber for the other (their icons' tone)",
   attentionTone(door) === "critical" && lineSources(th).kinds[0] === "unavailable" && lineSources(door).kinds[0] === "critical");
ck("the villa's health: danger with a critical device offline",
   villaHealthFrom(groupAttention(items)).level === "danger");
ck("  ...a warning when only devices off the list are offline",
   villaHealthFrom(groupAttention(build(new Set()))).level === "warn");
ck("  ...and nothing is critical before the list is read (no guess)",
   build(undefined).every((i) => !i.critical));

console.log("  the proxy's answer:");
ck("its entity ids are read", JSON.stringify(parseCriticalDevices({ entities: ["lock.door", 3], rules: [], at: "x" })) === '["lock.door"]');
ck("  ...an answer that is not one is null, never an empty list taken as 'none critical'",
   parseCriticalDevices({ error: "x" }) === null && parseCriticalDevices(null) === null);
done("✅ offline means lost contact; red is the rule's list of critical devices");
