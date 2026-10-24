// The (i) is the icon alone, everywhere (owner, 2026-10-24: "It shall be a (I) icon only, consistently with any other
// (I) icons": it sat in a grey disc with a ring beside the Advanced Settings headings and "Log out all devices").
//
// Read from every stylesheet in styles.css's @import order, media blocks included: every rule that reaches the (i)'s
// button (`.info-btn`, at the end of a selector, with or without a state) and what it sets. InfoTip's `button`
// variant is a .btn and is not this rule's.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../src/", import.meta.url);
const index = readFileSync(new URL("styles.css", ROOT), "utf8");
const files = [...index.matchAll(/@import "\.\/(styles\/[^"]+)";/g)].map((m) => m[1]);
const rules = [];
for (const f of files) {
  const css = readFileSync(new URL(f, ROOT), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // innermost blocks: a selector and its declarations (an @media's own braces only wrap them)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ f, sel: m[1].trim(), body: m[2] });
}
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();
const mine = rules.filter((r) => r.sel.split(",").some((s) => /\.info-btn(:[\w-]+)*\s*$/.test(s.trim())));

ck("the (i)'s button is styled somewhere", mine.length > 0);
for (const r of mine) {
  const bg = decl(r.body, "background") ?? decl(r.body, "background-color");
  ck(`${r.sel} (${r.f}): no disc`, bg === undefined || /^(none|transparent)$/.test(bg), bg);
  const border = decl(r.body, "border");
  ck(`${r.sel} (${r.f}): no ring`, border === undefined || /^(none|0)$/.test(border), border);
  ck(`${r.sel} (${r.f}): no shadow`, decl(r.body, "box-shadow") === undefined, decl(r.body, "box-shadow"));
}
const sizes = mine.flatMap((r) => ["width", "height"].map((p) => decl(r.body, p)).filter(Boolean));
ck("its tap area stays 24 px at least wherever it is sized", sizes.length > 0 && sizes.every((v) => parseFloat(v) >= 24), sizes);
ck("it still lights on hover", mine.some((r) => /:hover/.test(r.sel) && decl(r.body, "color")));
ck("it still shows a focus ring", mine.some((r) => /:focus-visible/.test(r.sel) && /solid/.test(decl(r.body, "outline") ?? "")));

done("✅ the (i) is the icon alone, with its tap area, hover colour and focus ring");
