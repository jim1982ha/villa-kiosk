// A room chip BEHIND the walker never merges into one in front (2.496.177).
// Owner, walk mode: "Swimming Pool +7" drawn ahead while the pool was behind,
// sliding with the camera angle until it vanished. The merge compared TRUE
// screen positions from Vector3.Project, which mirrors a point behind the
// camera onto the screen — shown here on a real Babylon camera — so a room
// behind could "overlap" a chip in front and lend it its name.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
const { Vector3, Matrix } = await import("@babylonjs/core/Maths/math.vector.js");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
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

const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
ck("deriveChips marks a chip outside the depth range as behind, and merges only the chips in front",
   /if \(p\.z >= 0 && p\.z <= 1\) behind\.delete\(c\); else behind\.add\(c\);/.test(ev)
   && /const front = chips\.filter\(\(c\) => !behind\.has\(c\)\);/.test(ev)
   && /const merged = mergeOverlapping\(\s*front,/.test(ev)
   && /return \[\.\.\.merged, \.\.\.chips\.filter\(\(c\) => behind\.has\(c\)\)\];/.test(ev));
const gui = readFileSync(new URL("../../node_modules/@babylonjs/gui/2D/advancedDynamicTexture.js", import.meta.url), "utf8");
ck("  ...and a chip left behind is not drawn: the GUI skips a linked control outside the depth range",
   /projectedPosition\.z < 0 \|\| projectedPosition\.z > 1\)\s*\{\s*control\.notRenderable = true;/.test(gui));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ a room behind the walker lends no chip its name");
