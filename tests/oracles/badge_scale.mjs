// The badge layout's scale: rung, icon zoom, reference depth — one set of rules.
//
// ⚠️ EACH OF THESE BROKE AT A JOIN BETWEEN SHALLOW METHODS: one rung giving two
// zooms (0ea51b40, 2dd5a333), a lattice walker rounding where the renderer
// ceiled (2.425.0), render and CSS pixels mixed across frames (c3367bcd). This
// calls the real badgeScale module, then pins that no copy of the formula is
// left in EntityVisuals.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { pxPerWorldAt, rungAt, referenceDepthAt, iconZoomAt, viewportPx } = await import("@/babylon/badgeScale");
const { ICON_ZOOM_MIN_SCALE } = await import("@/babylon/badgeMetrics");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const H = 1800, T = Math.tan(0.4), FIT = 30;

console.log("  the rung:");
{
  let below = 0, n = 0;
  for (let d = 5; d < 120; d += 0.37) { n++; if (rungAt(H, T, d) < pxPerWorldAt(H, T, d) - 1e-9) below++; }
  ck(`never below the true zoom (${n} distances)`, below === 0, below);
  ck("no distance, no rung", rungAt(H, T, 0) === 0 && rungAt(0, T, 10) === 0);
}
{
  // Two camera radii inside ONE lattice step: the renderer draws the same rung.
  let a = 40, b = 40;
  while (rungAt(H, T, b) === rungAt(H, T, a) && b < 41) b += 0.001;
  b -= 0.002;                                           // the last radius still on a's rung
  const za = iconZoomAt(rungAt(H, T, a), H, T, FIT), zb = iconZoomAt(rungAt(H, T, b), H, T, FIT);
  ck("one rung, one icon zoom — whatever the raw radius inside it", rungAt(H, T, a) === rungAt(H, T, b) && za === zb, { a, b, za, zb });
}
{
  // The same CSS viewport, sharpened (hw 1/2) and un-sharpened (hw 1).
  const sharp = viewportPx(1800, 0.5, true), soft = viewportPx(900, 1, true);
  ck("the CSS-pixel rung ignores the resolution valve (c3367bcd)", rungAt(sharp, T, 20) === rungAt(soft, T, 20));
  ck("  ...where the render-pixel one does not — so it is never compared across frames",
     rungAt(viewportPx(1800, 0.5, false), T, 20) !== rungAt(viewportPx(900, 1, false), T, 20));
}

console.log("\n  the icon zoom:");
ck("the walking camera (no fit) never shrinks icons", iconZoomAt(rungAt(H, T, 80), H, T, 0) === 1);
ck("at the fit and closer, icons keep their size", iconZoomAt(rungAt(H, T, FIT), H, T, FIT) === 1 && iconZoomAt(rungAt(H, T, 10), H, T, FIT) === 1);
{
  const far = iconZoomAt(rungAt(H, T, 90), H, T, FIT);
  ck("zoomed OUT past the fit, they shrink — but never below the floor", far < 1 && far >= ICON_ZOOM_MIN_SCALE - 0.02, far);
}

console.log("\n  the reference depth:");
ck("it inverts pixels-per-metre exactly", Math.abs(referenceDepthAt(H, T, pxPerWorldAt(H, T, 37)) - 37) < 1e-9);
ck("  ...and the CEILED rung is true a little nearer, never farther", referenceDepthAt(H, T, rungAt(H, T, 37)) <= 37);

console.log("\n  the callers:");
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("no inline copy of pixels-per-metre is left", !/vpH\s*\/\s*\(2\s*\*/.test(ev));
ck("the room-zoom solver walks the lattice with rungAt", /rungAt\(view\.vpH, tanV, radius\)/.test(ev));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one scale, one rung, one zoom");
process.exit(fail ? 1 : 0);
