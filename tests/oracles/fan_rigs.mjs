// Ceiling fans that spin (src/babylon/fanRigs.ts), on a NullEngine.
//
// ⚠️ THE HISTORY THIS REPLAYS: `rotateAround` and `setPivotPoint` both failed
// on a fan whose placement is baked into its vertices (the mesh orbited, or
// vanished); the badge anchor was dragged into the spinning subtree; and a
// pivot disposed outright took the fan mesh with it on every re-index after it
// had spun. And to 2.496.100 the full-dispose path still did exactly that.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { TransformNode } = await import("@babylonjs/core/Meshes/transformNode.js");
const { CreateBox } = await import("@babylonjs/core/Meshes/Builders/boxBuilder.js");
const { VertexBuffer } = await import("@babylonjs/core/Buffers/buffer.js");
const { FanRigs, isCeilingFan } = await import("@/babylon/fanRigs");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t;

function rig() {
  const scene = new Scene(new NullEngine());
  const villa = new TransformNode("villa", scene);
  // A fan whose placement is BAKED INTO ITS VERTICES, as the pipeline exports
  // them: position at the origin, geometry around (5, 2.5, 3).
  const fan = CreateBox("fan.ceiling_fan_living", { width: 1.2, height: 0.4, depth: 1.2, updatable: true }, scene);
  const pos = fan.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) { pos[i] += 5; pos[i + 1] += 2.5; pos[i + 2] += 3; }
  fan.updateVerticesData(VertexBuffer.PositionKind, pos); fan.refreshBoundingInfo();
  fan.parent = villa;
  const anchor = new TransformNode("anchor", scene); anchor.parent = fan;
  let woke = 0;
  const fans = new FanRigs(scene, (id) => (id === "fan.ceiling_fan_living" ? anchor : undefined), () => woke++);
  const centre = () => { fan.computeWorldMatrix(true); return fan.getBoundingInfo().boundingBox.centerWorld.clone(); };
  return { scene, villa, fan, anchor, fans, centre, woke: () => woke };
}
const on = (pct) => ({ entity_id: "fan.ceiling_fan_living", state: "on", attributes: pct === undefined ? {} : { percentage: pct } });
const off = { entity_id: "fan.ceiling_fan_living", state: "off", attributes: {} };

console.log("  which fans spin:");
ck("a ceiling fan does; a bathroom extractor does not", isCeilingFan("fan.ceiling_fan_living") && isCeilingFan("fan.bedroom_ceilingfan") && !isCeilingFan("fan.bathroom_vmc"));

console.log("\n  the rig:");
{
  const r = rig();
  const before = r.centre();
  r.fans.show(on(100), [r.fan]);
  ck("on: it spins, and the loop is woken", r.fans.spinningCount === 1 && r.woke() === 1);
  ck("the mesh is reparented under a pivot at its axle — nothing moves on rigging", r.fan.parent?.name.startsWith("fanPivot_") && Vector3.Distance(before, r.centre()) < 1e-3, r.centre());
  ck("the badge anchor is lifted OUT of the spinning subtree", r.anchor.parent === r.villa);
  for (let i = 0; i < 20; i++) ck.quiet = r.fans.animate(50, 1);
  const pivot = r.fan.parent;
  ck("it turns: the pivot has rotated", !!pivot.rotationQuaternion && !near(pivot.rotationQuaternion.w, 1));
  ck("  ...IN PLACE — the fixture's centre has not orbited", Vector3.Distance(before, r.centre()) < 0.05, [before, r.centre()]);
  ck("a fan on a hidden storey does not turn (nor keep frames coming)",
     (r.fan.metadata = { floorIndex: 2 }, r.fans.animate(50, 1) === false));
  r.fans.show(off, [r.fan]);
  ck("off: it stops", r.fans.spinningCount === 0 && r.fans.animate(50, 2) === false);
}
{
  const r = rig();
  r.fans.show({ ...on(), entity_id: "fan.bathroom_vmc" }, [r.fan]);
  ck("a non-ceiling fan is never rigged", r.fans.spinningCount === 0 && r.fan.parent === r.villa);
}

{
  // An ASYMMETRIC fan: a round mount on the axle, and a blade reaching out to
  // one side — its bounding box's middle is NOT the axle. The mount must stay
  // put while it turns (FAN_AXIS_TOP_SLICE: the top slice decides the axle).
  const { Mesh } = await import("@babylonjs/core/Meshes/mesh.js");
  const scene = new Scene(new NullEngine());
  const villa = new TransformNode("villa", scene);
  // A real canopy has plenty of vertices (under 20 in the top slice, the rig
  // falls back to the box's middle — see setupFanRig).
  const { CreateCylinder } = await import("@babylonjs/core/Meshes/Builders/cylinderBuilder.js");
  const mount = CreateCylinder("m", { height: 0.2, diameter: 0.25, tessellation: 24 }, scene); mount.position.set(5, 2.9, 3);
  const blade = CreateBox("b", { width: 1.6, height: 0.05, depth: 0.2 }, scene); blade.position.set(5.8, 2.4, 3);
  const fan = Mesh.MergeMeshes([mount, blade], true);
  fan.parent = villa;
  const fans = new FanRigs(scene, () => undefined, () => {});
  const mountWorld = () => {
    fan.computeWorldMatrix(true);
    const p = fan.getVerticesData(VertexBuffer.PositionKind), wm = fan.getWorldMatrix();
    const out = new Vector3(); let n = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] > 2.85) { out.addInPlace(Vector3.TransformCoordinates(new Vector3(p[i], p[i + 1], p[i + 2]), wm)); n++; }
    return out.scale(1 / n);
  };
  const before = mountWorld();
  fans.show(on(100), [fan]);
  fans.animate(250, 1);
  ck("an asymmetric fan turns about its MOUNT, not its bounding box's middle", Vector3.Distance(before, mountWorld()) < 0.02, Vector3.Distance(before, mountWorld()));
}

console.log("\n  teardown:");
{
  const r = rig();
  r.fans.show(on(50), [r.fan]);
  r.fans.animate(100, 1);
  r.fans.clear();
  ck("clear: the fan mesh is back under its parent, NOT disposed with the pivot", r.fan.parent === r.villa && !r.fan.isDisposed());
  ck("  ...no pivot left in the scene, nothing spinning", !r.scene.transformNodes.some((n) => n.name.startsWith("fanPivot_")) && r.fans.spinningCount === 0);
  r.fans.show(on(50), [r.fan]);
  ck("  ...and it can be rigged again", r.fan.parent?.name.startsWith("fanPivot_"));
}

{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals has one fan teardown, through FanRigs", (ev.match(/this\.fans\.clear\(\);/g) ?? []).length === 2 && !/private (fanRigs|spinningFans|fanAngles)\b|setupFanRig\(/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ fans spin in place, and come apart cleanly");
process.exit(fail ? 1 : 0);
