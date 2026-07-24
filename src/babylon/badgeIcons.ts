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
const DISPLAY_PX = 40;
const RENDER_SCALE = CANVAS_PX / DISPLAY_PX;
const ICON_VIEWBOX = 24; // lucide's own viewBox is 0-24
const ICON_FRACTION = 0.56; // icon size as a fraction of the badge
const STROKE_DISPLAY_PX = 2.6; // desired stroke thickness AT DISPLAY size
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
  ctx.lineWidth = (STROKE_DISPLAY_PX * RENDER_SCALE) / scale;
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

/** Render (and cache) the composited squircle badge for a category + glyph.
 *  `colorOverride` (a #rrggbb) replaces the category's preset gradient with one
 *  derived from that single colour — the per-entity badge colour a user sets
 *  from the device panel (persisted on EntityMapping.badgeColor). */
export function badgeImageDataUrl(category: Category, iconKey: string, colorOverride?: string): string {
  const cacheKey = `${category}:${iconKey}:${colorOverride ?? ""}`;
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
    const corner = CANVAS_PX * BADGE_CORNER_FRACTION;

    const grad = ctx.createLinearGradient(0, 0, CANVAS_PX * 0.3, CANVAS_PX);
    grad.addColorStop(0, colors.top);
    grad.addColorStop(1, colors.bottom);
    roundRectPath(ctx, 0, 0, CANVAS_PX, CANVAS_PX, corner);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle bottom-edge shading for the slight bevel/depth of the reference look.
    ctx.save();
    roundRectPath(ctx, 0, 0, CANVAS_PX, CANVAS_PX, corner);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, CANVAS_PX * 0.92, CANVAS_PX, CANVAS_PX * 0.08);
    ctx.restore();

    const iconScale = (CANVAS_PX / ICON_VIEWBOX) * ICON_FRACTION;
    const iconPx = ICON_VIEWBOX * iconScale;
    const offset = (CANVAS_PX - iconPx) / 2;
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, iconScale, offset);

    url = canvas.toDataURL("image/png");
  }
  cache.set(cacheKey, url);
  return url;
}

const chipCache = new Map<string, string>();

// The chip is drawn INSET inside its (transparent) canvas by this fraction on
// every side — so when EntityVisuals renders the image at the card's full
// height, that transparent margin lets the solid coloured card show through
// EVENLY on all four sides. Baking the padding into the image is deterministic
// (it's just pixels), unlike Babylon GUI's adaptWidthToChildren + control
// padding, which wasn't producing a reliable, symmetric inset for the card.
const CHIP_INSET = 0.15;             // ~6 px at a 40 px render
const CHIP_ICON_FRACTION = 0.62;     // icon size as a fraction of the CHIP (not the canvas)

/** Icon glyph for the "card" badge style (config.badgeStyle): a translucent-
 *  white rounded chip (inset, see CHIP_INSET) with a white icon, on a
 *  TRANSPARENT background — meant to sit inside a solid category-coloured card
 *  (EntityVisuals card badges), where the full category-coloured squircle
 *  badgeImageDataUrl() produces would blend into the same-coloured card. Icon
 *  only, no category colour, so it's cached by iconKey alone. */
export function iconChipDataUrl(iconKey: string): string {
  const cached = chipCache.get(iconKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    const margin = CANVAS_PX * CHIP_INSET;
    const chip = CANVAS_PX - 2 * margin;
    const corner = chip * BADGE_CORNER_FRACTION;
    roundRectPath(ctx, margin, margin, chip, chip, corner);
    ctx.fillStyle = "rgba(255,255,255,0.22)"; // translucent chip on the card
    ctx.fill();

    const iconScale = (chip / ICON_VIEWBOX) * CHIP_ICON_FRACTION;
    const iconPx = ICON_VIEWBOX * iconScale;
    const offset = (CANVAS_PX - iconPx) / 2; // centre the icon in the whole canvas
    drawIcon(ctx, ICON_NODES[iconKey] ?? ICON_NODES.gauge, iconScale, offset);

    url = canvas.toDataURL("image/png");
  }
  chipCache.set(iconKey, url);
  return url;
}
