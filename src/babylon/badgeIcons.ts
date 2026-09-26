// src/babylon/badgeIcons.ts
// Renders the in-scene state badge: a rounded squircle whose fill/glyph/ring
// come from config/EntityCategories.categorySurface — neutral by default,
// coloured only when the device is active or alerting (see VESTA-DESIGN.md
// §0). Composited once per (category, iconKey, state, theme) and cached as a
// data URL, same draw-once-cache approach the old emoji glyphs used.

import type { Category } from "@/types/scene.types";
import { categorySurfaceRinged, type DeviceSurfaceState } from "@/config/EntityCategories";
import { chipProportions } from "@/config/chipProportions";
import { ICON_NODES, type IconPrimitive } from "./badgeIconNodes";

// The bake's default size, used only when a caller has no idea what size the
// badge will be drawn at. Every real caller passes one — see BAKE_LADDER.
const CANVAS_PX = 128;

/**
 * The sizes a badge may be baked at, and the reason this exists at all.
 *
 * This image is composited onto a canvas here and then DRAWN by Babylon GUI
 * with `ctx.drawImage(img, …, w, h)` into the fullscreen texture's own 2D
 * canvas. Until 2.301.0 it was always baked at 128px and drawn at whatever the
 * badge's on-screen size was — routinely 30-48 render px, i.e. a 2.7x to 4.3x
 * DOWNSCALE on every single badge, every frame the layout rebuilds.
 *
 * Chrome absorbs that: Skia mip-filters `drawImage` once the ratio passes ~2.
 * WebKit does not — it takes a single bilinear tap, which at a 4x reduction
 * samples roughly one source pixel in sixteen and drops the rest. On a 1.5-unit
 * lucide stroke that is the difference between a clean line and a staircase,
 * which is exactly the "glyphs look pixelated in Safari, fine in Chrome"
 * report. Nothing else in the badge showed it, because GUI TEXT is drawn with
 * fillText at the texture's own resolution and never resampled at all — which
 * is also what rules out the resolution valve as the cause.
 *
 * So the fix is to stop resampling: bake at (about) the size the badge is
 * drawn. A ladder rather than the exact pixel count for two reasons — the
 * cache is keyed by size, and the badge's drawn size moves with the label-size
 * stepper and the zoomed-out icon cap, so an exact key would thrash. The rungs
 * are close enough that the residual ratio never exceeds ~1.25x, well inside
 * what a single bilinear tap handles cleanly.
 *
 * Baking smaller is also strictly less work: a 48px canvas is a seventh of
 * 128px's pixels, and this runs once per (category, glyph, state, theme, size).
 */
const BAKE_LADDER = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 256] as const;

function bakeSizeFor(pxHint: number): number {
  if (!(pxHint > 0)) return CANVAS_PX;
  const want = Math.ceil(pxHint);
  for (const rung of BAKE_LADDER) if (rung >= want) return rung;
  return BAKE_LADDER[BAKE_LADDER.length - 1];
}
const ICON_VIEWBOX = 24; // lucide's own viewBox is 0-24
/**
 * Pictogram size as a fraction of the squircle — read from the SHARED chip
 * token, not held here.
 *
 * `--chip-glyph / --chip-size` already answered this question for the bottom
 * bar's `.summary-tile-icon`, and config/chipProportions was written to expose
 * it to this side. It exposed `glyph` from the start and nothing ever consumed
 * it: the baked badge kept a literal 0.56 while the DOM chip drew 24/46 =
 * 0.52, so the same object rendered at two different ratios depending on which
 * renderer drew it. One token now, and raising it raises both together.
 *
 * Resolved per bake rather than at module load, like the rest of
 * chipProportions: a theme switch re-reads the same custom properties and the
 * cache key includes the theme, so every affected image is re-baked anyway.
 */
function iconFraction(): number {
  return chipProportions().glyph;
}
// Stroke in lucide VIEWBOX units — i.e. PROPORTIONAL to the icon, exactly like
// the real lucide components the top bar renders. 1.5 matches the app-wide
// icon standard (EntityCategories' CATEGORY_ICONS, the top bar, chips — see
// VESTA-DESIGN.md §1.3): one stroke weight everywhere, never a filled glyph.
const ICON_STROKE_VIEWBOX = 1.5;
/**
 * The glyph weight the CARD badge style asks for, in the same viewBox units.
 *
 * lucide's own default is 2.0 and this app draws 1.5, which reads as intended
 * on the classic badge — a filled squircle where the glyph is the only ink on
 * a saturated ground. The card style puts the same glyph on a pale chip inside
 * a bordered card, and at that contrast a 1.5 stroke thins out to almost
 * nothing on hardware; reported from a tablet as "the lines are too thin".
 *
 * Past lucide's default rather than at it, because the competing ink here is
 * the card's own border and the chip's edge, not the badge's fill. One
 * constant, so the weight can be tuned in a single place after it is judged on
 * a real screen — which is the whole reason the classic style is deliberately
 * left at ICON_STROKE_VIEWBOX for now: two styles at two weights makes the
 * delta measurable side by side.
 */
const ICON_STROKE_VIEWBOX_BOLD = 2.5;
/** Squircle corner radius as a fraction of the badge's size — exported so
 *  EntityVisuals' outline Rectangle can match this canvas's rounding exactly.
 *  Approximates --radius-badge (12px) at the classic badge's typical ~40-44px
 *  on-screen size; a fraction (not a fixed px) so it still looks right when
 *  the label-size stepper scales the badge up or down. */
// The corner fraction, the inset and the dash are badgeLook's (one owner).
export { BADGE_CORNER_FRACTION, BADGE_INSET_CARD, RING_DASH } from "./badgeLook";
import { BADGE_CORNER_FRACTION, RING_DASH } from "./badgeLook";
// The CLASSIC style's ring, as a fraction of the badge (a card-style badge's
// ring is badgeLook.badgeRing, passed in as `ringOfSize`). RING_FRACTION lands on the
// guidelines' 1.5px state ring at the 44px on-screen badge size
// (44 × 0.035 ≈ 1.5); HAIRLINE_FRACTION lands on its 1px idle hairline.
// Fractions, not fixed px, so both stay proportional when the label-size
// stepper or the bird's-eye zoom scales the badge.
const RING_FRACTION = 0.035;
const HAIRLINE_FRACTION = 0.023;
// The unavailable state's heavier dash (≈ 2.6px at 44).
const BOLD_RING_FRACTION = 0.06;


function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * OPTICAL CENTRING — how far to move a glyph so it LOOKS centred.
 *
 * ⚠️ A GLYPH CENTRED BY ITS BOX CAN LOOK OFF-CENTRE (owner, 2026-09-26: "the
 * vertical alignment is still not right", the lock in its red ring). Measured
 * on the owner's screenshot, the lock's ink BOX was centred in its ring to half
 * a pixel — and its ink MASS sat 1.8 px lower: a thin shackle over a heavy
 * body. The fan beside it: mass and box within 0.3 px, and it read as centred.
 * The eye judges the mass. So a glyph is placed with the point OPTICAL_CORRECTION
 * of the way from its ink box's centre to its ink mass's centre on the chip's
 * centre — half: the box alone reads low, the mass alone over-corrects (the
 * shackle then crowds the top). Measured from the ink, not the viewBox, so a
 * drawing whose box is itself off-centre in lucide's 24-unit frame (droplets)
 * is centred too.
 *
 * Pure over an alpha raster (its centre is the chip's), so tests/oracles drive
 * it without a canvas. Returns the nudge in raster pixels.
 */
export const OPTICAL_CORRECTION = 0.5;
export function inkNudge(alpha: ArrayLike<number>, size: number, correction = OPTICAL_CORRECTION): { dx: number; dy: number } {
  let x0 = size, x1 = -1, y0 = size, y1 = -1, sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = alpha[y * size + x];
      if (a <= 0) continue;
      sum += a; sx += a * x; sy += a * y;
      if (a > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (sum === 0 || x1 < 0) return { dx: 0, dy: 0 };
  const c = (size - 1) / 2;
  const at = (box: number, mass: number) => box + correction * (mass - box);
  return { dx: c - at((x0 + x1) / 2, sx / sum), dy: c - at((y0 + y1) / 2, sy / sum) };
}

const NUDGE_RASTER = 96;
const nudgeCache = new Map<string, { dx: number; dy: number }>();
/** An icon's optical nudge in VIEWBOX units, measured once from its own ink. */
function opticalNudge(iconKey: string): { dx: number; dy: number } {
  const cached = nudgeCache.get(iconKey);
  if (cached) return cached;
  let out = { dx: 0, dy: 0 };
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = c?.getContext("2d");
  if (c && ctx) {
    c.width = c.height = NUDGE_RASTER;
    const k = NUDGE_RASTER / ICON_VIEWBOX;
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, k, 0, "#000");
    const data = ctx.getImageData(0, 0, NUDGE_RASTER, NUDGE_RASTER).data;
    const alpha = new Uint8ClampedArray(NUDGE_RASTER * NUDGE_RASTER);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const px = inkNudge(alpha, NUDGE_RASTER);
    out = { dx: px.dx / k, dy: px.dy / k };
  }
  nudgeCache.set(iconKey, out);
  return out;
}

function drawIcon(
  ctx: CanvasRenderingContext2D, primitives: readonly IconPrimitive[], scale: number, offset: number, strokeStyle: string,
  bold = false,
  /**
   * Cancels the INSET's effect on stroke weight — pass canvas size ÷ squircle
   * size, which is 1 whenever there is no inset.
   *
   * ⚠️ Without it a stroke stated in viewBox units renders at a weight that
   * depends on how much transparent margin the caller asked for, because
   * `scale` is derived from the squircle and the squircle is what the inset
   * shrinks. A lone Card badge insets its chip by 10% a side and a summary
   * card's cell does not, so THE SAME STYLE drew its glyphs at two weights 20%
   * apart — reported as the bold weight working on grouped badges and not on
   * single ones. One style, one weight: that is the whole job of this factor.
   */
  strokeScale = 1,
  /** The optical-centring nudge, in viewBox units (opticalNudge). */
  nudge: { dx: number; dy: number } = { dx: 0, dy: 0 },
): void {
  ctx.save();
  ctx.translate(offset + nudge.dx * scale, offset + nudge.dy * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = strokeStyle;
  // ctx is already scaled by `scale`, so a viewBox-unit width renders
  // proportionally to the icon — see ICON_STROKE_VIEWBOX. That is also why the
  // bold weight is a viewBox constant and not a pixel one: it has to survive
  // the label-size stepper and the zoom cap without being re-derived.
  ctx.lineWidth = (bold ? ICON_STROKE_VIEWBOX_BOLD : ICON_STROKE_VIEWBOX) * strokeScale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [tag, attrs] of primitives) {
    ctx.beginPath();
    if (tag === "path") {
      ctx.stroke(new Path2D(attrs.d));
      continue;
    }
    if (tag === "rect") {
      const x = Number(attrs.x), y = Number(attrs.y), w = Number(attrs.width), h = Number(attrs.height);
      const rx = attrs.rx ? Number(attrs.rx) : 0;
      if (rx > 0) roundRectPath(ctx, x, y, w, h, rx);
      else ctx.rect(x, y, w, h);
    } else if (tag === "circle") {
      ctx.arc(Number(attrs.cx), Number(attrs.cy), Number(attrs.r), 0, Math.PI * 2);
    } else if (tag === "line") {
      ctx.moveTo(Number(attrs.x1), Number(attrs.y1));
      ctx.lineTo(Number(attrs.x2), Number(attrs.y2));
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Baked badge images, keyed by everything that changes their pixels. Each
// value is a base64 PNG data URL of a 128px canvas, so this is real memory,
// and it is MODULE-level — it outlives the scene, so a model reload or a
// sign-out/sign-in remount inherits it rather than starting clean.
//
// Two things make it grow rather than plateau, and both arrived with the
// neutral-by-default redesign: `state` went from a 2-value flag to 4, and
// `theme` entered the key. The theme one is the leak that matters — an
// "auto" kiosk crosses into the night theme at dusk and re-bakes the entire
// set, while every light-theme entry it can never hit again stays resident
// for the life of the tab. On a wall tablet that is never reloaded, that
// repeats every single day.
//
// evictOldest() keeps it to a working set. The cap is generous — a villa's
// live badges are a few hundred entries at most, so ordinary operation never
// evicts; it only trims the dead generations a theme flip leaves behind.
// Map preserves insertion order, so the first key is the least recently
// ADDED, which for a bake-once-per-appearance cache is the right victim.
const CACHE_MAX = 600;
const cache = new Map<string, string>();

function evictOldest(): void {
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

// Baking an INSET (a transparent margin on every side) into the image is a
// deterministic way to pad the glyph — used by the "card" badge style, whose
// squircle sits on a neutral card and needs even breathing room the Babylon
// GUI adaptWidthToChildren + control padding wouldn't give reliably. The
// classic badge passes inset 0 (the squircle fills its own control). 0.10 →
// a ~3.4 px margin at the card's 34 px render. Kept SMALL on purpose: this
// margin is the card's TOP/BOTTOM padding, and a tighter one puts the card's
// outer edge closer to the icon (a shorter, less chunky badge). The
// horizontal breathing room is restored separately via the badge's own left
// padding + the value's right padding, so left/right stay roomy.

/** Render (and cache) the composited squircle badge for a category + glyph +
 *  live state — the single source of the app's badge icon squares (top bar,
 *  bottom bar and both badge styles all resolve to this same look, via
 *  categorySurface). `colorOverride` (a #rrggbb) is a per-entity badge colour
 *  (EntityMapping.badgeColor) substituting for the category's hue while
 *  "active". `inset` bakes a transparent margin so the squircle can sit
 *  padded inside a larger control (see BADGE_INSET_CARD). Cache key includes
 *  the current theme — fill/glyph/ring are resolved CSS custom properties
 *  (see categorySurface), so a light/dark/night switch must re-bake. */
export function badgeImageDataUrl(
  category: Category, iconKey: string, state: DeviceSurfaceState, colorOverride?: string, inset = 0,
  /** Draw the RING for a different state than the face — see
   *  categorySurfaceRinged. Defaults to `state`, i.e. the ordinary badge. */
  ringState?: DeviceSurfaceState,
  /**
   * Bake NO ring at all — the caller is drawing it itself.
   *
   * The "card" badge style does: its Babylon Rectangle already strokes the
   * badge's edge, and this image sits INSET inside that rectangle. With a ring
   * baked here as well the badge carried two concentric outlines in the same
   * colour, a few pixels apart, with identical fill on both sides of the gap —
   * a nested-square artefact rather than the chip-inside-a-card it was meant to
   * be, and most obvious exactly where the badge is quietest (a resting badge,
   * where both outlines are the same faint hairline).
   *
   * The one state that must keep its baked ring is `unavailable`: Babylon GUI
   * has no dashed border, so the dash can only come from this canvas. That case
   * passes inset 0 and the caller stands its own rectangle down instead — the
   * same trade in the other direction.
   */
  suppressRing = false,
  /**
   * How large this image will actually be DRAWN, in the same render pixels
   * Babylon GUI sizes controls in. Selects the bake size off BAKE_LADDER so the
   * GUI's drawImage barely resamples — see that constant for why resampling was
   * the whole bug. Omit only if the drawn size is genuinely unknown.
   */
  pxHint = 0,
  /**
   * Draw the glyph at the heavier weight — see ICON_STROKE_VIEWBOX_BOLD.
   *
   * Passed by the CARD badge style only. It is an argument rather than a read
   * of `config.badgeStyle` because this module knows nothing about config and
   * must not start to: it is a pure canvas baker, and its cache key is the
   * complete description of the picture it returns.
   */
  boldGlyph = false,
  /**
   * The ring's weight as a fraction of the squircle — a CARD-style badge's
   * (badgeLook.badgeRing ÷ its size), so a group's chip rings like the lone
   * card beside it. Omitted: the classic style's own fractions.
   */
  ringOfSize?: number,
): string {
  const theme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") ?? "" : "";
  // ringState is part of the key: two badges alike in every other respect but
  // ringed differently are different pictures, and a cache that conflated them
  // would serve whichever was baked first.
  const ring = ringState ?? state;
  // Size is part of the key: the same badge baked for a 48px control and a
  // 128px one are different pictures, and serving the small one to the large
  // control is the blur this whole mechanism exists to remove.
  const px = bakeSizeFor(pxHint);
  // Weight is part of the key for the same reason size is: the two weights are
  // two different pictures, and a cache that conflated them would serve
  // whichever style happened to bake first to both of them.
  const cacheKey = `${category}:${iconKey}:${state}:${ring}:${colorOverride ?? ""}:${inset}:${suppressRing}:${theme}:${px}:${boldGlyph}:${ringOfSize ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    const surface = categorySurfaceRinged(category, state, ring, colorOverride);
    const m = px * inset;                   // transparent margin
    const size = px - 2 * m;                // the squircle itself
    const corner = size * BADGE_CORNER_FRACTION;

    roundRectPath(ctx, m, m, size, size, corner);
    ctx.fillStyle = surface.fill;
    ctx.fill();

    // The ring, straight from the guidelines' badge table: 1px --hairline when
    // idle, 1.5px in the state colour when active/alerting, 1.5px DASHED amber
    // when unavailable. Every state has one — which is also what keeps a
    // resting badge legible against both a bright white ceiling and dark night
    // grass, so there is no separate hardcoded edge any more.
    if (surface.ring && !suppressRing) {
      // Floors are ONE pixel, not two, and that changed with the bake size in
      // 2.301.0. The canvas used to be a fixed 128px that the GUI then shrank,
      // so a floor of 2 there was ~0.7px once drawn and never actually bound —
      // 128 × 0.035 is 4.5. Now the canvas IS the drawn size, so a floor of 2
      // would bind on every badge below 57px and thicken every ring in the app
      // by up to 68%. At 1 the rendered result is identical to what shipped
      // before: 48 × 0.035 = 1.68px either way.
      const ringPx = ringOfSize !== undefined
        ? Math.max(1, size * ringOfSize)
        : surface.ringHairline
          ? Math.max(1, size * HAIRLINE_FRACTION)
          : Math.max(1, size * (surface.ringBold ? BOLD_RING_FRACTION : RING_FRACTION));
      ctx.save();
      roundRectPath(ctx, m + ringPx / 2, m + ringPx / 2, size - ringPx, size - ringPx, Math.max(0, corner - ringPx / 2));
      ctx.lineWidth = ringPx;
      ctx.strokeStyle = surface.ring;
      if (surface.ringDashed) ctx.setLineDash([ringPx * RING_DASH[0], ringPx * RING_DASH[1]]);
      ctx.stroke();
      ctx.restore();
    }

    const iconScale = (size / ICON_VIEWBOX) * iconFraction();
    const iconPx = ICON_VIEWBOX * iconScale;
    const offset = (px - iconPx) / 2;       // centred in the canvas = in the squircle
    // `px / size` is 1 for every uninset caller, so this changes nothing for
    // them and makes the inset ones agree with them — see drawIcon's
    // strokeScale.
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, iconScale, offset, surface.glyph,
      boldGlyph, size > 0 ? px / size : 1, opticalNudge(iconKey));

    url = canvas.toDataURL("image/png");
  }
  cache.set(cacheKey, url);
  evictOldest();
  return url;
}

