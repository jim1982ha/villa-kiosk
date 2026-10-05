// src/components/common/categoryChip.ts
// How a CATEGORY's icon chip is coloured on screen — one answer for the
// Cockpit's category tiles and the top bar's category buttons (2.496.272).
// The colours are categorySurface's (config/EntityCategories): a category's
// own tint and glyph colour when "on", the neutral surface with the
// category-coloured glyph at rest — the same rule the map's badges follow.
//
// ⚠️ THE TOP BAR PAINTED EVERY SHOWN CATEGORY THE APP'S ACCENT GREEN while the
// Cockpit, the legend and the map coloured each by its own category (owner,
// 2026-10-04: "colour the top category icons the same way … fully reusing
// same code"). Both now read their colours here.
//
// The surface is composited in JS from the theme's tokens, so a caller must
// re-render when the theme changes (useResolvedTheme) — the Cockpit keys its
// tiles by theme, the top bar reads the hook.

import type { CSSProperties } from "react";
import { categorySurface } from "@/config/EntityCategories";
import type { Category } from "@/types/scene.types";

/** The chip's inline colours: `on` — the category's tinted surface; at rest
 *  the neutral one, its glyph still in the category's colour. */
export function categoryChipStyle(category: Category, on: boolean): CSSProperties {
  const s = categorySurface(category, on ? "active" : "off");
  return { background: s.fill, color: s.glyph };
}
