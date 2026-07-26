// src/babylon/badgeIcons.ts
// Renders the in-scene state badge: a fixed, category-coloured gradient
// squircle (see config/EntityCategories.CATEGORY_COLORS) with a thick white
// line-art icon (badgeIconNodes.ts, vendored from lucide — see
// badgeIconKeys.ts for which glyph each entity gets) centred on it. The
// background no longer encodes live state (see EntityVisuals.updateLabel for
// the "on" outline ring that replaces it) — composited once per (category,
// iconKey) pair and cached as a data URL, same draw-once-cache approach the
// old emoji glyphs used.

import type { Category } from "@/types/scene.types";
import { CATEGORY_COLORS } from "@/config/EntityCategories";
import { ICON_NODES, type IconPrimitive } from "./badgeIconNodes";

// Rendered oversized relative to the badge's on-screen size (EntityVisuals'
// BADGE_DIAMETER_PX) so it stays crisp when the user's label-size stepper or
// the bird's-eye zoom scales the badge up.
const CANVAS_PX = 128;
const ICON_VIEWBOX = 24; // lucide's own viewBox is 0-24
const ICON_FRACTION = 0.56; // icon size as a fraction of the badge
// Stroke in lucide VIEWBOX units — i.e. PROPORTIONAL to the icon, exactly like
// the real lucide components the top bar renders (their default stroke-width is
// 2 on this same 24 viewBox). It used to be an ABSOLUTE display-pixel width,
// which meant a smaller icon kept the same thick stroke and so read as BOLD —
// very visible on the "card" badge style, whose inset squircle is smaller than
// the classic one. Proportional keeps one consistent line style at every size.
const ICON_STROKE_VIEWBOX = 2;
/** Squircle corner radius as a fraction of the badge's size — exported so
 *  EntityVisuals' outline Rectangle can match this canvas's rounding exactly. */
export const BADGE_CORNER_FRACTION = 0.28;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawIcon(ctx: CanvasRenderingContext2D, primitives: readonly IconPrimitive[], scale: number, offset: number): void {
  ctx.save();
  ctx.translate(offset, offset);
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#ffffff";
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

/** Lighten/darken a #rrggbb hex by `amt` (-1..1) so a single user-picked colour
 *  yields the same top→bottom gradient the per-category presets use. */
function shade(hex: string, amt: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = adj(parseInt(m[1], 16)), g = adj(parseInt(m[2], 16)), b = adj(parseInt(m[3], 16));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Baking an INSET (a transparent margin on every side) into the image is a
// deterministic way to pad the glyph — used by the "card" badge style, whose
// gradient squircle sits on a neutral card and needs even breathing room the
// Babylon GUI adaptWidthToChildren + control padding wouldn't give reliably.
// The classic badge passes inset 0 (the squircle fills its own control).
// 0.10 → a ~3.4 px margin at the card's 34 px render. Kept SMALL on purpose:
// this margin is the card's TOP/BOTTOM padding, and a tighter one puts the
// card's outer edge closer to the icon (a shorter, less chunky badge). The
// horizontal breathing room is restored separately via the badge's own left
// padding + the value's right padding, so left/right stay roomy.
export const BADGE_INSET_CARD = 0.10;

/** Render (and cache) the composited GRADIENT squircle badge for a category +
 *  glyph — the single source of the app's gradient icon squares (top bar,
 *  bottom bar and both badge styles all resolve to this same look).
 *  `colorOverride` (a #rrggbb) replaces the category's preset gradient with one
 *  derived from that single colour — the per-entity badge colour a user sets
 *  from the device panel (persisted on EntityMapping.badgeColor). `inset` bakes
 *  a transparent margin so the squircle can sit padded inside a larger control
 *  (see BADGE_INSET_CARD). */
export function badgeImageDataUrl(
  category: Category, iconKey: string, colorOverride?: string, inset = 0,
): string {
  const cacheKey = `${category}:${iconKey}:${colorOverride ?? ""}:${inset}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    const colors = colorOverride
      ? { top: shade(colorOverride, 0.12), bottom: shade(colorOverride, -0.12) }
      : CATEGORY_COLORS[category];
    const m = CANVAS_PX * inset;            // transparent margin
    const size = CANVAS_PX - 2 * m;         // the squircle itself
    const corner = size * BADGE_CORNER_FRACTION;

    const grad = ctx.createLinearGradient(m, m, m + size * 0.3, m + size);
    grad.addColorStop(0, colors.top);
    grad.addColorStop(1, colors.bottom);
    roundRectPath(ctx, m, m, size, size, corner);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle bottom-edge shading for the slight bevel/depth of the reference look.
    ctx.save();
    roundRectPath(ctx, m, m, size, size, corner);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(m, m + size * 0.92, size, size * 0.08);
    ctx.restore();

    const iconScale = (size / ICON_VIEWBOX) * ICON_FRACTION;
    const iconPx = ICON_VIEWBOX * iconScale;
    const offset = (CANVAS_PX - iconPx) / 2; // centred in the canvas = in the squircle
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, iconScale, offset);

    url = canvas.toDataURL("image/png");
  }
  cache.set(cacheKey, url);
  return url;
}
