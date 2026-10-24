// No visible description text in Settings, Advanced Settings and the Cockpit (owner, 2026-10-22): what an option or a
// section is for is read in ONE (i) beside its title (common/InfoTip, opened by a tap on every phone), never in a
// paragraph under it. Data, status, short empty states, errors and warnings stay visible.
//
// Reads the compiler's tree of every screen there: a grey paragraph (<p className="muted …">) of more than a short
// line is an explanation, and is refused; the old hint classes are gone.
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../src/", import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
for (const d of ["components/settings", "components/cockpit", "components/fm"]) walk(ROOT + d);
// not a Settings or Cockpit screen: the guest's own report window, and a document's own text
const NOT_HERE = new Set(["components/fm/GuestReportModal.tsx", "components/fm/MarkdownPreview.tsx"]);
/** The longest line a grey paragraph may hold and still be a status ("No tasks yet.", "Nothing generated yet for …"). */
const MAX_WORDS = 8;

/** The grey paragraphs of one source that explain, as "file:line words". */
export function explanations(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  (function visit(n) {
    if (ts.isJsxElement(n)) {
      const open = n.openingElement;
      const cls = open.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "className");
      const clsText = cls && ts.isJsxAttribute(cls) && cls.initializer ? cls.initializer.getText(sf) : "";
      if (open.tagName.getText(sf) === "p" && /\bmuted\b|field-hint/.test(clsText)) {
        const words = n.children.filter(ts.isJsxText).map((c) => c.getText(sf)).join(" ").split(/\s+/).filter(Boolean);
        if (words.length > MAX_WORDS) out.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${words.slice(0, 10).join(" ")}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

console.log("  the rule, by value:");
ck("an explanation in a grey paragraph is found; a short status is not",
   explanations("a.tsx", `const a = <p className="muted body-text">Each task repeats at the interval you set, and the board shows it.</p>;`).length === 1
   && explanations("b.tsx", `const b = <p className="muted body-text">No tasks yet.</p>;`).length === 0
   && explanations("c.tsx", `const c = <p className="muted body-text field-hint">Drives the sun's position and day and night for this villa.</p>;`).length === 1);

console.log("\n  Settings, Advanced Settings and the Cockpit:");
const found = files.filter((f) => !NOT_HERE.has(f.slice(ROOT.length)))
  .flatMap((f) => explanations(f.slice(ROOT.length), readFileSync(f, "utf8")));
ck(`no grey paragraph explains anything (${files.length} screens)`, files.length > 30 && found.length === 0, found);
const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
ck("  ...the old hint classes are gone", !/fm-form-intro|fm-kept-note|fm-card-text/.test(all));
const advanced = readFileSync(ROOT + "components/settings/ConfigEditorModal.tsx", "utf8");
const settings = readFileSync(ROOT + "components/settings/SettingsModal.tsx", "utf8");
ck("  ...each section's explanation is its title's (i) (TipTitle), and Settings' options carry theirs",
   (advanced.match(/<TipTitle title=/g) ?? []).length >= 7 && (settings.match(/<InfoTip label=/g) ?? []).length >= 4);
{
  const { h, draw } = await import("../consistency/screen.mjs");
  const InfoTip = (await import("@/components/common/InfoTip")).default;
  const drawn = draw(h(InfoTip, { label: "About the north offset" }, "What it does."));
  // that a tap opens it is info_tip.mjs's ("one (i), opened by a tap")
  ck("the (i) is a real button with a name, closed until opened",
     /<button type="button" class="info-btn" aria-label="About the north offset" aria-expanded="false">/.test(drawn), drawn.slice(0, 200));
}

done("✅ no visible description text: every explanation is one (i)");
