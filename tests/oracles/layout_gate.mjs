// The badge layout's gate (src/babylon/layoutGate.ts), driven by value: marking it asks for the
// frame that draws the mark — the owner saw badges regroup "under the mouse" when a mark waited for
// an unrelated frame (2.496.332; architecture review 2026-10-12, candidate 2). Replaces
// layout_frames.mjs, which could only read the source for paired calls.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { LayoutGate } = await import("@/babylon/layoutGate");

const I = new Float32Array(16); I[0] = I[5] = I[10] = I[15] = 1;
let frames = 0;
const g = new LayoutGate(() => frames++);
ck("the first frame lays out (nothing drawn yet)", g.open(I, 100, 100) === true);
ck("  ...then the same view does not", g.open(I, 100, 100) === false);
g.markDirty();
ck("a mark asks for a frame — the change is drawn now, not on the next mouse move", frames === 1);
ck("  ...and that frame lays out", g.open(I, 100, 100) === true && g.open(I, 100, 100) === false);
g.markDirtyInFrame();
ck("a mark from inside a frame asks for none (that frame draws it; a request there loops)", frames === 1);
ck("  ...and is still laid out", g.open(I, 100, 100) === true);
const moved = Float32Array.from(I); moved[12] = 1;
ck("a changed view lays out with no mark", g.open(moved, 100, 100) === true && g.open(moved, 100, 100) === false);
ck("so does a resized viewport", g.open(moved, 100, 90) === true);

// Who may skip the frame: only the badge rescale running in, or right before, a frame.
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const inFrame = [...ev.matchAll(/markDirtyInFrame\(\)/g)].length;
ck("markDirtyInFrame has ONE caller, the rescale's requestFrame=false branch",
   inFrame === 1 && /if \(requestFrame\) this\.markLayoutDirty\(\); else this\.gate\.markDirtyInFrame\(\);/.test(ev));
ck("the gate is built on the render loop's request", /new LayoutGate\(\(\) => this\.requestRender\(\)\)/.test(ev));

done("✅ a badge layout marked out of date is drawn at once — and never loops a frame on itself");
