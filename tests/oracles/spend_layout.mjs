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

console.log("\n  the recap's buttons (the recap and the statement one document, owner 2026-11-05):");
const group = tab.match(/<div className="fm-statement-buttons">([\s\S]*?)\n        <\/div>/);
// Save and Download .md are DocumentButtons since 2026-10-22: drawn only with a recap (document_buttons below)
ck("Generate, Save and Download .md are ONE group", !!group && /Generate recap/.test(group[1]) && /<DocumentButtons markdown=\{recap\.markdown\}/.test(group[1])
   && !/statement/i.test(group[1]));

console.log("\n  Save and Download .md only with something to save (owner, 2026-10-22):");
{
  const { h, draw } = await import("../consistency/screen.mjs");
  const { DocumentButtons } = await import("@/components/common/SaveButton");
  const props = { saved: false, saveLabel: "Save recap", onSave: () => {}, onDownload: () => {} };
  const none = draw(h(DocumentButtons, { ...props, markdown: "" })), shown = draw(h(DocumentButtons, { ...props, markdown: "# Recap" }));
  ck("nothing generated: neither button is drawn (never greyed out beside nothing)", !/<button/.test(none), none);
  ck("  ...a recap generated: Save recap and Download .md, both live",
     /Save recap/.test(shown) && /Download \.md/.test(shown) && !/disabled/.test(shown), shown);
  ck("  ...the Spend tab's recap draws them through it", /<DocumentButtons markdown=\{recap\.markdown\}/.test(tab));
}
ck("  ...that does not wrap apart (a phone excepted)", /\.fm-statement-buttons \{ display: flex; flex-wrap: nowrap;/.test(css));

console.log("\n  the tab's order (owner, 2026-11-05):");
{
  const { parseTsx, elements, propText } = await import("../consistency/jsx.mjs");
  const fn = parseTsx("components/fm/SpendTab.tsx").statements.find((st) => st.name?.getText() === "SpendTab");
  const ret = fn.body.statements.at(-1);   // its drawing: the last statement, `return (…)`
  const divs = elements(ret, "div");
  const at = (pick) => { const e = divs.find((d) => pick(String(propText(d, "className") ?? ""))); return e ? e.getStart() : -1; };
  const recapTitle = divs.find((d) => propText(d, "className") === '"settings-section-title"');
  const formAt = ret.getText().indexOf("{editor.adding && form}") + ret.getStart();
  const order = [
    ["Spend settings", elements(ret, "ContractTermsEditor")[0]?.getStart() ?? -1],
    ["the month's money", at((c) => c.startsWith("`fm-cap "))],
    ["a new entry's form", formAt],
    ["the entries", at((c) => c === '"fm-list"')],
    ["the section title", recapTitle?.getStart() ?? -1],
    ["the Month and its recap's buttons", at((c) => c === '"fm-statement-row"')],
    ["the recap's preview", elements(ret, "MarkdownPreview")[0]?.getStart() ?? -1],
    ["the saved recaps", elements(ret, "SavedDocumentsList")[0]?.getStart() ?? -1],
  ];
  ck("settings, the month's money card, a new entry's form, the entries, then \"Monthly recap\": the Month, its preview, its saved copies",
     order.every(([, n], i) => n >= 0 && (i === 0 || order[i - 1][1] < n)) && recapTitle?.children.map((c) => c.getText()).join("").trim() === "Monthly recap",
     order);
}

console.log("\n  Spend settings:");
// owner, 2026-10-22: no visible description text — the words are the title's ONE (i)
ck("its words are ONE (i) on its title, no paragraph", (terms.match(/<p className/g) || []).length === 0
   && /<h3 className="with-tip">Spend settings\s*<InfoTip /.test(terms));
ck("Remove cap is drawn by the form's actions, on the left of Cancel",
   /extra=\{cap\.trim\(\) !== "" && \(\s*<button type="button" className="btn ghost"[^>]*>[\s\S]*?Remove cap<\/button>/.test(terms)
   && /\{extra\}\s*<button className="btn ghost" onClick=\{onCancel\}>/.test(actions)
   && !/<div className="row" style=\{\{ gap: 8 \}\}>/.test(terms));

done("✅ the Spend tab: equal totals, word above amount; statement buttons together; settings compact");
