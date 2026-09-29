// The room chip's COUNT PILL digit, centred by its own INK — the rule the badge
// glyphs use (badgeIcons.inkNudge), not a fixed em offset (2.496.220).
//
// ⚠️ THE FIXED OFFSET WAS RIGHT ON AT MOST ONE BROWSER. Babylon centres a
// TextBlock's LINE BOX, whose ascent and height come from the browser's own
// font measure (GetFontOffset). Measured with a real Babylon GUI in Firefox
// (tests/_probe/count): the digit sat 0.09 em low; the owner's screenshot shows
// it high. Driven here by value: the same digit ink under two browsers' line
// metrics needs two different corrections, and textInkNudge finds each.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { textRasterLayout } = await import("@/babylon/badgeText");
const { inkNudge, OPTICAL_CORRECTION } = await import("@/babylon/badgeIcons");

// A digit as a solid block of ink: from the baseline up to the figure height,
// no descender — what "2", "3", "12" are, as far as their box is concerned.
function digitRaster(width, lineHeight, ascent, figureHeight) {
  const lay = textRasterLayout(width, lineHeight, ascent);
  const alpha = new Uint8ClampedArray(lay.size * lay.size);
  const top = Math.round(lay.baseline - figureHeight), bottom = Math.round(lay.baseline);
  for (let y = top; y < bottom; y++) for (let x = Math.round(lay.x); x < Math.round(lay.x + width); x++) alpha[y * lay.size + x] = 255;
  return { lay, alpha, inkCentre: (top + bottom - 1) / 2 };
}

console.log("  one digit, two browsers' line metrics:");
// Public Sans at 100 px as Firefox measured it (ascent 95, line 117), and the
// same font with the line gap counted into "normal" line height, as other
// engines can report it (line 130: 13 px more below the baseline).
const firefox = digitRaster(56, 117, 95, 74);
const other = digitRaster(56, 130, 95, 74);
const nF = inkNudge(firefox.alpha, firefox.lay.size, 1), nO = inkNudge(other.alpha, other.lay.size, 1);
const centre = (lay) => (lay.size - 1) / 2;
ck("the nudge moves the ink's centre onto the shape's centre (Firefox metrics)",
   Math.abs(firefox.inkCentre + nF.dy - centre(firefox.lay)) < 0.51, [firefox.inkCentre, nF.dy, centre(firefox.lay)]);
ck("  ...and under the other engine's metrics too",
   Math.abs(other.inkCentre + nO.dy - centre(other.lay)) < 0.51, [other.inkCentre, nO.dy, centre(other.lay)]);
ck("  ...and the two corrections DIFFER — no single fixed em offset is right for both",
   Math.abs(nF.dy - nO.dy) >= 1, [nF.dy, nO.dy]);

console.log("\n  the same rule as the glyphs:");
ck("text uses the glyphs' own OPTICAL_CORRECTION (half-way from ink box to ink mass)", OPTICAL_CORRECTION === 0.5);
const lay = textRasterLayout(40, 20, 16);
ck("the box sits centred in the raster, as its parent centres it", lay.size === 44 && lay.x === 2 && lay.baseline === 28);

console.log("\n  the wiring:");
const bt = readFileSync(new URL("../../src/babylon/badgeText.ts", import.meta.url), "utf8");
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
ck("textInkNudge measures with Babylon's OWN font offset and the glyphs' inkNudge",
   /Control\._GetFontOffset\(font\)/.test(bt) && /out = inkNudge\(alpha, lay\.size\);/.test(bt));
ck("the count pill is ink-centred at every update, with the fixed nudge off",
   /clusterCountText_\$\{key\}`, \{\s*fontPx: sm\.countFont, color: "#ffffff", weight: "700", metrics: this\.metrics, opticalNudge: false,/.test(ev)
   && /setInkCentredText\(c\.countText, formatCountBadge\(chip\.ids\.length\), "700", this\.summaryMetrics\(\)\.countFont\);/.test(ev)
   && !/c\.countText\.text = /.test(ev));

done("✅ the count pill's digit is centred by its ink, like a glyph");
