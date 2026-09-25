// A light pool's whole life, through LightPoolSet's own interface.
//
// ⚠️ EVERY RECENT POOL BUG WAS WIRING, AND NONE WAS TESTED. They lived in
// EntityVisuals' call sites, which nothing could reach:
//   2.434.0   a load-path probe miss was final — no pool, ever;
//   23ac0167  the storey rule for a fixture's height was asked about a floor
//             the pool stands ON, so upper-storey pools washed through walls;
//   2.476.0   a strip's pool parked on a neighbour's ceiling.
// This replays each against a FAKE floor probe and reads the real pool meshes
// the module builds (Babylon NullEngine, as floor_overlay_order.mjs does).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Color3 } = await import("@babylonjs/core/Maths/math.color.js");
const { LightPoolSet, LIGHT_POOL_RADIUS } = await import("@/babylon/lightPoolSet");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

/** A floor probe the test scripts: `below` from a function, `fresh` for the uncached re-ask. */
function probe({ below, fresh = () => null }) {
  return { below, describeBelow: fresh, clearMemo() { this.cleared++; }, save() {}, cleared: 0, stats: { probeAbove: 0 } };
}
let seq = 0;
const fixture = (name) => ({ name, uniqueId: ++seq });
const box = (x0, x1, z0, z1, y) => ({ min: { x: x0, z: z0 }, max: { x: x1, z: z1 }, centerY: y });
const room = (name, floorY, x0, x1, z0, z1) =>
  ({ name, floorY, pts: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }] });
function rig(p, readings = () => []) {
  const scene = new Scene(new NullEngine());
  const set = new LightPoolSet(scene, p, readings);
  const pools = (f) => scene.meshes.filter((m) => m.name.startsWith(`lightPool_${f.name}_${f.uniqueId}_`));
  return { scene, set, pools };
}
/** World XZ of a pool's outline (its vertices are local to its position). */
const outline = (m) => {
  const v = m.getVerticesData("position");
  const pts = [];
  for (let i = 0; i < v.length; i += 3) pts.push({ x: v[i] + m.position.x, z: v[i + 2] + m.position.z });
  return pts;
};
const reach = (m) => Math.max(...outline(m).map((q) => Math.hypot(q.x - m.position.x, q.z - m.position.z)));
const on = { on: true, colour: Color3.White(), frac: 1 };

console.log("  creation:");
{
  const r = rig(probe({ below: () => 0 }));
  const lamp = fixture("lamp"), strip = fixture("strip");
  r.set.addFixture(lamp, box(0, 0.2, 0, 0.2, 2.6), false);
  r.set.addFixture(strip, box(0, 4, 0, 0.1, 2.6), true);
  ck("a compact fixture gets one pool, lifted just off its floor",
     r.pools(lamp).length === 1 && near(r.pools(lamp)[0].position.y, 0.02));
  const xs = r.pools(strip).map((m) => m.position.x).sort((a, b) => a - b);
  ck("a strip gets three: its centre and both ends", JSON.stringify(xs) === "[0,2,4]", xs);
}
{
  let answers = false; // the load path's grid-keyed probe misses; the room-keyed one does not
  const lamp = fixture("deferred");
  const r = rig(probe({ below: () => (answers ? 0 : null) }), () => [[lamp.uniqueId, on]]);
  r.set.addFixture(lamp, box(1, 1.2, 1, 1.2, 2.6), false);
  ck("a load-path miss creates no pool yet (2.434.0)", r.pools(lamp).length === 0);
  answers = true;
  r.set.setRooms([room("Hall", 0, -5, 5, -5, 5)]);
  const made = r.pools(lamp);
  ck("  ...and calibration asks again and creates it", made.length === 1);
  ck("  ...already showing its light's state", made.length === 1 && made[0].isEnabled());
}

console.log("\n  calibration:");
{
  // Two storeys: a wide 1F room, and a narrower 2F room above part of it. The
  // pool stands on the 2F slab (2.44) under a fixture near the 2F ceiling.
  const r = rig(probe({ below: () => 2.44 }));
  const lamp = fixture("upstairs");
  r.set.addFixture(lamp, box(3.4, 3.6, 0, 0.2, 4.9), false);
  r.set.setRooms([room("Living", 0, -10, 10, -10, 10), room("Gym", 2.44, 0, 4, -3, 3)]);
  const pts = outline(r.pools(lamp)[0]);
  const maxX = Math.max(...pts.map((q) => q.x));
  ck("an upstairs pool is clipped to the upstairs room (23ac0167)", maxX <= 4 + 1e-6, maxX);
}
{
  // A strip's cached floor answer is its neighbour's soffit, 0.2m under it.
  const r = rig(probe({ below: () => 2.2, fresh: () => ({ y: 0 }) }));
  const strip = fixture("soffit");
  r.set.addFixture(strip, box(0, 0.1, 0, 0.1, 2.4), false);
  r.set.setRooms([room("Bedroom", 0, -5, 5, -5, 5)]);
  ck("a pool stuck to a ceiling is re-asked and put on the floor (2.476.0)",
     near(r.pools(strip)[0].position.y, 0.02), r.pools(strip)[0].position.y);
}
{
  // A step light 14cm above its tread: cached and fresh agree, and it stays.
  const r = rig(probe({ below: () => 0.46, fresh: () => ({ y: 0.46 }) }));
  const step = fixture("step");
  r.set.addFixture(step, box(0, 0.1, 0, 0.1, 0.6), false);
  r.set.setRooms([room("Stairs", 0, -5, 5, -5, 5)]);
  ck("  ...but a light really mounted low keeps its answer",
     near(r.pools(step)[0].position.y, 0.48), r.pools(step)[0].position.y);
  // Villa GLB + its real .sh3d rooms: each step light's pool spread 2-4 m along
  // the staircase outline at its own tread's height, floating over the treads
  // below it (2.496.74).
  const rch = reach(r.pools(step)[0]);
  ck("  ...and washes its tread, not the whole flight (2.496.74)", rch * Math.cos(Math.PI / 8) <= 0.4 + 1e-3, rch);
  ck("  ...while the lamp glow is held back only below the ROOM's floor, not the tread",
     r.set.floorYOf(step.uniqueId) === 0, r.set.floorYOf(step.uniqueId));
}
{
  // Out on a terrace, in no room: bounded by the nearest SAME-storey wall.
  const r = rig(probe({ below: () => 0 }));
  const lamp = fixture("terrace");
  r.set.addFixture(lamp, box(20, 20, 0, 0, 2.5), false);
  r.set.setRooms([room("House", 0, -10, 19, -5, 5), room("Upstairs", 2.8, -10, 19.5, -5, 5)]);
  const radius = reach(r.pools(lamp)[0]) * Math.cos(Math.PI / 8);
  ck("a pool in no room is bounded by its own storey's nearest wall, not the one above",
     near(radius, 1, 1e-3), radius);
}
{
  const pr = probe({ below: () => 0 });
  const r = rig(pr);
  r.set.addFixture(fixture("m"), box(0, 0.1, 0, 0.1, 2.5), false);
  r.set.setRooms([room("A", 0, -5, 5, -5, 5)]);
  ck("calibration drops the grid-keyed memo itself", pr.cleared === 1);
}

{
  // An open-plan room: the probe's memo hands a 2.2 m ceiling lamp the answer
  // it gave the kitchen light over a 0.75 m counter (reproduced on the villa
  // GLB, 2026-09-25 — the "glowing disc above the floor").
  const r = rig(probe({ below: () => 0.75, fresh: () => ({ y: 0.75 }) }));
  const lamp = fixture("dining");
  r.set.addFixture(lamp, box(0, 0.2, 0, 0.2, 2.2), false);
  r.set.setRooms([room("Living", 0, -5, 5, -5, 5)]);
  ck("a pool is not drawn floating at table height — it lies on its room's floor (2.496.72)",
     near(r.pools(lamp)[0].position.y, 0.02), r.pools(lamp)[0].position.y);
}
{
  // A floor that is genuinely a little raised (a threshold, a tiled step) stays.
  const r = rig(probe({ below: () => 0.2 }));
  const lamp = fixture("threshold");
  r.set.addFixture(lamp, box(0, 0.2, 0, 0.2, 2.4), false);
  r.set.setRooms([room("Hall", 0, -5, 5, -5, 5)]);
  ck("  ...while a surface a few centimetres up keeps its answer", near(r.pools(lamp)[0].position.y, 0.22), r.pools(lamp)[0].position.y);
}

console.log("\n  state:");
{
  const lamp = fixture("state");
  let reading = on;
  const r = rig(probe({ below: () => 0 }), () => [[lamp.uniqueId, reading]]);
  r.set.addFixture(lamp, box(0, 0.1, 0, 0.1, 2.5), false);
  const m = () => r.pools(lamp)[0];
  r.set.setLight(lamp.uniqueId, on);
  ck("a light on shows its pool", m().isEnabled());
  r.set.setStrength(0.5);
  ck("the strength slider scales it", near(m().material.alpha, 0.5), m().material.alpha);
  ck("  ...and an unchanged value is not a change", r.set.setStrength(0.5) === false);
  reading = { ...on, on: false }; // its storey was hidden
  r.set.resync();
  ck("a floor switch repaints from the readings", !m().isEnabled());
  r.set.clear();
  ck("clear() disposes every pool", r.pools(lamp).length === 0);
}
ck("the open-floor radius is still 1.8m", LIGHT_POOL_RADIUS === 1.8);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ every pool lands where its light is");
process.exit(fail ? 1 : 0);
