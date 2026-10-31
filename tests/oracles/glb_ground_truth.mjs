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
import { elements, guardsOf, parseTsx, propText, tagOf } from "../consistency/jsx.mjs";
import ts from "typescript";
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
const d = villaDevices({ entityMap: {}, deviceGroups: [], hidden: new Set(), dismissed: dis, mappedEntityIds: mapped,
  entities, entityDeviceIds: {}, folding });
ck("it is one of the villa's devices, and an unavailable one", d.has(TV) && d.unavailable.includes(TV), d.unavailable);
const items = buildAttentionItems({ devices: d, entities, entityMap: {},
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
   /missingFromHa\(entities, entityId\)/.test(notice) && /NOT_IN_HA/.test(notice) && /missingAdvice\(/.test(notice));      // what to do: panel_rules drives its words
// ⚠️ EVERY DEVICE WINDOW, ONE NOTICE (architecture review 2026-10-31 round 12 #1: a missing sensor said only
// "UNAVAILABLE", a missing camera "Camera unavailable"): the one frame draws it, and every window PanelRouter opens
// is that frame for a missing device. Read through the compiler's tree, from the router's own list of windows.
const base = parseTsx("components/panels/BasePanel.tsx");
const declared = (tree, name) => { let f = null; const v = (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === name) f = n.initializer.getText().replace(/\s+/g, " "); ts.forEachChild(n, v); }; v(tree); return f; };
const baseNotice = elements(base, "UnavailableNotice");
ck("  ...the device window's frame draws the notice itself: missing, or lost contact, at the top of its content",
   baseNotice.length === 1 && guardsOf(baseNotice[0]).join() === "(missing || offline)" && propText(baseNotice[0], "entityId") === "entityId"
   && declared(base, "missing") === "!!entityId && missingFromHa(entities, entityId)"
   && declared(base, "offline") === "!!entityId && !missing && (lost ?? isOffline(entities[entityId]))",
   [baseNotice.map((n) => guardsOf(n)), declared(base, "missing"), declared(base, "offline")]);
let kids = null;
ts.forEachChild(base, function v(n) { if (ts.isJsxExpression(n) && n.expression?.getText() === "!missing && children") kids = n; ts.forEachChild(n, v); });
ck("  ...and, missing, draws none of the window's own content (nothing to show or command)", !!kids);
ck("  ...and waits for no history it will never have",
   (() => { const bands = elements(base, "LastDayTimeline");
     return bands.length === 1 && guardsOf(bands[0]).includes("!missing"); })());
const router = parseTsx("components/panels/PanelRouter.tsx");
const kinds = [...new Set([...router.statements].filter(ts.isImportDeclaration)
  .map((d) => d.moduleSpecifier.text).filter((m) => /^\.\/\w+Panel$/.test(m)).map((m) => m.slice(2)))];
const routed = new Set(kinds.filter((k) => elements(router, k).length > 0));
// a window is the frame for a missing device when it draws BasePanel about its device, with no notice of its own and
// no way round it: CameraPanel's own full-screen view returns early to the frame while its camera is missing
const frameFor = (k) => {
  const t = parseTsx(`components/panels/${k}.tsx`);
  const frames = elements(t, "BasePanel").filter((b) => /^(mapping|primaryMapping)\.entityId$/.test(propText(b, "entityId") ?? ""));
  const own = elements(t, "UnavailableNotice").length;
  const ret = elements(t, "div").some((d) => /camera-fullscreen/.test(propText(d, "className") ?? ""));
  let early = false;
  ts.forEachChild(t, function v(n) {
    if (ts.isIfStatement(n) && /^missingFromHa\(entities, mapping\.entityId\)$/.test(n.expression.getText())
      && elements(n.thenStatement, "BasePanel").length === 1) early = true;
    ts.forEachChild(n, v);
  });
  return frames.length > 0 && own === 0 && (!ret || early);
};
const notFramed = [...routed].filter((k) => !frameFor(k));
ck("  ...every window PanelRouter opens is that frame for a missing device, the camera's too, none with a notice of its own",
   routed.size >= 10 && routed.has("SensorPanel") && routed.has("CameraPanel") && notFramed.length === 0, { routed: [...routed], notFramed });
const { readingOf } = await import("@/config/reading");
ck("  ...and a missing reading says Missing, never UNAVAILABLE (\"Also on this device\", a grouped device's member)",
   readingOf("sensor.gone", undefined, "sensor").value === NOT_IN_HA.toUpperCase()
   && readingOf("binary_sensor.gone", undefined, "binary_sensor").value === NOT_IN_HA.toUpperCase()
   && readingOf("sensor.away", { entity_id: "sensor.away", state: "unavailable", attributes: {} }, "sensor").value === "UNAVAILABLE");
ck("the list's \"Show all\" says entities, not entitys", /noun="entity" plural="entities"/.test(ed));

done("✅ the model's objects are never removed, and a missing entity is said everywhere");
