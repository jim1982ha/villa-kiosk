// A camera controller's listeners, as ONE set (src/babylon/canvasInput.ts,
// 2.496.263). Written out twice (walk camera, overview) and drifted: only the
// overview let go of held keys when the window lost focus, so a W held while
// switching apps kept the walker walking.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const target = () => {
  const on = new Map();
  return { on,
    addEventListener: (t, f, o) => on.set(t, { f, o }),
    removeEventListener: (t, f) => { if (on.get(t)?.f === f) on.delete(t); } };
};
const win = target();
globalThis.window = win;
const { canvasInput } = await import("@/babylon/canvasInput");
const canvas = target();
const calls = [];
const h = Object.fromEntries(["onPointerDown", "onPointerMove", "onPointerUp", "onWheel", "onKey", "onBlur"].map((k) => [k, () => calls.push(k)]));
const io = canvasInput(canvas, h);
io.attach(); io.attach();
ck("attach: pointers (up, cancel AND leave end a gesture), a non-passive wheel, both key events and blur",
   ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "wheel"].every((t) => canvas.on.has(t))
   && canvas.on.get("pointerleave").f === h.onPointerUp && canvas.on.get("wheel").o?.passive === false
   && ["keydown", "keyup", "blur"].every((t) => win.on.has(t)) && win.on.get("blur").f === h.onBlur && io.attached);
io.detach();
ck("detach removes every one of them", canvas.on.size === 0 && win.on.size === 0 && !io.attached);

const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const walk = src("CameraController.ts"), over = src("OverviewController.ts");
ck("both cameras take their listeners from canvasInput, and neither adds one itself",
   [walk, over].every((t) => /canvasInput\(this\.canvas, \{/.test(t) && !/this\.canvas\.addEventListener\("pointer/.test(t) && !/window\.addEventListener\("key/.test(t)));
ck("the WALK camera lets go of its keys on blur too (it kept walking)", /onBlur: \(\) => this\.keys\.clear\(\)/.test(walk) && /onBlur: this\.releaseKeys/.test(over));

done("✅ one listener set per camera");
