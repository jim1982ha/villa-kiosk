// A tapped room's devices stay shown when the resolution valve moves
// (2.496.181). Owner, desktop: the Swimming Pool's icons were shown, "and as
// soon as I move my mouse they collapse" into its chip. The mouse brings the
// valve's interactive resolution back; the focus rule's zoom was measured in
// CSS px rebuilt as renderHeight × hwScale, which the truncated render height
// left up to a pixel short — one lattice rung "farther" near a boundary, and
// the focus was dropped with the camera dead still (50 of 12,020 cases).
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { rungAt, viewportPx } = await import("@/babylon/badgeScale");
const { PHONE_MAX_CSS_WIDTH } = await import("@/babylon/badgeMetrics");
const { RoomFocus } = await import("@/babylon/roomFocus");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const tan = Math.tan(0.4);
// The render height as Babylon sets it: truncated.
const zoomAt = (cssH, hw, dist, withCanvas) => rungAt(viewportPx(Math.trunc(cssH / hw), hw, true, withCanvas ? cssH : undefined), tan, dist);

let drops = 0, dropsHeadless = 0, n = 0;
for (let cssH = 700; cssH <= 1300; cssH++) for (const hw of [0.625, 0.75, 0.8, 0.9, 1.25, 1.5]) for (const dist of [20, 27.5, 35, 42.5, 50]) {
  n++;
  if (zoomAt(cssH, hw, dist, true) !== zoomAt(cssH, 0.5, dist, true)) drops++;
  if (hw <= 1 && zoomAt(cssH, hw, dist, false) < zoomAt(cssH, 0.5, dist, false)) dropsHeadless++;
}
ck(`with the canvas's CSS height the zoom is IDENTICAL at every valve level (${n} window × scale × zoom cases)`, drops === 0, drops);
ck("  ...and without a canvas (headless), rounding up never reads 'farther' at scale ≤ 1", dropsHeadless === 0, dropsHeadless);
ck("render pixels are untouched (the layout's own unit)", viewportPx(1262, 0.75, false, 947) === 1262);

// The focus itself, driven: granted at the sharp level, then the pointer moves.
const f = new RoomFocus();
f.grant(["swimming pool"]);
f.step(zoomAt(752, 0.5, 35, true));
f.step(zoomAt(752, 0.75, 35, true));
ck("a focused room survives the valve's switch to interactive frames (752 px window — a case the old rule dropped)", f.size === 1, f.size);
const g = new RoomFocus();
g.grant(["swimming pool"]); g.step(zoomAt(752, 0.5, 35, true)); g.step(zoomAt(752, 0.5, 50, true));
ck("  ...while zooming OUT still ends it", g.size === 0, g.size);

const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
ck("the layout gives the rung the canvas's CSS height", /viewportPx\(engine\.getRenderHeight\(\), engine\.getHardwareScalingLevel\(\), cssPixels,\s*engine\.getRenderingCanvas\(\)\?\.clientHeight\)/.test(ev));
// The SAME conversion answers "is this a phone" (2.496.187). It used to be
// render width × hwScale, which truncation reads SHORT: a window one CSS px
// above the phone limit read as a phone at some valve scales and regrouped
// its badges with nothing moved.
{
  const W = PHONE_MAX_CSS_WIDTH + 1, hw = 1.5, render = Math.trunc(W / hw);
  ck("one px wider than a phone, read through the canvas: not a phone", viewportPx(render, hw, true, W) > PHONE_MAX_CSS_WIDTH, viewportPx(render, hw, true, W));
  ck("  ...where render × hwScale read it as one", render * hw <= PHONE_MAX_CSS_WIDTH, render * hw);
}
ck("the phone test reads the canvas's CSS width the same way", /const cssWidth = viewportPx\(engine\.getRenderWidth\(\), engine\.getHardwareScalingLevel\(\), true,\s*engine\.getRenderingCanvas\(\)\?\.clientWidth\);/.test(ev));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ a tapped room stays open when the pointer moves");
