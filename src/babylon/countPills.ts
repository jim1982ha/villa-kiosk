// src/babylon/countPills.ts
// The map's count pills as baked pictures (badgeText's account of why they are pictures): a room chip's number in its
// health colour (countBadgeImage) and a folded chip's "+N" (tabBadgeImage). Moved whole out of badgeText.ts, which
// imports Babylon GUI, so the villa pictures (canvas/PictureView) draw their group badges with the same pills on a
// device that never downloads the 3D engine (owner, 2026-11-24). NO BABYLON IMPORT HERE.

import { bakeSizeFor, inkNudge } from "./badgeIcons";

/** The app's own UI typeface, as a canvas font stack (badgeText's TextBlocks use the same). */
export const GUI_FONT_FAMILY = "\"Public Sans\", -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

/** A room chip's count pill, as the picture to draw. */
interface CountBadgeSpec {
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


/** A folded room chip's pill on its bottom border: "+N" opens it, "−" folds it. */
interface TabBadgeSpec {
  /** roomChips.chipToggleLabel: "+N" or "−". */
  label: string;
  fill: string;
  ink: string;
  /** The pill's height, render px at this device's best scale (badgeLook.badgeBakePx). */
  drawnPx: number;
  /** The text's font size as a fraction of the pill's height. */
  fontOfSize: number;
}

/** The "−" bar's thickness and span, as fractions of the pill's height. */
const TAB_BAR = 0.14, TAB_SPAN = 0.6;

/** `n` px rounded to the nearest whole number of the same parity as `size`,
 *  so a bar of it centred in `size` px starts on a whole pixel. */
function sameParity(n: number, size: number): number {
  let r = Math.round(n);
  if ((size - r) % 2 !== 0) r += n >= r ? 1 : -1;
  return r < 1 ? r + 2 : r;
}

const tabCache = new Map<string, { url: string; w: number; h: number }>();

/**
 * The pill as a data URL with its baked size: a stadium and its text EXACTLY
 * centred, both ways. "+N" is rasterised once, its INK measured (where the
 * pixels landed, not the font's metrics or baseline: a "+" from the font sat
 * off-centre on the owner's screen, 2026-11-14), and drawn again moved by a
 * whole number of pixels so the ink's box sits in the middle — the pill's
 * height and width are chosen of the ink's parity so that offset is whole.
 * "−" is a bar of the pill's parity from its centre. Cached per picture.
 */
export function tabBadgeImage(s: TabBadgeSpec): { url: string; w: number; h: number } {
  const h0 = bakeSizeFor(s.drawnPx);
  const key = `${s.label}|${s.fill}|${s.ink}|${h0}|${s.fontOfSize}`;
  const hit = tabCache.get(key);
  if (hit) return hit;
  const none = { url: "", w: Math.round(h0 * 1.6), h: h0 };
  if (typeof document === "undefined") return none;
  const pill = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.beginPath();
    ctx.arc(h / 2, h / 2, h / 2, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.arc(w - h / 2, h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = s.fill;
    ctx.fill();
    ctx.fillStyle = s.ink;
  };
  const out = document.createElement("canvas");
  const ctx = out.getContext("2d");
  if (!ctx) return none;
  let w: number, h: number;
  if (s.label === "\u2212") {
    h = h0;
    const t = sameParity(h * TAB_BAR, h);
    w = sameParity(h * 1.6, h);                 // the "+N" pill's proportions, at the least
    const l = sameParity(h * TAB_SPAN, w);
    out.width = w; out.height = h;
    pill(ctx, w, h);
    ctx.fillRect((w - l) / 2, (h - t) / 2, l, t);
  } else {
    // The text alone on a scratch canvas, to find its ink.
    const font = `700 ${h0 * s.fontOfSize}px ${GUI_FONT_FAMILY}`;
    const sw = h0 * 4, sh = h0 * 2, tx = h0, ty = h0 * 1.5;
    const scratch = document.createElement("canvas");
    scratch.width = sw; scratch.height = sh;
    const sc = scratch.getContext("2d");
    if (!sc) return none;
    sc.font = font; sc.textBaseline = "alphabetic"; sc.textAlign = "left"; sc.fillStyle = "#000";
    sc.fillText(s.label, tx, ty);
    const a = sc.getImageData(0, 0, sw, sh).data;
    let x0 = sw, x1 = -1, y0 = sh, y1 = -1;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (a[(y * sw + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return none;
    const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
    const padY = Math.max(1, Math.round((h0 - ih) / 2));
    h = ih + 2 * padY;
    w = Math.max(iw + 2 * Math.max(padY, Math.round(h * 0.4)), h);
    if ((w - iw) % 2) w++;
    out.width = w; out.height = h;
    pill(ctx, w, h);
    ctx.font = font; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillText(s.label, tx + (w - iw) / 2 - x0, ty + (h - ih) / 2 - y0);
  }
  const res = { url: out.toDataURL("image/png"), w, h };
  // Not cached before the web font has loaded (countBadgeImage says why).
  if (!document.fonts || document.fonts.status === "loaded") {
    if (tabCache.size > 256) tabCache.clear();
    tabCache.set(key, res);
  }
  return res;
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
