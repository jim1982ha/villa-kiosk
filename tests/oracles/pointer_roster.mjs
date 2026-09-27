// The pointers a camera controller tracks (babylon/pointerRoster), driven
// through a stub capture surface, and that BOTH controllers hold one. Until
// 2.496.195 only the bird's-eye controller forgot a pointer the browser had
// silently dropped; the walk controller kept counting it, so a tap never
// fired and a one-finger drag read as two.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync } from "node:fs";
const { PointerRoster } = await import("@/babylon/pointerRoster");
const { cameraFrame } = await import("@/babylon/cameraFrame");
const { Camera } = await import("@babylonjs/core/Cameras/camera.js");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

function surface() {
  const held = new Set();
  return {
    held,
    setPointerCapture: (id) => { if (id === 99) throw new Error("not capturable"); held.add(id); },
    releasePointerCapture: (id) => { held.delete(id); },
    hasPointerCapture: (id) => held.has(id),
  };
}

console.log("  the roster:");
{
  const s = surface(), r = new PointerRoster(s);
  r.down(1, 10, 10, "touch");
  ck("a pointer down is tracked and captured", r.size === 1 && s.held.has(1));
  ck("a move reports where it WAS and the delta", JSON.stringify(r.move(1, 13, 14)) === JSON.stringify({ oldX: 10, oldY: 10, dx: 3, dy: 4 }));
  ck("a move of an untracked pointer (mouse, no button) is null", r.move(7, 0, 0) === null);
  r.down(2, 50, 50, "touch"); r.down(3, 0, 0, "mouse");
  ck("touch count and the pinch pair", r.touchCount() === 2 && r.touchPair()[1].x === 50 && r.size === 3);
  r.up(1);
  ck("up forgets and releases", r.size === 2 && !s.held.has(1) && r.touchPair() === null);
}
console.log("\n  the self-heal:");
{
  const s = surface(), r = new PointerRoster(s);
  r.down(1, 0, 0, "touch");
  s.held.delete(1);                              // the browser ended it and said nothing
  ck("a captured pointer the browser no longer holds is dropped", r.dropLost() === 1 && r.size === 0);
  r.down(99, 0, 0, "touch");                     // capture threw
  ck("  ...but one whose capture never took is NOT judged by it (a live gesture must not become a pan)", r.dropLost() === 0 && r.size === 1);
  r.clear();
  r.down(1, 0, 0, "touch"); s.held.delete(1);
  const lost = r.down(2, 5, 5, "touch");
  ck("the next pointer down forgets the lost one FIRST — so it counts as the first finger, not the second", lost === 1 && r.size === 1);
}
console.log("\n  both cameras hold one:");
{
  const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
  for (const f of ["CameraController.ts", "OverviewController.ts"]) {
    const s = src(f);
    ck(`${f}: a PointerRoster, no Map of its own, no capture calls of its own`,
       /new PointerRoster\(canvas\)/.test(s) && !/new Map<number/.test(s) && !/\.setPointerCapture\(|\.hasPointerCapture\(|\.releasePointerCapture\(/.test(s));
  }
}
console.log("\n  the camera's frame (cameraFrame — one fov→angle rule for sky, framing, zoom and badges):");
{
  const scene = (aspect) => ({ getEngine: () => ({ getAspectRatio: () => aspect }) });
  const v = cameraFrame(scene(2), { fov: 1.0, fovMode: Camera.FOVMODE_VERTICAL_FIXED });
  ck("vertical-fixed: vHalf = fov/2, hHalf widened by the aspect", v.vHalf === 0.5 && Math.abs(v.hHalf - Math.atan(Math.tan(0.5) * 2)) < 1e-12 && v.aspect === 2);
  const h = cameraFrame(scene(2), { fov: 1.0, fovMode: Camera.FOVMODE_HORIZONTAL_FIXED });
  ck("horizontal-fixed: hHalf = fov/2, vHalf narrowed by the aspect", h.hHalf === 0.5 && Math.abs(h.vHalf - Math.atan(Math.tan(0.5) / 2)) < 1e-12);
  ck("a non-positive fov falls back to Babylon's 0.8; a zero aspect to 1", cameraFrame(scene(0), { fov: 0, fovMode: Camera.FOVMODE_VERTICAL_FIXED }).vHalf === 0.4 && cameraFrame(scene(0), { fov: 1, fovMode: 0 }).aspect === 1);
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one pointer roster; the camera frame under test");
process.exit(fail ? 1 : 0);
