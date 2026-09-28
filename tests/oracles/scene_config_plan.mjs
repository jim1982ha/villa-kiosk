// What a config change asks of the 3D scene (src/babylon/sceneConfigPlan.ts,
// round 10, 2.496.158) — driven by value. It was 100 lines inside
// SceneManager.updateConfig, testable only by reading the source; each shared
// key got its content-compare guard after its own field bug.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { sceneConfigPlan, RETELEPORT_ENTITY_DELTA } = await import("@/babylon/sceneConfigPlan");
const { DEFAULT_CONFIG } = await import("@/config/AppConfig");

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const base = { ...DEFAULT_CONFIG, entityMap: { "light.a": { entityId: "light.a", type: "light", label: "A" } },
  meshBindings: { m1: "light.a" }, teleportPoints: [{ name: "Hall", position: { x: 0, y: 1.7, z: 0 } }], hiddenCategories: [] };
const plan = (patch, from = base) => sceneConfigPlan(from, { ...from, ...patch });
const none = (p) => p.entityMap === "identical" && !Object.entries(p).some(([k, v]) => k !== "entityMap" && v);

ck("a focus pull that changed nothing (every shared key a fresh JSON copy) runs NO pass",
   none(plan({ entityMap: clone(base.entityMap), meshBindings: clone(base.meshBindings), teleportPoints: clone(base.teleportPoints),
     sh3dRooms: clone(base.sh3dRooms), sh3dEntities: clone(base.sh3dEntities), hiddenCategories: [] })), plan({ entityMap: clone(base.entityMap) }));
ck("a label edit is a cosmetic change of the device list, nothing structural", (() => { const p = plan({ entityMap: { "light.a": { ...base.entityMap["light.a"], label: "B" } } }); return p.entityMap === "cosmetic" && !p.structural && !p.highlight; })());
ck("a rebinding is structural, re-outlines, but does not re-fit the rooms", (() => { const p = plan({ meshBindings: { m1: "light.b" } }); return p.structural && p.highlight && !p.recalibrate && p.entityMap === "identical"; })());
ck("a new entity re-fits the rooms; a handful at once also moves the walker",
   plan({ entityMap: { ...base.entityMap, "lock.b": { entityId: "lock.b", type: "lock", label: "B" } } }).recalibrate
   && !plan({ entityMap: { ...base.entityMap, "lock.b": { entityId: "lock.b", type: "lock", label: "B" } } }).reteleport
   && plan({ entityMap: { ...base.entityMap, ...Object.fromEntries(Array.from({ length: RETELEPORT_ENTITY_DELTA }, (_, i) => [`lock.x${i}`, { entityId: `lock.x${i}`, type: "lock", label: "x" }])) } }).reteleport);
ck("a re-uploaded plan (.sh3d) re-fits the rooms", plan({ sh3dRooms: [{ name: "New", pts: [] }] }).recalibrate);
ck("the render look or the location re-runs the lighting, nothing else",
   (() => { const p = plan({ latitude: 1 }); return p.render && !p.structural && !p.roomPoints; })() && plan({ render: { ...base.render } }).render);
ck("the eye height rebuilds the point-rooms (they are stored at eye level)", plan({ eyeHeight: base.eyeHeight + 0.1 }).roomPoints);
ck("a hidden category or the highlight switch re-outlines only",
   (() => { const p = plan({ hiddenCategories: ["light"] }); return p.highlight && !p.structural; })() && plan({ highlightInteractive: !base.highlightInteractive }).highlight);

const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
const body = sm.slice(sm.indexOf("async updateConfig("), sm.indexOf("getAutoDetectedMappings()"));
ck("SceneManager runs the plan and decides nothing itself",
   /const plan = sceneConfigPlan\(prev, config\);/.test(body) && !/sliceChanged\(|entityMapDelta\(|\.join\(\) !==|entityDelta/.test(body));
// ⚠️ ONE DIFF, ONE REBUILD: every cosmetic edit rebuilt every badge twice —
// EntityVisuals re-diffed the device list and rebuilt, then SceneManager
// called repaintBadges() on top (2.496.215).
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const evBody = ev.slice(ev.indexOf("  updateConfig(config: AppConfig"), ev.indexOf("  /** Settings' \"Light effect strength\" slider"));
ck("the badge layer takes the plan's device-list answer and does not diff again",
   /this\.visuals\.updateConfig\(config, plan\.entityMap\);/.test(body) && evBody.length > 0 && !/entityMapDelta\(/.test(evBody));
ck("  ...and the scene no longer repaints the badges on top of that rebuild", !/repaintBadges\(/.test(body));

done("✅ what a config change asks of the scene, decided once");
