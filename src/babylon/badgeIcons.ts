// src/babylon/badgeIcons.ts
// Renders the in-scene state badge: a rounded squircle whose fill/glyph/ring
// come from config/EntityCategories.categorySurface — neutral by default,
// coloured only when the device is active or alerting (see VESTA-DESIGN.md
// §0). Composited once per (category, iconKey, state, theme) and cached as a
// data URL, same draw-once-cache approach the old emoji glyphs used.

import type { Category } from "@/types/scene.types";
import { categorySurface, type DeviceSurfaceState } from "@/config/EntityCategories";
import { ICON_NODES, type IconPrimitive } from "./badgeIconNodes";

// Rendered oversized relative to the badge's on-screen size (EntityVisuals'
// BADGE_DIAMETER_PX) so it stays crisp when the user's label-size stepper or
// the bird's-eye zoom scales the badge up.
const CANVAS_PX = 128;
const ICON_VIEWBOX = 24; // lucide's own viewBox is 0-24
const ICON_FRACTION = 0.56; // icon size as a fraction of the badge
// Stroke in lucide VIEWBOX units — i.e. PROPORTIONAL to the icon, exactly like
// the real lucide components the top bar renders. 1.5 matches the app-wide
// icon standard (EntityCategories' CATEGORY_ICONS, the top bar, chips — see
// VESTA-DESIGN.md §1.3): one stroke weight everywhere, never a filled glyph.
const ICON_STROKE_VIEWBOX = 1.5;
/** Squircle corner radius as a fraction of the badge's size — exported so
 *  EntityVisuals' outline Rectangle can match this canvas's rounding exactly.
 *  Approximates --radius-badge (12px) at the classic badge's typical ~40-44px
 *  on-screen size; a fraction (not a fixed px) so it still looks right when
 *  the label-size stepper scales the badge up or down. */
export const BADGE_CORNER_FRACTION = 0.28;
// Ring stroke as a fraction of the badge, landing close to --stroke-icon
// (1.5px) at typical on-screen badge size.
const RING_FRACTION = 0.035;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawIcon(
  ctx: CanvasRenderingContext2D, primitives: readonly IconPrimitive[], scale: number, offset: number, strokeStyle: string,
): void {
  ctx.save();
  ctx.translate(offset, offset);
  ctx.scale(scale, scale);
  ctx.strokeStyle = strokeStyle;
  // ctx is already scaled by `scale`, so a viewBox-unit width renders
  // proportionally to the icon — see ICON_STROKE_VIEWBOX.
  ctx.lineWidth = ICON_STROKE_VIEWBOX;
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

const cache = new Map<string, string>();

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
export const BADGE_INSET_CARD = 0.10;

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
): string {
  const theme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") ?? "" : "";
  const cacheKey = `${category}:${iconKey}:${state}:${colorOverride ?? ""}:${inset}:${theme}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    const surface = categorySurface(category, state, colorOverride);
    const m = CANVAS_PX * inset;            // transparent margin
    const size = CANVAS_PX - 2 * m;         // the squircle itself
    const corner = size * BADGE_CORNER_FRACTION;

    roundRectPath(ctx, m, m, size, size, corner);
    ctx.fillStyle = surface.fill;
    ctx.fill();

    // A thin universal edge so a mostly-neutral badge (the default now — see
    // VESTA-DESIGN.md §0) stays legible against both a bright white ceiling
    // and dark night grass behind it in the 3D scene, regardless of theme.
    ctx.save();
    roundRectPath(ctx, m + 0.5, m + 0.5, size - 1, size - 1, corner);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.stroke();
    ctx.restore();

    if (surface.ring) {
      const ringPx = Math.max(2, size * RING_FRACTION);
      ctx.save();
      roundRectPath(ctx, m + ringPx / 2, m + ringPx / 2, size - ringPx, size - ringPx, Math.max(0, corner - ringPx / 2));
      ctx.lineWidth = ringPx;
      ctx.strokeStyle = surface.ring;
      if (surface.ringDashed) ctx.setLineDash([ringPx * 2.2, ringPx * 1.8]);
      ctx.stroke();
      ctx.restore();
    }

    const iconScale = (size / ICON_VIEWBOX) * ICON_FRACTION;
    const iconPx = ICON_VIEWBOX * iconScale;
    const offset = (CANVAS_PX - iconPx) / 2; // centred in the canvas = in the squircle
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, iconScale, offset, surface.glyph);

    url = canvas.toDataURL("image/png");
  }
  cache.set(cacheKey, url);
  return url;
}
