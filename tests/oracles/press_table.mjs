// Every press-and-hold timing on the tablet, in ONE table (utils/tapThresholds.ts, 2.496.252).
//
// hooks/useLongPress kept its own private 600 ms and 10 px beside the table's
// 500 ms and 14 px, which read as drift. They are product decisions (a
// destructive hold should be hard to trip; the top bar keeps its 480 ms), so
// the VALUES stay; what changes is that they are stated once, with their
// reasons, and no gesture module carries a number of its own.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const t = await import("@/utils/tapThresholds");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

ck("the canvas tap: 14 px, a hold at 500 ms, a double within 320 ms / 30 px (unchanged)",
   t.TAP_MOVE_TOL_PX === 14 && t.LONG_PRESS_MS === 500 && t.DOUBLE_PRESS_MS === 320 && t.DOUBLE_PRESS_TOL_PX === 30);
ck("the DOM holds: destructive 600 ms, the top bar 480 ms, 10 px before it is a scroll (unchanged)",
   t.HOLD_MS_DESTRUCTIVE === 600 && t.HOLD_MS_HUD === 480 && t.HOLD_SCROLL_TOL_PX === 10);
const hook = strip(src("hooks/useLongPress.ts"));
ck("useLongPress carries no timing or tolerance of its own — it reads the table",
   !/=\s*\d{2,4};/.test(hook) && /holdMs = HOLD_MS_DESTRUCTIVE/.test(hook) && /HOLD_SCROLL_TOL_PX/.test(hook));
ck("the joystick lets go when WebKit drops the pointer without a pointerup (the walker kept walking)",
   /onLostPointerCapture=\{end\}/.test(src("components/hud/VirtualJoystick.tsx")));

done("✅ one table of press timings; the joystick lets go");
