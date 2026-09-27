// The bird's-eye view from the keyboard (2.496.178, owner: "replicate the way
// it's controllable with touch gestures, and follow the Natural Scroll
// toggle"). The key map and one step of held keys, by value; the callers.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const K = await import("@/babylon/overviewKeys");

const near = (a, b) => Math.abs(a - b) < 1e-9;
const A = (code, key = "", shift = false) => K.overviewKeyAction(code, key, shift);

ck("arrows and WASD pan; Shift turns ←/→ into rotate and ↑/↓ into tilt",
   A("ArrowLeft") === "left" && A("KeyD") === "right" && A("KeyW") === "up" && A("ArrowDown") === "down"
   && A("ArrowLeft", "", true) === "rotateLeft" && A("ArrowUp", "", true) === "tiltUp" && A("KeyE") === "rotateRight");
ck("+ and − by CHARACTER (layouts differ), and Page Up / Down", A("Equal", "=") === "zoomIn" && A("Minus", "-") === "zoomOut"
   && A("PageUp") === "zoomIn" && A("NumpadSubtract") === "zoomOut" && A("KeyZ", "z") === null);

const step = (acts, natural, dt = 0.5) => K.overviewKeyStep(new Set(acts), natural, dt);
ck("Natural Scroll ON: → is a swipe right — the drag the finger would make (dx > 0), as the pointer path signs it",
   step(["right"], true).dragX > 0);
ck("  ...↑/↓ are INVERTED against the swipe (owner): ↑ is a drag DOWN, which moves the view forward",
   step(["up"], true).dragY > 0 && step(["down"], true).dragY < 0);
ck("  ...OFF: the same key, the opposite drag — the view moves instead of the villa",
   near(step(["right"], false).dragX, -step(["right"], true).dragX) && near(step(["up"], false).dragY, -step(["up"], true).dragY));
ck("tilt follows the TOUCH gesture: ↑ (fingers up) tips the far side away (beta grows) with it ON, the reverse OFF",
   step(["tiltUp"], true).tilt > 0 && step(["tiltUp"], false).tilt < 0);
ck("rotate and zoom ignore Natural Scroll, as the twist and the pinch do",
   near(step(["rotateLeft"], true).rotate, step(["rotateLeft"], false).rotate) && step(["rotateLeft"], true).rotate > 0
   && near(step(["zoomIn"], true).zoom, step(["zoomIn"], false).zoom) && step(["zoomIn"], true).zoom < 1 && step(["zoomOut"], true).zoom > 1);
ck("per SECOND: two half-second steps move as far as one second (pan adds, zoom multiplies)",
   near(2 * step(["left"], true, 0.5).dragX, step(["left"], true, 1).dragX)
   && near(step(["zoomIn"], true, 0.5).zoom ** 2, step(["zoomIn"], true, 1).zoom));
ck("opposite keys cancel; no key, no motion",
   step(["left", "right"], true).dragX === 0 && (() => { const z = step([], true); return z.dragX === 0 && z.dragY === 0 && z.rotate === 0 && z.tilt === 0 && z.zoom === 1; })());
ck("the help text says what the arrows do under each setting",
   /villa moves/.test(K.overviewKeyHelp(true)[0].does) && /view moves/.test(K.overviewKeyHelp(false)[0].does)
   && /↑ moves the view forward/.test(K.overviewKeyHelp(true)[1].does) && /↑ moves the view back/.test(K.overviewKeyHelp(false)[1].does));

const el = (tag, inModal = false, editable = false) => ({ tagName: tag, isContentEditable: editable, closest: (sel) => (inModal && /modal/.test(sel) ? {} : null) });
ck("not while typing, nor with a dialog open; otherwise the camera's",
   !K.keyIsForCamera(el("INPUT")) && !K.keyIsForCamera(el("DIV", false, true)) && !K.keyIsForCamera(el("BUTTON", true))
   && K.keyIsForCamera(el("BODY")) && K.keyIsForCamera(null));

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const oc = src("babylon/OverviewController.ts"), cc = src("babylon/CameraController.ts"), lg = src("components/hud/LegendModal.tsx");
ck("the overview listens only while it is the active view, and lets go on blur",
   /enable\(\): void \{[\s\S]*?window\.addEventListener\("keydown", this\.onKey\);[\s\S]*?window\.addEventListener\("blur", this\.releaseKeys\);/.test(oc)
   && /disable\(\): void \{[\s\S]*?window\.removeEventListener\("keydown", this\.onKey\);[\s\S]*?this\.releaseKeys\(\);/.test(oc));
ck("  ...and moves through the gestures' own primitives, with the Natural Scroll setting",
   /overviewKeyStep\(this\.held, this\.naturalScrolling,/.test(oc) && /this\.applyPan\(k\.dragX, k\.dragY, DRAG_SENS\)/.test(oc) && /this\.applyTilt\(k\.tilt\)/.test(oc) && /clampRadius\(this\.camera\.radius \* k\.zoom/.test(oc));
ck("walking shares the guard (arrow keys in a field no longer walk the villa)", /if \(!keyIsForCamera\(e\.target\) && e\.type === "keydown"\) return;/.test(cc));
ck("the ? window lists the keys for the CURRENT setting", /overviewKeyHelp\(config\.naturalScrolling\)/.test(lg));

done("✅ the bird's-eye view from the keyboard");
