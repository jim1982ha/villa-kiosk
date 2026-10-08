// A room chip BEHIND the walker never merges into one in front (2.496.177).
// Owner, walk mode: "Swimming Pool +7" drawn ahead while the pool was behind,
// sliding with the camera angle until it vanished. The merge compared TRUE
// screen positions from Vector3.Project, which mirrors a point behind the
// camera onto the screen — shown here on a real Babylon camera — so a room
// behind could "overlap" a chip in front and lend it its name.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
const { Vector3, Matrix } = await import("@babylonjs/core/Maths/math.vector.js");

const engine = new NullEngine({ renderWidth: 2000, renderHeight: 960, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
const scene = new Scene(engine);
const cam = new FreeCamera("walk", new Vector3(0, 1.6, 0), scene); cam.fov = 0.8; cam.minZ = 0.05;
scene.activeCamera = cam; cam.computeWorldMatrix(true); scene.updateTransformMatrix(true);
const vp = cam.viewport.toGlobal(2000, 960);
const P = (x, y, z) => Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
const behind = P(0.5, 1.2, -6);   // six metres BEHIND, facing +z
ck("the premise: a point behind the camera projects ONTO the screen (mirrored) — only its depth says so",
   behind.x > 0 && behind.x < 2000 && behind.y > 0 && behind.y < 960 && !(behind.z >= 0 && behind.z <= 1), behind);
const ahead = P(-0.5, 1.2, 6);
ck("  ...while the same point in front is in the depth range", ahead.z >= 0 && ahead.z <= 1);

// Driven through the pass's own chip derivation (placementPass.deriveChips),
// on the real camera above: Kitchen stands ahead, the Pool six metres BEHIND
// at the spot whose mirrored projection lands on Kitchen's chip.
const { PlacementPass } = await import("@/babylon/placementPass");
const { RoomFocus } = await import("@/babylon/roomFocus");
const { MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
const member = (id, room, x, y, z) => ({ id, room, pos: { x, y, z } });
const chipsFor = (members) => {
  const pass = new PlacementPass();
  pass.begin({
    metrics: { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 },
    summary: { size: 40, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
    rooms: {}, focus: new RoomFocus(), exempt: new Set(), scale: 1, cardBudget: 10_000, cellCap: 6,
    chips: { members, view: { tm: scene.getTransformMatrix(), vp }, text: { charPx: 7, padPx: 20 }, budget: 400 },
  });
  for (const m of members) { pass.roomDisplay.set(m.room, m.room); pass.chipRoom(m.room, "solver"); }
  return pass.deriveChips();
};
const mirrored = chipsFor([member("k", "kitchen", -0.5, 1.2, 6), member("p", "pool", 0.5, 1.2, -6)]);
ck("a chip BEHIND the walker does not merge into the one in front — two chips, each its own room",
   mirrored.length === 2 && mirrored.every((c) => c.ids.length === 1), mirrored.map((c) => [c.key, c.ids]));
const bothAhead = chipsFor([member("k", "kitchen", -0.05, 1.2, 6), member("p", "pool", 0.05, 1.2, 6)]);
ck("  ...while two chips in front on the same spot DO merge (the test still bites)",
   bothAhead.length === 1 && bothAhead[0].ids.length === 2, bothAhead.map((c) => [c.key, c.ids]));
const gui = readFileSync(new URL("../../node_modules/@babylonjs/gui/2D/advancedDynamicTexture.js", import.meta.url), "utf8");
ck("  ...and a chip left behind is not drawn: the GUI skips a linked control outside the depth range",
   /projectedPosition\.z < 0 \|\| projectedPosition\.z > 1\)\s*\{\s*control\.notRenderable = true;/.test(gui));

done("✅ a room behind the walker lends no chip its name");
