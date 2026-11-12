// tests/oracles/scene_handle.mjs
// A call on the 3D scene after it was torn down does nothing, whoever makes it and whenever (owner's report,
// 2.496.784: "Cannot read properties of null (reading 'setDeviceMarks')" reloading an edited model). An invented
// scene stands in for the real one, torn down the way it is: its parts nulled.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { sceneHandle } = await import("@/babylon/sceneHandle");

function fakeScene() {
  const calls = [];
  const scene = {
    calls,
    floorCount: 2,
    marks: null,
    camera: { camera: { position: { x: 1, y: 2, z: 3 } }, setMovement(x, y) { calls.push(["move", x, y]); } },
    sun: { applyRealSun() { calls.push(["sun"]); } },
    setDeviceMarks(m) { this.marks = m; calls.push(["marks"]); },
    viewHeadingDeg() { return this.camera.camera.position.x * 90; },
    async updateConfig() { return this.sun !== null; },
    dispose() { this.camera = null; this.sun = null; this.marks = undefined; },
  };
  return scene;
}
const throws = (f) => { try { f(); return false; } catch { return true; } };

console.log("\n  while the scene is up, everything reaches it:");
let s = fakeScene();
let h = sceneHandle(s);
const v = h.view;
v.setDeviceMarks(["a"]);
ck("a call reaches the scene, as the scene itself", s.marks?.[0] === "a", s.marks);
ck("  ...and its answer comes back", v.viewHeadingDeg() === 90, v.viewHeadingDeg());
v.camera.setMovement(1, -1);
v.sun.applyRealSun();
ck("a call on one of its parts reaches that part", JSON.stringify(s.calls.slice(1)) === JSON.stringify([["move", 1, -1], ["sun"]]),
   s.calls);
ck("a value reads as it is", v.floorCount === 2 && v.camera.camera === s.camera.camera, v.floorCount);
ck("the same name is the same function each time (a listener can be removed)", v.setDeviceMarks === v.setDeviceMarks);

console.log("\n  once it is torn down, nothing a caller does throws, nor reaches it:");
const heldMethod = v.viewHeadingDeg;
const heldPart = v.camera;
h.revoke();
s.dispose();
const before = s.calls.length;
ck("a call does nothing and answers nothing", !throws(() => v.setDeviceMarks(["b"])) && v.setDeviceMarks([]) === undefined
   && s.marks === undefined && s.calls.length === before, s.calls);
ck("a call on one of its parts does nothing", !throws(() => { v.sun.applyRealSun(); v.camera.setMovement(0, 0); })
   && s.calls.length === before, s.calls);
ck("reading deep into it does not throw", !throws(() => v.camera.camera.position.x));
ck("a function taken from it before does nothing now", !throws(() => heldMethod()) && heldMethod() === undefined);
ck("a part taken from it before does nothing now", !throws(() => heldPart.setMovement(5, 5)) && s.calls.length === before,
   s.calls);
const awaited = await v.updateConfig();
ck("awaiting a call settles, with nothing", awaited === undefined, awaited);

console.log("\n  a new scene is its own: tearing one down does not touch the next:");
const s2 = fakeScene();
const h2 = sceneHandle(s2);
h2.view.setDeviceMarks(["c"]);
ck("the next scene's view works after the old one was revoked", s2.marks?.[0] === "c", s2.marks);

done("A call on a torn-down scene does nothing");
