// The Spend tab's layout (owner, 2026-10-14): the month's Minor / Major / Total share the width equally, each word
// ABOVE its amount; the statement's three buttons are one group that never splits (Download .md fell alone onto a
// second line); Spend settings reads as one paragraph and "Remove cap" sits with Cancel and Save, drawn as they are.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const tab = src("components/fm/SpendTab.tsx"), terms = src("components/fm/ContractTermsEditor.tsx");
const actions = src("components/fm/FormActions.tsx"), css = src("styles/07-facility.css");

console.log("  the month's totals:");
const totals = [...tab.matchAll(/<div className="fm-cap-total"><span className="muted">([^<]*?)(?:\{[^<]*\})?<\/span><strong>/g)];
ck("three totals, each its word first (above) then its amount", totals.length === 3, totals.length);
ck("  ...sharing the width equally, Record spend at their right",
   /\.fm-cap-totals \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) auto;/.test(css)
   && /\.fm-cap-total \{ display: flex; flex-direction: column;/.test(css));

console.log("\n  the statement's buttons:");
const group = tab.match(/<div className="fm-statement-buttons">([\s\S]*?)\n        <\/div>/);
ck("Generate, Save and Download .md are ONE group", !!group && /Generate statement/.test(group[1]) && /<SaveButton/.test(group[1]) && /Download \.md/.test(group[1]));
ck("  ...that does not wrap apart (a phone excepted)", /\.fm-statement-buttons \{ display: flex; flex-wrap: nowrap;/.test(css));

console.log("\n  Spend settings:");
// owner, 2026-10-22: no visible description text — the words are the title's ONE (i)
ck("its words are ONE (i) on its title, no paragraph", (terms.match(/<p className/g) || []).length === 0
   && /<h3 className="with-tip">Spend settings\s*<InfoTip /.test(terms));
ck("Remove cap is drawn by the form's actions, on the left of Cancel",
   /extra=\{cap\.trim\(\) !== "" && \(\s*<button type="button" className="btn ghost"[^>]*>[\s\S]*?Remove cap<\/button>/.test(terms)
   && /\{extra\}\s*<button className="btn ghost" onClick=\{onCancel\}>/.test(actions)
   && !/<div className="row" style=\{\{ gap: 8 \}\}>/.test(terms));

done("✅ the Spend tab: equal totals, word above amount; statement buttons together; settings compact");
