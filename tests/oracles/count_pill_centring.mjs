// The room chip's COUNT PILL: a picture baked at the size it is drawn, its
// number centred inside the bitmap — the way the badge glyphs are (2.496.222).
//
// ⚠️ THREE RELEASES CENTRED A BABYLON TEXTBLOCK AND EACH WAS RIGHT ON SOME
// SCREENS ONLY: a fixed 0.105 em nudge, then an ink-measured one (2.496.220,
// made vertical-only in .221). Measured with a real Babylon GUI in Chromium
// and WebKit (tests/_probe/count): Babylon snaps every control to whole pixels
// at the chip's BASE size (~16 px circle, ~10 px digit) and the chip's scale
// then magnifies each snapped pixel 3–4×. As a baked picture there is nothing
// left for it to snap. Driven here by value: the baseline rule centres a
// digit's ink, whatever the font's metrics.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { countBaseline } = await import("@/babylon/badgeText");
const { OPTICAL_CORRECTION } = await import("@/babylon/badgeIcons");

// A digit as a solid block of ink from its baseline up to its figure height,
// rasterised with the baseline at the centre of a `size` square — what
// countBadgeImage measures before it draws.
function digitAtCentre(size, figure) {
  const alpha = new Uint8ClampedArray(size * size);
  const base = size / 2, top = Math.round(base - figure);
  for (let y = top; y < base; y++) for (let x = size / 2 - 8; x < size / 2 + 8; x++) alpha[y * size + x] = 255;
  return { alpha, inkCentre: (top + base - 1) / 2 };
}

console.log("  the number's baseline:");
for (const [size, figure] of [[64, 23], [96, 34], [160, 57], [256, 92]]) {
  const d = digitAtCentre(size, figure);
  const base = countBaseline(d.alpha, size);
  const moved = d.inkCentre + (base - size / 2);
  ck(`a ${size} px pill: the ink ends centred (within half a pixel)`, Math.abs(moved - (size - 1) / 2) < 0.51, [size, base, moved]);
}
ck("the baseline moves DOWN for a digit (its ink sits above the baseline)", countBaseline(digitAtCentre(96, 34).alpha, 96) > 48);
ck("the same rule as the glyphs (half-way from ink box to ink mass)", OPTICAL_CORRECTION === 0.5);

console.log("\n  the wiring:");
const bt = readFileSync(new URL("../../src/babylon/badgeText.ts", import.meta.url), "utf8");
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
ck("the pill is baked at its DRAWN size on the glyphs' ladder, number centred by countBaseline",
   /const px = bakeSizeFor\(s\.drawnPx\);/.test(bt) && /const baseline = countBaseline\(alpha, px\);/.test(bt)
   && /ctx\.textAlign = "center";/.test(bt));
ck("the chip draws it as ONE image — no TextBlock, no Rectangle for the count",
   /const countBadge = new Image\(`clusterCount_\$\{key\}`\);/.test(ev) && !/clusterCountText_/.test(ev)
   && /countBadge: Image;/.test(ev));
ck("  ...baked from the badge metrics — no size of its own",
   /fontOfSize: csm\.countFont \/ csm\.countSize,/.test(ev));
// The count blinked out of every chip while the camera moved: baked at the
// LIVE scale (zoom × the resolution valve), each rung was a new picture and
// Babylon draws nothing until a new source decodes. The glyphs' rule instead.
const drawn = ev.match(/c\.countBadge\.source = countBadgeImage\(\{[\s\S]*?drawnPx: ([^\n]*),\n/)?.[1] ?? "";
ck("  ...for this device's BEST case (badgeBakePx, bestCssToGui), never the live zoom — a camera move must not re-bake it",
   drawn === "badgeBakePx(csm.countSize, this.iconUserScale, this.bestCssToGui())", drawn);

done("✅ the count pill is a baked picture, its number centred by its ink");
