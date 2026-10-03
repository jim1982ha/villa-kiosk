// src/babylon/badgeText.ts
// THE way a Babylon GUI TextBlock is created in the scene layer. Every piece
// of text the 3D map draws — a badge's value, an entity group's count, a room
// chip's name, that chip's count pill — comes from here.
//
// ── Why a factory rather than four call sites ──────────────────────────────
// Five properties have to be set on every one of them, and missing any one is
// invisible to the compiler and easy to miss in review:
//
//   fontFamily            Babylon GUI does not inherit CSS and defaults to
//                         Arial (CLAUDE.md's first known gotcha). Setting it
//                         is not optional and has been forgotten before.
//   fontSize / fontWeight the caller's, and the only two that legitimately
//                         differ between call sites.
//   resizeToFit           see below — this is the one that actually drifted.
//   text alignment        both axes centred.
//   top                   the optical correction, textOpticalTopEm.
//
// The correction itself was applied at all four sites of the time; `resizeToFit`
// was not. The badge's value and the chip's room name had it, the two COUNT pills
// did not — and a TextBlock without it is sized 100% of its parent, so
// `_renderLines` centres the ink in the PILL's height rather than in the line
// box, and Babylon's integer truncation of the two measures lands differently.
// A number in a circle was therefore being centred by a slightly different
// calculation from the text that had been checked on real hardware, which is
// exactly the kind of "same thing drawn two ways" this file exists to stop.
//
// ── Why the correction is a BABYLON fact, not a typographic one ────────────
// Worth writing down, because the obvious DRY move — hoist it into a CSS
// token so the DOM shares it — is wrong.
//
// Read the shipped Public Sans metrics (ascent 0.950, descent 0.225, cap
// 0.723 em) through Babylon's own centring, `rootY = ascent + (height -
// fontHeight) / 2`, and a string with no descender (every string drawn here:
// "0 W", "98%", "18", a room name) lands 0.001 em from the box centre. The
// arithmetic says no correction is needed. It does not match the screen, and
// the value that does — half a descender — was arrived at by a person looking
// at real hardware after the arithmetic had twice been trusted over them.
//
// So something in Babylon's chain (the line box resizeToFit produces, the
// wrap it is centred in, the scale transform above it) contributes an offset
// the model does not account for. The DOM centres the same strings with
// line-height and has never been reported wrong — pushing this number into a
// shared CSS token would apply a correction for a Babylon behaviour to text
// that does not have it. It stays in badgeMetrics, and it stays here.

// ── THREE call sites now, not four (/dry-audit, 2026-08-18) ───────────────
// The account above is written against FOUR, which is what existed when this
// factory was extracted: the badge value, the chip's room name, and TWO count
// pills — the chip's and the summary card's. 2.363.0 deleted the summary's
// count outright ("a summary never draws a digit where its devices should be"),
// so there are three sites and one count pill. Corrected here rather than
// rewritten above, because the four-way drift IS the argument for the factory
// and is worth keeping legible; but a reader auditing "are all four still
// consistent?" would otherwise hunt for a site that no longer exists, which is
// the same failure as a chip reason that cannot fire.

import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { BadgeMetrics } from "./badgeMetrics";
import { bakeSizeFor, inkNudge } from "./badgeIcons";

/**
 * The app's own UI typeface, as a canvas font stack.
 *
 * Babylon GUI cannot read `--font-ui`, so this mirrors it. It is not exported
 * for general use: creating a TextBlock through this module is what guarantees
 * it is applied at all.
 */
const GUI_FONT_FAMILY = "\"Public Sans\", -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

export interface BadgeTextOptions {
  /** In the GUI layer's own pixels — the caller has already scaled it. */
  fontPx: number;
  color: string;
  /** CSS weight. "600" for label text, "700" for a count pill. */
  weight: string;
  /** Supplies textOpticalTopEm, and nothing else. */
  metrics: BadgeMetrics;
  /**
   * LEFT instead of centred, for text that has to line up with something beside
   * it rather than sit in the middle of its own box. The badge's VALUE is the
   * one such case: it follows an icon on a row, and a centred string in a box
   * that hugs it is not the same thing as a string whose first glyph starts at a
   * known x — `resizeToFit` measures the advance width, which includes the right
   * side bearing of the last glyph, so a centred string drifts by half that.
   * Everything else here (both count pills, the room name) is genuinely centred
   * in a box of its own and must stay that way.
   */
  align?: "center" | "left";
  /**
   * Skip the optical nudge.
   *
   * ⚠️ The nudge exists because text centred in a box of UNRELATED HEIGHT lands
   * wrong in Babylon (see this file's header). `resizeToFit` removes that
   * situation — the control becomes its own line box — so for a control that is
   * then centred by its PARENT the nudge is a second correction on top of a
   * correct result. It is kept ON by default because it was tuned on real
   * hardware for the strings that were shipping, and turning it off wholesale
   * would move four things to fix one. The badge value opts out.
   */
  opticalNudge?: boolean;
}

/**
 * A centred, correctly-fonted TextBlock.
 *
 * `resizeToFit` is on for everything, deliberately and without an opt-out: it
 * makes the control the size of its own line box, so the text is centred by
 * its PARENT's alignment rather than by Babylon's internal line placement in
 * a box of unrelated height. One centring path for every string the map draws.
 */
export function badgeText(name: string, opts: BadgeTextOptions): TextBlock {
  const t = new TextBlock(name);
  t.text = "";
  t.color = opts.color;
  t.fontFamily = GUI_FONT_FAMILY;
  t.fontWeight = opts.weight;
  // Kept as a NUMBER by the caller for the nudge below. Control.fontSize is a
  // getter returning a STRING ("13px"), so reading it back to compute with
  // gives NaN — and `top: "NaNpx"` does not throw, it silently stops the text
  // rendering at all. That took a release to find and another to understand.
  t.fontSize = opts.fontPx;
  t.top = opts.opticalNudge === false
    ? "0px"
    : `${opts.fontPx * opts.metrics.textOpticalTopEm}px`;
  t.resizeToFit = true;
  t.textHorizontalAlignment = opts.align === "left"
    ? Control.HORIZONTAL_ALIGNMENT_LEFT
    : Control.HORIZONTAL_ALIGNMENT_CENTER;
  // The CONTROL's own placement in its parent follows the text's: a left-aligned
  // string whose control is centred is centred again by the parent, which is the
  // drift this option exists to remove.
  if (opts.align === "left") t.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  t.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  return t;
}

// ── THE COUNT PILL IS A BAKED PICTURE, like a glyph chip (2.496.222) ─────
// The room chip's count — a number in a circle — was a Babylon Rectangle with
// a TextBlock in it, centred by Babylon's layout. Three releases tried to
// centre that digit and each was right on some screens and wrong on others:
//   * a fixed 0.105 em nudge (tuned by eye on one device);
//   * 2.496.220: a nudge measured from the digit's own ink (2.496.221 kept it
//     vertical only — the horizontal half moved "3" and "7" left).
// The cause none of them could reach, measured with a real Babylon GUI in
// Chromium and WebKit (tests/_probe/count): Babylon SNAPS every control's
// position and size to whole pixels AT THE CHIP'S BASE SIZE (a ~16 px circle,
// a ~10 px digit), and only then does the chip's scale (zoom × user size ×
// CSS-to-GUI) magnify it. A sub-pixel correction cannot be expressed at that
// size, and every snapped pixel becomes 3–4 on the screen: a base pill
// magnified 3.5× put the digit 2 px high and up to 3.5 px left in both
// engines — the owner's phone showed 3.5–4.5 px high, "8" included.
//
// The glyphs never had this problem because they are PICTURES baked at the
// size they are drawn (bakeSizeFor's ladder), their ink centred inside the
// bitmap (badgeIcons.opticalNudge → inkNudge). So the count is too: the circle
// and its number baked at its drawn size, the number centred VERTICALLY by its
// ink with the glyphs' own rule (inkNudge, OPTICAL_CORRECTION) and
// HORIZONTALLY by its advance width (the font's own spacing — the axis that
// never varied). Babylon then only places one image, which it cannot
// mis-centre. Nothing here is tuned: the proportions are the badge metrics'
// (countPillFraction, countFontFraction) and the offset is measured on the
// device that draws it.

/** A room chip's count pill, as the picture to draw. */
export interface CountBadgeSpec {
  /** The count as displayed (utils/countBadge.formatCountBadge). */
  text: string;
  /** Circle fill — the room's health colour (colors.healthPill). */
  fill: string;
  /** Number colour. */
  ink: string;
  /** How large to bake it, render px: its size at this device's BEST scale
   *  (badgeLook.badgeBakePx), never the live zoom — see the chip's caller. */
  drawnPx: number;
  /** The number's font size as a fraction of the pill's diameter. */
  fontOfSize: number;
}

const countCache = new Map<string, string>();

/** Where the number's baseline goes in a pill of `size` px: the centre, moved
 *  so its INK is vertically centred by the glyphs' rule. `alpha` is the number
 *  rasterised with its baseline AT the centre. Pure — the oracle drives it. */
export function countBaseline(alpha: ArrayLike<number>, size: number): number {
  return size / 2 + inkNudge(alpha, size).dy;
}

/** The count pill as a data URL: a filled circle and its number, baked at the
 *  drawn size and ink-centred (see above). Cached per picture. */
export function countBadgeImage(s: CountBadgeSpec): string {
  const px = bakeSizeFor(s.drawnPx);
  const key = `${s.text}|${s.fill}|${s.ink}|${px}|${s.fontOfSize}`;
  const hit = countCache.get(key);
  if (hit) return hit;
  let url = "";
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d");
  if (canvas && ctx) {
    canvas.width = canvas.height = px;
    const font = `700 ${px * s.fontOfSize}px ${GUI_FONT_FAMILY}`;
    // The number alone, baseline at the centre, to measure its ink.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#000";
    ctx.fillText(s.text, px / 2, px / 2);
    const data = ctx.getImageData(0, 0, px, px).data;
    const alpha = new Uint8ClampedArray(px * px);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const baseline = countBaseline(alpha, px);
    // The picture: circle, then the number where its ink is centred.
    ctx.clearRect(0, 0, px, px);
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.fill;
    ctx.fill();
    ctx.fillStyle = s.ink;
    ctx.fillText(s.text, px / 2, baseline);
    url = canvas.toDataURL("image/png");
  }
  // ⚠️ NOT CACHED BEFORE THE WEB FONT HAS LOADED: baked in the fallback font,
  // the picture would be kept after Public Sans replaced it everywhere else.
  // The chip re-asks at every update, so the next one after the load re-bakes.
  if (url && (typeof document === "undefined" || !document.fonts || document.fonts.status === "loaded")) {
    if (countCache.size > 256) countCache.clear();
    countCache.set(key, url);
  }
  return url;
}
