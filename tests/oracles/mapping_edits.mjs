// Every change to a device's mapping, through the ONE module of edits
// (config/mappingEdits.ts), driven by value.
//
// Before 2.496.224 the "change one device's mapping" patch was rebuilt by hand
// at six places, two of them from a config that could already be out of date —
// so a second edit in the same moment erased the first. Each edit is now a
// function of the config it applies to, and update() (ConfigContext) runs it
// against the config React holds at that moment.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const me = await import("@/config/mappingEdits");

const cfg = () => ({
  entityMap: { "light.a": { entityId: "light.a", type: "light", label: "A" } },
  meshBindings: { lamp_mesh: "light.a" },
  dismissedEntityIds: [],
  deviceGroups: [],
  unavailableByDesign: [],
});
// What update() does with an edit: compute from the CURRENT config, merge.
const apply = (c, ...edits) => edits.reduce((acc, e) => ({ ...acc, ...e(acc) }), c);
const J = JSON.stringify;

console.log("  one edit at a time:");
{
  const c = apply(cfg(), me.patchMapping("light.a", { badgeColor: "#f00" }));
  ck("patch: changes the field, keeps the rest", c.entityMap["light.a"].badgeColor === "#f00" && c.entityMap["light.a"].label === "A");
  ck("patch: an unmapped entity with no fallback changes nothing", J(me.patchMapping("light.zz", { label: "x" })(cfg())) === "{}");
  const fb = apply(cfg(), me.patchMapping("fan.b", { badgeColor: "#0f0" }, { entityId: "fan.b", type: "fan", label: "B" }));
  ck("patch: with a fallback, starts from it (a panel opened on a mesh-only entity)", fb.entityMap["fan.b"].label === "B" && fb.entityMap["fan.b"].badgeColor === "#0f0");
}
{
  const c = apply(cfg(), me.addMapping("switch.pump", { attributes: { friendly_name: "Pump" } }));
  ck("add: a default mapping, labelled from Home Assistant", c.entityMap["switch.pump"]?.label === "Pump", J(c.entityMap["switch.pump"]));
  ck("add: an entity already mapped is left as it is", J(me.addMapping("light.a")(cfg())) === "{}");
}
{
  // a name the owner chose ("A" would read as light.a's own fallback — see the next block)
  const named = apply(cfg(), me.patchMapping("light.a", { label: "Desk lamp" }));
  const c = apply(named, me.repointDevice("light.a", "light.b"));
  ck("remap: the mapping moves to the new entity, its settings kept",
     !c.entityMap["light.a"] && c.entityMap["light.b"]?.label === "Desk lamp" && c.entityMap["light.b"].entityId === "light.b");
  ck("remap: the mesh is bound to the new entity", c.meshBindings["light.a"] === "light.b");
  // owner, 2026-10-12: the fallback made from the OLD id passed for a chosen name under the new one
  const fb = apply({ ...cfg(), entityMap: { "light.hall_lamp": { entityId: "light.hall_lamp", type: "light", label: "hall lamp", badgeColor: "#f00" } } },
                   me.repointDevice("light.hall_lamp", "light.reading_lamp"));
  ck("remap: a name made from the OLD id is left behind (the new entity shows Home Assistant's)",
     fb.entityMap["light.reading_lamp"] && !("label" in fb.entityMap["light.reading_lamp"]), fb.entityMap["light.reading_lamp"]);
  ck("  …its other settings still move", fb.entityMap["light.reading_lamp"]?.badgeColor === "#f00");
  ck("remap: to itself or to nothing — no change",
     [me.repointDevice("light.a", "light.a"), me.repointDevice("light.a", "")].every((e) => J(e(cfg())) === "{}"));
  // architecture review 2026-10-12, candidate 1: ONE "change entity" — the second edit left the old row behind
  const orphan = apply(cfg(), me.repointDevice("light.q", "light.b"));
  ck("remap from a device with no settings (an object HA lost): the object still moves, a row is made for the new one",
     orphan.meshBindings["light.q"] === "light.b" && orphan.entityMap["light.b"]?.entityId === "light.b" && !orphan.entityMap["light.q"]);
  const kept = apply({ ...cfg(), entityMap: { ...cfg().entityMap, "light.b": { entityId: "light.b", type: "light", label: "Reading", badgeColor: "#0f0" } } },
                     me.repointDevice("light.a", "light.b"));
  ck("remap onto a device that already has settings: its own name stays, the moved settings win",
     kept.entityMap["light.b"].label === "Reading" && kept.entityMap["light.b"].badgeColor === "#0f0" && !kept.entityMap["light.a"]);
}
{
  const detected = [{ entityId: "light.a", type: "light", label: "dup" }, { entityId: "fan.live", type: "fan", label: "F" },
                    { entityId: "fan.gone", type: "fan", label: "G" }];
  const c = apply(cfg(), me.adoptDetected(detected, (id) => id !== "fan.gone"));
  ck("adopt: a new, live entity is added", c.entityMap["fan.live"]?.label === "F");
  ck("adopt: one already mapped keeps its own settings", c.entityMap["light.a"].label === "A");
  ck("adopt: one Home Assistant no longer reports is NOT brought back", !c.entityMap["fan.gone"]);
  ck("adopt: nothing new, no change", J(me.adoptDetected([detected[0]], () => true)(cfg())) === "{}");
}
{
  const c = apply(cfg(), me.bindMesh("pump_mesh", "switch.pump"));
  ck("add a 3D object: it shows the entity, which gets a mapping", c.meshBindings.pump_mesh === "switch.pump" && !!c.entityMap["switch.pump"]);
  const u = apply(c, me.takeObjectOff("pump_mesh", "switch.pump"));
  ck("take it off: its binding goes (its name matches nothing: no \"shows nothing\" stored), the mapping stays",
     !("pump_mesh" in u.meshBindings) && !!u.entityMap["switch.pump"], u.meshBindings);
  ck("take off an object from a device it does not show: no change", J(me.takeObjectOff("lamp_mesh", "fan.other")(cfg())) === "{}");
}
{
  const c = apply(cfg(), me.forgetMappings(["light.a"]));
  ck("forget: the mapping goes AND the decision is recorded", !c.entityMap["light.a"] && c.dismissedEntityIds.includes("light.a"));
}

console.log("\n  a removed device's 3D object, pointed at another entity:");
{
  const de = await import("@/config/dismissedEntities");
  const em = await import("@/config/EntityMap");
  const scene = new Set(["light.old_name", "light.a"]);
  const ha = (id) => id === "light.a" || id === "light.new_name";
  const o = (b = {}) => de.orphanObjects(scene, ha, b);
  ck("every object of the model whose entity HA no longer has is listed — no search needed (2026-10-14)",
     J(o()) === J(["light.old_name"]));
  ck("an entity HA has is not (it has its row)", !o().includes("light.a"));
  ck("an object already pointed at an entity HA has is not", o({ "light.old_name": "light.new_name" }).length === 0);
  ck("an object pointed at another missing entity still is", J(o({ "light.old_name": "light.also_gone" })) === J(["light.old_name"]));
  // what "Point it there" applies: the object named after the old id now resolves to the new entity
  const c = apply({ ...cfg(), entityMap: { ...cfg().entityMap, "light.old_name": { entityId: "light.old_name", type: "light", label: "old name" } }, meshBindings: { lamp_mesh: "light.a", hand_bound: "light.old_name" } },
                  me.repointDevice("light.old_name", "light.new_name", { attributes: { friendly_name: "New" } }));
  ck("pointed: an object bound to the old entity BY HAND moves too",
     em.resolveMeshToMapping("hand_bound", c.entityMap, c.meshBindings)?.entityId === "light.new_name");
  ck("pointed: other objects' bindings are untouched", c.meshBindings.lamp_mesh === "light.a");
  ck("pointed: to itself or to nothing, no change", J(me.repointDevice("light.a", "light.a")(cfg())) === "{}" && J(me.repointDevice("light.a", "")(cfg())) === "{}");
  ck("pointed: the object resolves to the new entity",
     em.resolveMeshToMapping("light.old_name", c.entityMap, c.meshBindings)?.entityId === "light.new_name");
  ck("pointed: the old entity leaves no row behind (repointObjects left it stranded)", !c.entityMap["light.old_name"]);
  ck("pointed: the new entity stores no name of its own — it is called by Home Assistant's, live",
     c.entityMap["light.new_name"] && !("label" in c.entityMap["light.new_name"])
     && em.labelOf("light.new_name", c.entityMap, { "light.new_name": { attributes: { friendly_name: "New" } } }) === "New");
}

{
  // pin the caller (2.496.327 tested its rule and asked the wrong list): the screen asks with the MODEL's objects
  const ed = readFileSync(new URL("../../src/components/settings/ConfigEditor.tsx", import.meta.url), "utf8");
  ck("Advanced Settings asks with the model's objects and re-points them all (\"Point it there\", its one caller)",
     /orphans: orphanIds \} = villa\.settings/.test(ed) && /useVillaModel\(\)/.test(ed) && (ed.match(/repointDevice\(/g) ?? []).length === 1
     && /repointDevice\(id, to,/.test(ed) && (ed.match(/pointAt\(id, to\)/g) ?? []).length === 2);
  // owner, 2026-11-06: the pencil that redirected a device's object is gone, with its edit's second caller
  ck("  ...and a device's card has no pencil: its 3D objects are added and taken off in its field (bindMesh, takeObjectOff)",
     /bindMesh\(object, id,/.test(ed) && /takeObjectOff\(object, id\)/.test(ed)
     && !/remap|Pencil/i.test(ed.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")));
}

console.log("\n  a device's \"3D object\" field, on a model (owner, 2026-11-06):");
{
  const em = await import("@/config/EntityMap");
  const D = await import("@/config/deviceRecord");
  const de = await import("@/config/dismissedEntities");
  const { unshownEntities } = await import("@/config/deviceGroups");
  const { normaliseConfig, DEFAULT_CONFIG } = await import("@/config/AppConfig");
  const { diffSharedConfig, applySharedConfigDiff, pickSharedConfig, parseSharedConfig } = await import("@/config/deviceConfig");
  const map = (id, type) => ({ entityId: id, type });
  // (a) an object named after its device, (b) one bound to its device by hand, (c) one with no device, (d) a device no
  // object shows; around them a model's other shapes: a curtain's poses, a lamp in parts, an exporter's form of a name
  const entityMap = {
    "light.example_terrace_lamp": map("light.example_terrace_lamp", "light"), "light.example_hall": map("light.example_hall", "light"),
    "cover.example_curtain": map("cover.example_curtain", "cover"), "light.example_desk": map("light.example_desk", "light"),
    "fan.example_ceiling": map("fan.example_ceiling", "fan"),
  };
  const meshBindings = { Lamp_Kitchen: "light.example_hall", Spot_primitive0: "fan.example_ceiling", "light.example_desk": "light.example_hall", Odd_Mesh: "notanentity" };
  const catalog = ["light.example_terrace_lamp", "light_example_terrace_lamp", "Lamp_Kitchen", "Mesh_Unnamed_042", "cover.example_curtain__open",
    "cover.example_curtain__closed.001", "light.example_desk_primitive0", "Spot_primitive0", "Spot_primitive1", "switch.example_unmapped", "Wall_01", "Odd_Mesh"];
  const A = "light.example_terrace_lamp", B = "Lamp_Kitchen", C = "Mesh_Unnamed_042", DOOR = "binary_sensor.example_back_door";
  const ent = (id) => ({ entity_id: id, state: "on", attributes: { friendly_name: id } });
  const entities = Object.fromEntries([...Object.keys(entityMap), DOOR, "switch.example_unmapped"].map((id) => [id, ent(id)]));
  const config = { ...cfg(), entityMap, meshBindings };
  const resolve = (c) => Object.fromEntries(catalog.map((m) => [m, em.resolveMeshToMapping(m, c.entityMap, c.meshBindings)?.entityId ?? null]));
  const links = (c) => D.objectLinks(catalog, c.entityMap, c.meshBindings);
  const notOnMap = (c) => unshownEntities({ entities, entityMap: c.entityMap, folding: new Map(), suppressed: new Set(), knownType: (id) => !!em.inferTypeFromEntityId(id) });

  // what the 2.496.728 resolver answered for this model (git b86204d7, run once): a config with no "shows nothing" in it
  // resolves every object as it did, so an existing install keeps every device where it was
  const BEFORE = { "light.example_terrace_lamp": "light.example_terrace_lamp", "light_example_terrace_lamp": "light.example_terrace_lamp",
    "Lamp_Kitchen": "light.example_hall", "Mesh_Unnamed_042": null, "cover.example_curtain__open": "cover.example_curtain",
    "cover.example_curtain__closed.001": "cover.example_curtain", "light.example_desk_primitive0": "light.example_hall",
    "Spot_primitive0": "fan.example_ceiling", "Spot_primitive1": null, "switch.example_unmapped": "switch.example_unmapped", "Wall_01": null, "Odd_Mesh": null };
  ck("no \"shows nothing\" stored: every object of the model shows the device it showed before", J(resolve(config)) === J(BEFORE), resolve(config));
  ck("  ...and the field's answer is the map's (meshEntityOf, before the shown box)",
     catalog.every((m) => em.meshEntityOf(m, entityMap, meshBindings) === BEFORE[m]));

  const l0 = links(config);
  ck("the field lists (a) for its device (linked by its name; an exporter's form of the name is an object of its own) and (b) for its (bound)",
     J(l0.byDevice.get(A)) === J([A, "light_example_terrace_lamp"])
     && (l0.byDevice.get("light.example_hall") ?? []).includes(B), Object.fromEntries(l0.byDevice));
  ck("  ...a curtain's poses one object, a lamp's parts one object", J(l0.byDevice.get("cover.example_curtain")) === J(["cover.example_curtain"])
     && J(l0.byDevice.get("fan.example_ceiling")) === J(["Spot"]), [l0.byDevice.get("cover.example_curtain"), l0.byDevice.get("fan.example_ceiling")]);
  ck("  ...(c) shows nothing, and its search lists it after the objects showing a device, \"shows nothing yet\"",
     l0.shows.get(C) === null && D.objectOffers("", l0, "light.example_hall")[0].shows !== null
     && D.objectOffers("", l0, "light.example_hall").at(-1).shows === null
     && D.objectOffers("mesh_unnamed", l0, "light.example_hall").map((o) => o.object).join() === C);

  const added = apply(config, me.bindMesh(C, "light.example_hall"));
  ck("adding (c) to a device binds it: the resolver now shows that device on it, and its field lists it",
     em.resolveMeshToMapping(C, added.entityMap, added.meshBindings)?.entityId === "light.example_hall" && links(added).byDevice.get("light.example_hall").includes(C));
  const moved = apply(config, me.bindMesh("Spot", "light.example_hall"));
  ck("  ...an object showing another device moves here, every part of it (a part's own binding goes)",
     resolve(moved).Spot_primitive0 === "light.example_hall" && resolve(moved).Spot_primitive1 === "light.example_hall" && !("Spot_primitive0" in moved.meshBindings), moved.meshBindings);

  const offB = apply(config, me.takeObjectOff(B, "light.example_hall"));
  ck("✕ on (b) unbinds it: no binding left, it shows nothing", !(B in offB.meshBindings) && resolve(offB)[B] === null, offB.meshBindings);

  const offA = apply(config, me.takeObjectOff(A, A));
  ck("✕ on (a), linked by its name: \"shows nothing\" stored, the resolver returns no device for it (its every form)",
     offA.meshBindings[A] === em.SHOWS_NOTHING && resolve(offA)[A] === null && em.meshEntityOf(A, offA.entityMap, offA.meshBindings) === null
     && em.resolveMeshToMapping("light.example_terrace_lamp.001", offA.entityMap, offA.meshBindings) === null, offA.meshBindings);
  ck("  ...every other object unchanged, and its device keeps its settings (on the map, its field the other object)",
     catalog.filter((m) => em.normaliseMeshName(m) !== A).every((m) => resolve(offA)[m] === BEFORE[m]) && !!offA.entityMap[A]
     && J(links(offA).byDevice.get(A)) === J(["light_example_terrace_lamp"]) && !notOnMap(offA).includes(A));
  const sceneIds = new Set(Object.values(resolve(offA)).filter(Boolean));
  ck("  ...(a) is no orphan (\"No such entity\"), nor any device's object, even an entity the villa's system lost",
     !de.orphanObjects(sceneIds, (id) => !!entities[id], offA.meshBindings).includes(A)
     && !de.orphanObjects([A], () => false, offA.meshBindings).includes(A) && de.orphanObjects([A], () => false, config.meshBindings).includes(A)
     && [...links(offA).byDevice.values()].every((objs) => !objs.includes(A)));
  ck("  ...and adding it again shows its device", resolve(apply(offA, me.bindMesh(A, A)))[A] === A);
  // stored, synced and read back: one more binding, its value the empty id
  const stored = normaliseConfig(JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, ...offA })));
  const base = pickSharedConfig({ ...DEFAULT_CONFIG, ...config }), next = pickSharedConfig({ ...DEFAULT_CONFIG, ...offA });
  const synced = applySharedConfigDiff(base, diffSharedConfig(base, next));
  const server = parseSharedConfig(JSON.parse(JSON.stringify(synced)));
  ck("  ...\"shows nothing\" survives a save and a load, and the sync to every tablet (the store's own read too)",
     stored.meshBindings[A] === em.SHOWS_NOTHING && synced.meshBindings[A] === em.SHOWS_NOTHING && server.meshBindings?.[A] === em.SHOWS_NOTHING,
     [stored.meshBindings, synced.meshBindings, server.meshBindings]);

  ck("(d) is \"not on the map\"", notOnMap(config).includes(DOOR) && !D.deviceRows(config.entityMap, new Set()).some((r) => r.id === DOOR));
  const shown = apply(config, me.bindMesh(C, DOOR, entities[DOOR]));
  ck("  ...after a 3D object added to it, it is on the map: a row of Devices, its object in its field, the resolver showing it",
     !notOnMap(shown).includes(DOOR) && D.deviceRows(shown.entityMap, new Set()).some((r) => r.id === DOOR)
     && J(links(shown).byDevice.get(DOOR)) === J([C]) && resolve(shown)[C] === DOOR);
}

console.log("\n  two edits in the same moment:");
{
  // The defect: both built from the SAME snapshot, the second erased the first.
  const snapshot = cfg();
  const stale = { ...snapshot, ...{ entityMap: { ...snapshot.entityMap, "light.a": { ...snapshot.entityMap["light.a"], label: "X" } } } };
  const staleSecond = { ...stale, ...{ entityMap: { ...snapshot.entityMap, "light.a": { ...snapshot.entityMap["light.a"], badgeColor: "#f00" } } } };
  ck("(the old shape, for contrast: the second edit erases the first)", staleSecond.entityMap["light.a"].label === "A");
  const c = apply(snapshot, me.patchMapping("light.a", { label: "X" }), me.patchMapping("light.a", { badgeColor: "#f00" }));
  ck("each edit reads the config the previous one left: both land", c.entityMap["light.a"].label === "X" && c.entityMap["light.a"].badgeColor === "#f00");
  const d = apply(snapshot, me.bindMesh("m2", "fan.x"), me.repointDevice("light.a", "light.b"));
  ck("an object added then a device re-pointed: both land", d.meshBindings.m2 === "fan.x" && d.meshBindings["light.a"] === "light.b" && !!d.entityMap["fan.x"]);
}

console.log("\n  nothing builds a mapping patch by hand any more:");
{
  // ⚠️ A test of the edits stays green while a screen goes back to building
  // the patch itself (pin the caller). Screens and pages must not spread an
  // entityMap into a new one.
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); } };
  const root = new URL("../../src/", import.meta.url).pathname;
  walk(join(root, "components")); walk(join(root, "pages"));
  const offenders = files.filter((f) => /entityMap:\s*\{\s*\.\.\./.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length));
  ck("no screen spreads entityMap into a patch (they call config/mappingEdits)", offenders.length === 0, offenders.join(", "));
  ck("the check read the screens", files.length > 50, String(files.length));
}

// rooms added and removed from the config as it is when the edit runs (architecture review scan 3, 2026-10-19)
{
  const { addRoom, removeRoom } = await import("@/config/mappingEdits");
  const base = { teleportPoints: [{ name: "Kitchen", floor: 1 }, { name: "Fitted", floor: 1, fitted: true }] };
  const room = addRoom({ name: "Rooftop", floor: 3 });
  const later = { teleportPoints: [...base.teleportPoints, { name: "Pool", floor: 1 }] };   // a pull landed meanwhile
  ck("a room is added to the config as it is NOW, the name kept as typed",
     room.edit(later).teleportPoints.map((p) => p.name).join() === "Kitchen,Fitted,Pool,Rooftop");
  const dup = addRoom({ name: "  kitchen ", floor: 1 });
  ck("  ...a name that exists, whatever its case, is refused with its words and changes nothing",
     dup.clash(base) === '"Kitchen" already exists, remove or rename it first.' && Object.keys(dup.edit(base)).length === 0);
  ck("  ...and removed by its name whatever the case, the other rooms (fitted ones too) untouched",
     removeRoom("KITCHEN")(later).teleportPoints.map((p) => p.name).join() === "Fitted,Pool");
}
console.log("\n  a device's id changed: every reference the config holds to it follows (architecture review item 9, 2026-11-14):");
// ⚠️ ONLY THE 3D OBJECTS AND THE SETTINGS MOVED: the owner's group still named the old id, so the Cockpit showed a
// "Missing" device for it, its members' readings were on neither card, and a device linked to it had a hollow pill.
{
  const { villaDevices, deviceFolding } = await import("@/config/deviceGroups");
  const OLD = "light.example_old", NEW = "light.example_new", POWER = "sensor.example_lamp_power", PLUG = "switch.example_plug";
  const before = { ...cfg(),
    entityMap: { [PLUG]: { entityId: PLUG, type: "switch", linkedEntityId: OLD }, [OLD]: { entityId: OLD, type: "light", label: "Desk lamp" },
      "light.a": { entityId: "light.a", type: "light", label: "A" } },
    meshBindings: { lamp_mesh: OLD },
    deviceGroups: [{ id: "g1", primaryEntityId: OLD, memberEntityIds: [POWER] }],
    unavailableByDesign: [OLD] };
  const after = apply(before, me.repointDevice(OLD, NEW));
  ck("its group now stands under the new id, its member kept", J(after.deviceGroups) === J([{ id: "g1", primaryEntityId: NEW, memberEntityIds: [POWER] }]),
     after.deviceGroups);
  ck("  ...a device linked to it is linked to the new id", after.entityMap[PLUG].linkedEntityId === NEW, after.entityMap[PLUG]);
  ck("  ...asleep by design it stays", J(after.unavailableByDesign) === J([NEW]), after.unavailableByDesign);
  ck("  ...and it keeps its place in the owner's order (2.496.798)", Object.keys(after.entityMap).join() === [PLUG, NEW, "light.a"].join(),
     Object.keys(after.entityMap));
  // the villa built from it, as the app builds it: one device, its member on its card, nothing "Missing"
  const now = (id, state) => ({ entity_id: id, state, attributes: {} });
  const entities = { [NEW]: now(NEW, "on"), [POWER]: now(POWER, "12"), [PLUG]: now(PLUG, "on"), "light.a": now("light.a", "off") };
  const folding = deviceFolding(after.entityMap, after.deviceGroups, {});
  const devices = villaDevices({ entityMap: after.entityMap, deviceGroups: after.deviceGroups, dismissed: new Set(), hidden: new Set(),
    suppressed: new Set(), batteries: new Set(), mappedEntityIds: new Set([NEW]), entities, entityDeviceIds: {}, deviceUnits: {}, folding });
  ck("  ...the villa has the new device and no ghost of the old one, its power reading on the new device's card",
     devices.has(NEW) && !devices.has(OLD) && devices.unavailable.length === 0 && devices.deviceOf(POWER) === NEW,
     { ids: devices.ids, unavailable: devices.unavailable, power: devices.deviceOf(POWER) });
  // one entity, one group: a member whose new id already stands in a group stays where that one stood
  const clash = apply({ ...cfg(), deviceGroups: [{ id: "g1", primaryEntityId: "sensor.x", memberEntityIds: [OLD] },
    { id: "g2", primaryEntityId: "sensor.y", memberEntityIds: [NEW] }] }, me.repointDevice(OLD, NEW));
  ck("  ...never in two groups: the new id stays in the group it was already in",
     J(clash.deviceGroups.map((g) => g.memberEntityIds)) === J([[], [NEW]]), clash.deviceGroups);
  ck("  ...and a config naming the old id nowhere else changes only its objects and settings",
     !("deviceGroups" in me.repointDevice("light.a", NEW)(cfg())) && !("unavailableByDesign" in me.repointDevice("light.a", NEW)(cfg())));
}

done("✅ every mapping edit reads the latest config; two in a moment both land");
