// Ceiling fans that spin (src/babylon/fanRigs.ts), on a NullEngine.
//
// ⚠️ THE HISTORY THIS REPLAYS: `rotateAround` and `setPivotPoint` both failed
// on a fan whose placement is baked into its vertices (the mesh orbited, or
// vanished); the badge anchor was dragged into the spinning subtree; and a
// pivot disposed outright took the fan mesh with it on every re-index after it
// had spun. And to 2.496.100 the full-dispose path still did exactly that.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { TransformNode } = await import("@babylonjs/core/Meshes/transformNode.js");
const { CreateBox } = await import("@babylonjs/core/Meshes/Builders/boxBuilder.js");
const { CreateCylinder } = await import("@babylonjs/core/Meshes/Builders/cylinderBuilder.js");
const { VertexBuffer } = await import("@babylonjs/core/Buffers/buffer.js");
const { FanRigs, isCeilingFan } = await import("@/babylon/fanRigs");

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

// ⚠️ THE AXLE IS THE BLADE TIPS' CIRCLE (owner, 2026-11-04, a recording: the blades swung round the hub). It was the
// average of the fixture's top quarter, which assumed a round ceiling mount on top: a fan exported as its flat blades
// alone has none, and its axle landed 9 cm off on the villa's model. Three blades, placement baked into the vertices,
// with something lopsided on top (a bracket, a pull chain): turned, every blade tip draws the same circle
{
  const { Mesh } = await import("@babylonjs/core/Meshes/mesh.js");
  const { enclosingCircle } = await import("@/babylon/fanRigs");
  const AXLE = new Vector3(5, 2.5, 3);
  const fixture = (mount) => {
    const scene = new Scene(new NullEngine());
    const villa = new TransformNode("villa", scene);
    const parts = [0, 1, 2].map((k) => {
      const blade = CreateBox(`b${k}`, { width: 0.6, height: 0.02, depth: 0.12 }, scene);
      blade.rotation.set(0.25, (k * 2 * Math.PI) / 3, 0); // pitched, as a blade is
      blade.position.set(AXLE.x + 0.4 * Math.cos((k * 2 * Math.PI) / 3), AXLE.y, AXLE.z - 0.4 * Math.sin((k * 2 * Math.PI) / 3));
      return blade;
    });
    const bracket = CreateBox("bracket", { width: 0.08, height: 0.06, depth: 0.08, updatable: true }, scene);
    bracket.position.set(AXLE.x + 0.18, AXLE.y + 0.05, AXLE.z);
    if (mount) {
      const m = CreateCylinder("m", { height: 0.25, diameter: 0.2, tessellation: 24 }, scene); m.position.set(AXLE.x, AXLE.y + 0.15, AXLE.z);
      parts.push(m);
    }
    const fan = Mesh.MergeMeshes([...parts, bracket], true);
    fan.parent = villa;
    return { scene, fan };
  };
  const tipCircle = (fan) => {
    fan.computeWorldMatrix(true);
    const p = fan.getVerticesData(VertexBuffer.PositionKind), wm = fan.getWorldMatrix(), v = new Vector3(), flat = [];
    for (let i = 0; i < p.length; i += 3) { Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], wm, v); flat.push([v.x, v.z]); }
    return enclosingCircle(flat);
  };
  for (const [mount, said] of [[false, "blades alone"], [true, "with its mount"]]) {
    const { scene, fan } = fixture(mount);
    const before = tipCircle(fan);
    const fans = new FanRigs(scene, () => undefined, () => {});
    fans.show(on(100), [fan]);
    let worst = 0;
    for (let i = 0; i < 9; i++) { fans.animate(70, 1); const c = tipCircle(fan); worst = Math.max(worst, Math.hypot(c.x - before.x, c.y - before.y)); }
    ck(`a fan, ${said}, something lopsided on top: it turns in place (its blade tips' circle never moves)`,
       Math.hypot(before.x - AXLE.x, before.y - AXLE.z) < 0.01 && worst < 0.005, { before, worst });
  }
  const c = enclosingCircle([[0, 0], [4, 0], [2, 3], [2, 1], [1, 0.5]]);
  ck("  ...the smallest circle holding the points: three on its edge, the rest inside",
     Math.abs(c.x - 2) < 1e-9 && Math.abs(c.y - 5 / 6) < 1e-9 && Math.abs(c.r - 13 / 6) < 1e-9 && enclosingCircle([]) === null, c);
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

done("✅ fans spin in place, and come apart cleanly");

