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
  const c = apply(cfg(), me.remapMapping("light.a", "light.b"));
  ck("remap: the mapping moves to the new entity, its settings kept",
     !c.entityMap["light.a"] && c.entityMap["light.b"]?.label === "A" && c.entityMap["light.b"].entityId === "light.b");
  ck("remap: the mesh is bound to the new entity", c.meshBindings["light.a"] === "light.b");
  ck("remap: to itself, to nothing, or from nothing — no change",
     [me.remapMapping("light.a", "light.a"), me.remapMapping("light.a", ""), me.remapMapping("light.q", "light.b")]
       .every((e) => J(e(cfg())) === "{}"));
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
  ck("bind: the mesh points at the entity, which gets a mapping", c.meshBindings.pump_mesh === "switch.pump" && !!c.entityMap["switch.pump"]);
  const u = apply(c, me.unbindMesh("pump_mesh"));
  ck("unbind: the binding goes, the mapping stays", !("pump_mesh" in u.meshBindings) && !!u.entityMap["switch.pump"]);
  ck("unbind: a mesh with no binding, no change", J(me.unbindMesh("nothing")(cfg())) === "{}");
}
{
  const c = apply(cfg(), me.forgetMappings(["light.a"]));
  ck("forget: the mapping goes AND the decision is recorded", !c.entityMap["light.a"] && c.dismissedEntityIds.includes("light.a"));
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
  const d = apply(snapshot, me.bindMesh("m2", "fan.x"), me.remapMapping("light.a", "light.b"));
  ck("a bind then a remap: both land", d.meshBindings.m2 === "fan.x" && d.meshBindings["light.a"] === "light.b" && !!d.entityMap["fan.x"]);
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

done("✅ every mapping edit reads the latest config; two in a moment both land");
