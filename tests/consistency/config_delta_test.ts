// tests/config_delta_test.ts
// Run: npm run test:config-delta   (node strips the types; no runner, no deps)
//
// src/babylon/entityMapDiff.ts imports NOTHING at runtime, which is the only
// reason this file can exist — the same rule geometry.ts and badgePlacement.ts
// are held to, and the reason configDelta was put in that module rather than in
// a new one that would have had to import it.
//
// ⚠️ THE CASE THIS FILE EXISTS FOR: same content, new object. `pull()` runs on
// every window focus and visibilitychange and hands back freshly JSON.parsed
// objects, so every shared key is `!==` its predecessor on a no-op pull. A bare
// `!==` therefore reports "changed" forever. That defect was found and fixed
// FOUR separate times in the field — entityMap, meshBindings, deviceGroups,
// teleportPoints — each fix landing at the reported site rather than at the
// rule, and each time it reappeared under a different key. Until now it could
// not be tested at any price: the predicate lived inside a 4,400-line Babylon
// class that cannot be loaded without a GPU context.

import { sliceChanged, sceneConfigDelta } from "../../src/babylon/entityMapDiff.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

console.log("— sliceChanged: the rule all four keys needed —");
{
  const groups = [{ name: "wing", entities: ["light.a"] }];
  check("a fresh parse of identical content is NOT a change",
    sliceChanged(groups, JSON.parse(JSON.stringify(groups))) === false);
  check("the same reference is not a change",
    sliceChanged(groups, groups) === false);
  check("different content IS a change",
    sliceChanged(groups, [{ name: "wing", entities: [] }]) === true);
  check("undefined on both sides is not a change",
    sliceChanged(undefined, undefined) === false);
  check("appearing for the first time is a change",
    sliceChanged(undefined, groups) === true);
  // ⚠️ ORDER MATTERS TO JSON.stringify AND THAT IS DELIBERATE. Reordering a
  // list the scene iterates is a real change; treating it as a no-op would
  // leave the previous order drawn.
  check("reordering is a change",
    sliceChanged([1, 2], [2, 1]) === true);
}

console.log("\n— sceneConfigDelta: the POLICY, not just the primitive —");
// ⚠️ UNTESTABLE AT ANY PRICE UNTIL 2.941.0. These ten bits were derived inside
// SceneManager.updateConfig and EntityVisuals.updateConfig — two Babylon
// classes totalling 14,400 lines that cannot be loaded without a GPU context.
{
  const base = {
    render: { a: 1 }, latitude: 1, longitude: 2,
    sh3dRooms: [{ name: "r", points: [] }], sh3dEntities: [],
    entityMap: { "light.a": { entityId: "light.a", type: "light", label: "A" } },
    meshBindings: { "light.a": "Mesh_1" },
    teleportPoints: [{ name: "p", x: 0, y: 0, z: 0 }],
    eyeHeight: 1.6,
    deviceGroups: [{ name: "wing", entities: ["light.a"] }],
    badgeStyle: "classic",
    highlightInteractive: true,
    hiddenCategories: ["security"],
  } as never;
  const reparse = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  // A no-op focus pull: every shared key is a fresh object, nothing changed.
  const pulled = { ...(base as object), entityMap: reparse((base as never as {entityMap: unknown}).entityMap),
    meshBindings: reparse((base as never as {meshBindings: unknown}).meshBindings),
    teleportPoints: reparse((base as never as {teleportPoints: unknown}).teleportPoints),
    deviceGroups: reparse((base as never as {deviceGroups: unknown}).deviceGroups) } as never;

  const noop = sceneConfigDelta(base, pulled);
  check("a no-op focus pull is identical on the entity map", noop.mapDelta === "identical");
  check("…buys no structural pass", noop.structuralChanged === false, JSON.stringify(noop));
  check("…buys no cosmetic repaint either", noop.cosmeticOnly === false);
  check("…does not rebuild the point-room glows", noop.roomPointsChanged === false);
  check("…does not rebuild the labels", noop.groupsChanged === false);
  check("…does not re-run the lighting pass", noop.renderChanged === false);
  check("…does not re-apply the highlight", noop.highlightChanged === false);

  const relabel = sceneConfigDelta(base, { ...(base as object),
    entityMap: { "light.a": { entityId: "light.a", type: "light", label: "B" } } } as never);
  check("renaming a device is cosmetic", relabel.mapDelta === "cosmetic");
  check("…and routes to the cheap repaint", relabel.cosmeticOnly === true);
  check("…never to the multi-second re-index", relabel.structuralChanged === false);

  const rebind = sceneConfigDelta(base, { ...(base as object),
    meshBindings: { "light.a": "Mesh_2" } } as never);
  check("a mesh rebinding IS structural", rebind.structuralChanged === true);
  check("…and is never cosmetic", rebind.cosmeticOnly === false);

  const newPlan = sceneConfigDelta(base, { ...(base as object),
    sh3dRooms: [{ name: "other", points: [] }] } as never);
  check("a new central plan forces recalibration", newPlan.sh3dChanged === true);
  check("…which is structural", newPlan.structuralChanged === true);
  // ⚠️ THE CASE THAT KILLED THE FIRST ATTEMPT: cosmeticOnly depends on
  // sh3dChanged, and the sh3d pair is NOT a shared key — so an aggregate over
  // the shared set alone could never answer this.
  const bothMoved = sceneConfigDelta(base, { ...(base as object),
    entityMap: { "light.a": { entityId: "light.a", type: "light", label: "B" } },
    sh3dRooms: [{ name: "other", points: [] }] } as never);
  check("a cosmetic edit ARRIVING WITH a new plan is not cosmetic-only",
    bothMoved.cosmeticOnly === false);

  const eye = sceneConfigDelta(base, { ...(base as object), eyeHeight: 1.7 } as never);
  check("moving the eye-height slider moves the point rooms", eye.roomPointsChanged === true);

  const hidden = sceneConfigDelta(base, { ...(base as object), hiddenCategories: [] } as never);
  check("hiding a category re-applies the highlight", hidden.highlightChanged === true);
  check("…but is not structural", hidden.structuralChanged === false);

  const style = sceneConfigDelta(base, { ...(base as object), badgeStyle: "card" } as never);
  check("switching badge style rebuilds the labels", style.badgeStyleChanged === true);

  const sun = sceneConfigDelta(base, { ...(base as object), latitude: 48 } as never);
  check("moving the property re-runs the lighting pass", sun.renderChanged === true);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
