// A checkbox with its description after it is ONE component (components/common/CheckField), one look (owner,
// 2026-10-15: "make sure the same style is consistently applied wherever a text description follows a checkbox") —
// drawn here, and no screen draws its own.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: CheckField } = await import("@/components/common/CheckField");
const html = renderToStaticMarkup(h(CheckField, { checked: true, onChange: () => {}, title: "why" }, "Confirm before toggling"));
ck("drawn: the box then its words, inside one .check-field label",
   /^<label class="check-field" title="why"><input type="checkbox" checked=""\/><span>Confirm before toggling<\/span><\/label>$/.test(html), html);

const root = new URL("../../src", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
const own = walk(root).filter((f) => f.endsWith(".tsx") && /type="checkbox"/.test(readFileSync(f, "utf8")))
  .map((f) => f.slice(root.length + 1)).sort();
// EntityMapRow's is the device card's "show in 3D" box: no words after it (its aria-label says what it is)
ck("no screen draws a checkbox of its own but CheckField and the device card's bare show-in-3D box",
   own.join() === "components/common/CheckField.tsx,components/settings/EntityMapRow.tsx", own);
const css = readFileSync(new URL("../../src/styles/04-modals.css", import.meta.url), "utf8");
// ⚠️ THE CASCADE, NOT THE TEXT (2.496.378): a bare .check-field rule was in the file and lost to `.modal label` /
// `.modal-body label` (display: block) — every dialog label rule must be outranked by name, and its margin reset
// (the label rules that LAY OUT a label — set its display — are the ones that win against ours)
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");          // comments stripped: a brace in one is not a rule
const labelRules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /display:/.test(m[2]))
  .flatMap((m) => m[1].split(",").map((x) => x.trim())).filter((x) => /^\.[\w-]+ label$/.test(x));
const ours = css.match(/(label\.check-field[^{]*)\{([^}]*)\}/);
ck("the rule outranks every dialog label rule by name (.modal label, .modal-body label…) and resets its margin",
   !!ours && labelRules.length >= 2 && labelRules.every((r) => ours[1].includes(`${r}.check-field`))
   && /display: inline-flex;/.test(ours[2]) && /margin: 0;/.test(ours[2]), { labelRules, ours: ours?.[1] });
ck("the space between box and words is the rule's, one value, never a caller's inline gap",
   /\.check-field[^{]*\{[^}]*gap: 10px;/.test(css) && /\.check-field input\[type="checkbox"\] \{/.test(css)
   && !/style=\{\{ gap: 6, fontSize: "var\(--text-xs\)"/.test(readFileSync(new URL("../../src/components/settings/MappingFields.tsx", import.meta.url), "utf8")));
done("✅ one checkbox-with-words, one look");
