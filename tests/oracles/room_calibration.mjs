// The plan→world calibration (src/babylon/roomCalibration.ts + utils/affineFit)
// — how the floor plan's rooms land on the 3D villa. Pure, extracted from
// SceneManager long ago, and untested until 2.496.254. Driven with synthetic
// villas whose true transform is known, so each strategy is checked against
// the answer, not against itself.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { solvePlanToWorld, planAngleToDir } = await import("@/babylon/roomCalibration");

// The "true" villa: plan centimetres → world metres, mirrored on X, rotated a little, offset.
const th = 0.3, s = 0.01;
const TRUE = (px, py) => ({ x: -s * (Math.cos(th) * px - Math.sin(th) * py) + 4, z: s * (Math.sin(th) * px + Math.cos(th) * py) - 7 });
const pair = (px, py) => ({ px, py, ...(({ x, z }) => ({ wx: x, wz: z }))(TRUE(px, py)) });
const rect = (name, x0, y0, x1, y1) => ({ name, points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
const ROOMS = [rect("Living", 0, 0, 800, 600), rect("Bedroom", 800, 0, 1400, 600), rect("Garden", 0, 600, 1400, 1200)];
const ctx = (pairs, o = {}) => ({ pairs, rooms: ROOMS, modelWidth: 14, modelDepth: 12, hitsFloorAt: () => false, ...o });
const near = (a, b, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.z - b.z) < eps;

console.log("  strategy 1, three or more devices spread over the plan:");
{
  const pairs = [pair(100, 100), pair(1300, 200), pair(700, 1100), pair(400, 500)];
  const sol = solvePlanToWorld(ctx(pairs));
  ck("the affine fit recovers the true transform exactly — rotation, mirror and offset included",
     /^affine fit from 4/.test(sol.strategy) && [[0, 0], [1400, 1200], [333, 777]].every(([x, y]) => near(sol.planToWorld(x, y), TRUE(x, y))), sol.strategy);
  const line = [pair(0, 0), pair(500, 0), pair(1000, 0)];
  ck("devices all on one line span no area: not trusted for a full fit", !/^affine/.test(solvePlanToWorld(ctx(line)).strategy));
  const wrong = [...pairs.slice(0, 3), { ...pair(400, 500), wx: 900, wz: -900 }];
  ck("a fit that cannot reproduce its own devices (one wildly misplaced) is rejected", !/^affine/.test(solvePlanToWorld(ctx(wrong)).strategy));
}

console.log("\n  strategy 2, one or two devices:");
{
  // A plan whose scale the model's size gives exactly: 1400 cm across ↔ 14 m.
  const MIR = (px, py) => ({ x: 4 - (px - 700) * s, z: (py - 600) * s - 7 });
  const two = [[200, 300], [1100, 900]].map(([px, py]) => ({ px, py, wx: MIR(px, py).x, wz: MIR(px, py).z }));
  const sol = solvePlanToWorld(ctx(two));
  ck("the mirror signs are chosen from the devices (here: X flipped, Z not)", /flipX=true flipZ=false/.test(sol.strategy), sol.strategy);
  ck("  ...and the devices land where they are", two.every((p) => near(sol.planToWorld(p.px, p.py), { x: p.wx, z: p.wz }, 1e-9)));
}

console.log("\n  strategy 3, no devices at all:");
{
  // The floor is only under the indoor rooms when Z is flipped.
  const zFlippedFloor = (wx, wz) => wz > 0 && wz < 6;
  const sol = solvePlanToWorld(ctx([], { hitsFloorAt: zFlippedFloor }));
  ck("the orientation is voted by which mirror puts the rooms over a floor", /flipX=false flipZ=true, 2\/2 hits/.test(sol.strategy), sol.strategy);
  ck("  ...an outdoor-named room does not vote while two indoor ones can", /2\/2 hits/.test(sol.strategy));
  ck("nothing to fit against — no devices and no rooms — is no answer", solvePlanToWorld({ ...ctx([]), rooms: [] }) === null);
}

console.log("\n  a device's facing:");
{
  const d0 = planAngleToDir(0), d90 = planAngleToDir(Math.PI / 2);
  ck("SweetHome angles are RADIANS: 0 faces plan +Y, π/2 faces plan −X (not a 1.57° turn)",
     Math.abs(d0.px) < 1e-12 && d0.py === 1 && Math.abs(d90.px + 1) < 1e-12 && Math.abs(d90.py) < 1e-12);
  // ⚠️ THE TURN IS SWEETHOME'S (owner, 2026-10-08: a camera turned from 80° to 60° in SweetHome, its beam swung the
  // other way into a wall). Java's rotate of the +Y front: (x, y) → (x·cos − y·sin, x·sin + y·cos).
  const sweethome = (a) => ({ px: -Math.sin(a), py: Math.cos(a) });
  const turns = [30, 60, 80, 120, 200, 300].every((deg) => {
    const a = deg * Math.PI / 180, d = planAngleToDir(a), s = sweethome(a);
    return Math.abs(d.px - s.px) < 1e-12 && Math.abs(d.py - s.py) < 1e-12;
  });
  ck("every angle turns the way SweetHome turns the piece (not its mirror)", turns);
  const d60 = planAngleToDir(Math.PI / 3), d80 = planAngleToDir(80 * Math.PI / 180);
  ck("  ...so 80° → 60° turns it toward plan +Y, as the piece turned", d60.py > d80.py);
  // ⚠️ AN UNTILTED PIECE GETS THE DEFAULT TILT (owner, 2026-10-08: every beam was level). SweetHome writes no pitch
  // for 0, the plan reader stores 0, and `?? default` never fired: the caller must read 0 as "not set".
  const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
  ck("a camera with no tilt in the plan gets cameraBeamTiltDeg, not 0", /const pitch = e\.pitch \? e\.pitch : defaultPitchRad;/.test(sm) && /this\.config\.cameraBeamTiltDeg \* DEG/.test(sm));
}

done("✅ the floor plan lands on the villa by known transforms");
