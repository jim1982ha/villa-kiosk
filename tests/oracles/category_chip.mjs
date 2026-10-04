// A category's icon chip, coloured ONE way (src/components/common/categoryChip.ts,
// 2.496.272): the top bar painted every shown category the accent green while the
// Cockpit coloured each by its own category (owner, 2026-10-04: "the same way …
// fully reusing same code").
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { categoryChipStyle } = await import("@/components/common/categoryChip");
const { categorySurface, CATEGORY_ORDER } = await import("@/config/EntityCategories");

ck("on: the category's own tinted surface and glyph colour; at rest: the neutral surface, glyph still the category's",
   CATEGORY_ORDER.every((c) => {
     const on = categoryChipStyle(c, true), off = categoryChipStyle(c, false);
     const a = categorySurface(c, "active"), r = categorySurface(c, "off");
     return on.background === a.fill && on.color === a.glyph && off.background === r.fill && off.color === r.glyph;
   }));
ck("  ...each category its own colour (not one accent for all)",
   new Set(CATEGORY_ORDER.map((c) => categoryChipStyle(c, true).color)).size === CATEGORY_ORDER.length);
const rd = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const hud = rd("components/hud/HUD.tsx"), cockpit = rd("components/cockpit/CockpitModal.tsx");
ck("the Cockpit's category tiles and the top bar's category buttons both ask categoryChipStyle",
   /categoryChipStyle\(t\.category, t\.stats\.onCount > 0\)/.test(cockpit) && /style=\{categoryChipStyle\(cat, !hidden\)\}/.test(hud)
   && !/categorySurface\(t\.category/.test(cockpit));
ck("  ...and the top bar's buttons no longer take the accent `.active` fill",
   /className=\{`icon-btn hud-cat-btn\$\{hidden \? " is-hidden" : ""\}`\}/.test(hud) && /useResolvedTheme\(\);/.test(hud));
done("✅ a category's chip is coloured one way, in the Cockpit and the top bar");
