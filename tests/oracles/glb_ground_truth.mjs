// The 3D model is the ground truth (owner, 2026-10-14): an object named after an entity IS a device of this Kiosk. It
// is never removed in the Kiosk, and when Home Assistant does not have its entity, every surface says so — "Not in
// Home Assistant". What changes it is the model, or a re-mapping.
//
// The villa's case: media_player.tv, an object of the model whose entity Home Assistant no longer has, had been
// dismissed. The map kept its badge ("Unavailable"), its window said "Not enough history yet", Settings showed a
// warning only when its exact id was typed, and Needs attention did not list it at all. Driven here through the
// real modules, the same object dismissed.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, guardsOf, parseTsx } from "../consistency/jsx.mjs";
const { dismissedEntitySet, orphanObjects, inventoryGaps } = await import("@/config/dismissedEntities");
const { villaDevices, deviceFolding } = await import("@/config/deviceGroups");
const { effectiveMapped, visibleTo } = await import("@/config/villaVisibility");
const { buildAttentionItems, attentionFor } = await import("@/config/attention");
const { missingFromHa, NOT_IN_HA } = await import("@/utils/stateColors");

const TV = "media_player.tv";
const entities = { "light.a": { entity_id: "light.a", state: "on", attributes: {} } };
const scene = new Set(["light.a", TV]);
const dismissed = [TV, "sensor.old_row"];                       // an old dismissal of the object, and of a plain row
const emptyFm = { schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] };

console.log("  never removed:");
const dis = dismissedEntitySet(dismissed, entities, scene);
ck("a dismissal on record does not apply to an object the model names", !dis.has(TV));
ck("  ...while a plain row's still does (a stale row, not in the model)", dis.has("sensor.old_row"));

console.log("\n  reported everywhere:");
const mapped = effectiveMapped(scene, {}, dis);
const folding = deviceFolding({}, [], {});
const d = villaDevices({ entityMap: {}, deviceGroups: [], dismissed: dis, mappedEntityIds: mapped,
  entities, entityDeviceIds: {}, folding });
ck("it is one of the villa's devices, and an unavailable one", d.has(TV) && d.unavailable.includes(TV), d.unavailable);
const items = buildAttentionItems({ devices: d, entities, entityMap: {}, alertThresholds: {},
  resolvedRooms: {}, fmData: emptyFm });
const sees = visibleTo("owner", { mapped, entityMap: {}, entities });
const att = attentionFor({ attentionItems: items, devices: d }, (id) => sees.has(id));
const row = att.attentionGroups.find((g) => g.items.some((i) => i.entityId === TV));
ck(`Needs attention lists it, as "${NOT_IN_HA}"`, !!row && row.items.some((i) => i.detail === NOT_IN_HA), att.attentionGroups.map((g) => g.items.map((i) => i.detail)));
ck("Advanced Settings lists it without a search, to point it at an entity", orphanObjects(scene, (id) => !!entities[id], {}).includes(TV));
ck("\"not in Home Assistant\" is said only once HA's list is loaded", missingFromHa(entities, TV) && !missingFromHa({}, TV) && !missingFromHa(entities, "light.a"));

console.log("\n  the screens:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const ed = src("components/settings/ConfigEditor.tsx"), notice = src("components/panels/UnavailableNotice.tsx");
{
  // Settings' "Remove N" and its orphan list: the villa model's ONE answer (inventoryGaps), by value
  const gaps = inventoryGaps({ rowIds: [TV, "sensor.old_row", "light.a"], sceneEntityIds: scene, inHa: (id) => !!entities[id],
    meshBindings: {}, haReady: true });
  ck("Settings' \"Remove N\" never counts an object the model names — only a plain stale row",
     gaps.stale.join() === "sensor.old_row", gaps);
  ck("  ...and nothing at all is called missing before Home Assistant's list is loaded",
     JSON.stringify(inventoryGaps({ rowIds: ["sensor.old_row"], sceneEntityIds: scene, inHa: () => false, meshBindings: {}, haReady: false }))
     === JSON.stringify({ stale: [], orphans: [] }));
  ck("  ...the screen reads that answer, never its own", /= villa\.settings;/.test(ed) && !/orphanObjects\(|dismissedEntitySet\(/.test(ed));
}
ck("  ...and a row of the model has no bin", /onRemove=\{sceneEntityIds\.has\(key\) \? undefined : remove\}/.test(ed));
ck("the device's window says it is not in Home Assistant, and what to do",
   /missingFromHa\(entities, entityId\)/.test(notice) && /NOT_IN_HA/.test(notice) && /Rename or remove its object in the 3D model/.test(notice));
ck("  ...and waits for no history it will never have",
   (() => { const bands = elements(parseTsx("components/panels/BasePanel.tsx"), "LastDayTimeline");
     return bands.length === 1 && guardsOf(bands[0]).includes("!missingFromHa(entities, entityId)"); })());
ck("the three windows that show the notice give it their entity",
   /UnavailableNotice device=\{device\} entityId=\{mapping\.entityId\}/.test(src("components/panels/ControlFrame.tsx"))
   && /UnavailableNotice entityId=\{mapping\.entityId\}/.test(src("components/panels/GenericPanel.tsx"))
   && /UnavailableNotice device="device" entityId=\{primaryMapping\.entityId\}/.test(src("components/panels/DeviceGroupPanel.tsx")));
ck("the list's \"Show all\" says entities, not entitys", /noun="entity" plural="entities"/.test(ed));

done("✅ the model's objects are never removed, and a missing entity is said everywhere");
