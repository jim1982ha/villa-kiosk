// tests/oracles/room_calibration.mjs
// Where the plan's rooms land on the model (src/babylon/roomCalibration.ts).
//
// What a person sees: a room's floor light, its badge and its highlight sit
// inside its walls. The owner's report (2026-11-19): the light on the floor sat
// beside the lamps, sometimes left, sometimes right. The plan was fitted to
// every device's mesh centre, and a few devices are not where their one plan
// point is: a row of garden globes sharing one name, fans sharing one name, a
// curtain's open pose. Those pulled the fit, and every room moved 0.1 to 0.4 m.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { solvePlanToWorld } = await import("@/babylon/roomCalibration");

// The model draws the plan (centimetres) mirrored in x, at 1/100, shifted.
const truth = (px, py) => ({ x: -0.01 * px + 3.2, z: 0.01 * py - 1.7 });
const rooms = [
  { name: "<room_a>", points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }] },
  { name: "<room_b>", points: [{ x: 600, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 900 }, { x: 600, y: 900 }] },
  { name: "<terrace>", points: [{ x: 0, y: 900 }, { x: 1800, y: 900 }, { x: 1800, y: 1400 }, { x: 0, y: 1400 }] },
];
// Forty devices whose mesh centre is where the plan marks them, give or take
// the few centimetres a mesh's box centre sits from its plan point.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const pairs = [];
for (let i = 0; i < 40; i++) {
  const px = 50 + ((i * 397) % 1700), py = 50 + ((i * 211) % 1300);
  const w = truth(px, py);
  pairs.push({ px, py, wx: w.x + rnd() * 0.08, wz: w.z + rnd() * 0.08 });
}
// And the ones that are not: a row of six globes under one name (their meshes
// average 2.2 m from its plan point), three fans under one name (5.8 m), and
// curtains in their open pose (a curtain drawn aside, 1.3 to 1.8 m along x).
const off = (px, py, dx, dz) => { const w = truth(px, py); return { px, py, wx: w.x + dx, wz: w.z + dz }; };
pairs.push(off(1500, 1200, 2.2, 1.2), off(1200, 1100, -5.8, 0.1), off(900, 1250, -2.5, 0.1));
for (const [px, py, dx] of [[300, 10, 1.8], [900, 10, -1.6], [1400, 10, 1.4], [200, 890, 1.3], [1000, 890, -1.1]]) pairs.push(off(px, py, dx, 0));

const sol = solvePlanToWorld({ pairs, rooms, modelWidth: 18, modelDepth: 14, hitsFloorAt: () => false });
const worst = Math.max(...rooms.flatMap((r) => r.points.map((p) => {
  const a = sol.planToWorld(p.x, p.y), b = truth(p.x, p.y);
  return Math.hypot(a.x - b.x, a.z - b.z);
})));
ck("every room's corners land on the model's own, within 3 cm", worst < 0.03, { worst, strategy: sol.strategy });
ck("  ...the devices standing apart from their plan point are left out of the fit", /from 40 of 48/.test(sol.strategy), sol.strategy);

console.log("\n  a plan whose devices all stand where it marks them:");
const clean = solvePlanToWorld({ pairs: pairs.slice(0, 40), rooms, modelWidth: 18, modelDepth: 14, hitsFloorAt: () => false });
const worstClean = Math.max(...rooms.flatMap((r) => r.points.map((p) => {
  const a = clean.planToWorld(p.x, p.y), b = truth(p.x, p.y);
  return Math.hypot(a.x - b.x, a.z - b.z);
})));
ck("all of them are used and the rooms land as well", /from 40 of 40/.test(clean.strategy) && worstClean < 0.03, { worstClean, s: clean.strategy });

done("✅ the plan's rooms land on the model's walls");
