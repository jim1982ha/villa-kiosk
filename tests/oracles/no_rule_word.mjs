// An automation of the villa's system is an "automation" — never a "rule" — in anything the Kiosk shows (owner's
// standing rule, 2026-10-22: "VESTA automation" where the VESTA blueprints matter). The Faults (i) said "an alert from
// one of the villa's rules". This reads the compiler's tree of every screen's source — string literals, template parts
// and JSX text, never comments or identifiers — and refuses "rule" / "rules" as a whole word. Developer-only text (a
// console / debug call) is not a screen's. Text the VESTA Agent writes (a ticket's title, its notes) arrives as data
// and is not the Kiosk's words. No allow-list: no other sense of the word reaches a screen today.
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../src/", import.meta.url).pathname;
const DIRS = ["components", "fm", "pages", "config"];
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p); } };
for (const d of DIRS) walk(ROOT + d);

const DEV_CALL = /^(console\.\w+|devLog|tapDebug|log)$/;
const WORD = /\brules?\b/i;
const TEXT = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText]);

/** Every shown text of one source that says "rule", as "file:line text". */
export function ruleWords(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const devOnly = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p)) return DEV_CALL.test(p.expression.getText(sf));
      if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };
  (function visit(n) {
    if (TEXT.has(n.kind)) {
      const raw = n.kind === ts.SyntaxKind.JsxText ? text.slice(n.pos, n.end) : n.getText(sf);
      if (WORD.test(raw) && !devOnly(n)) {
        out.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${raw.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

console.log("  the rule, by value:");
ck("\"rule\" or \"Rules\" in a string, a template or JSX text is found",
   ruleWords("a.ts", `const a = "an alert from one of the villa's rules";`).length === 1
   && ruleWords("b.tsx", `const b = <p>Rule fired</p>;`).length === 1
   && ruleWords("c.ts", "const c = `${n} rule`;").length === 1);
ck("  ...an identifier, a comment, a console line and another word (\"ruler\", \"overruled\") are not",
   ruleWords("d.ts", `const rules = 1; // the rule\nconsole.warn("rule lost");\nconst e = "a ruler, overruled";`).length === 0);

console.log("\n  every screen's source:");
const found = files.flatMap((f) => ruleWords(f.slice(ROOT.length), readFileSync(f, "utf8")));
ck(`no shown text in ${DIRS.join(", ")} (${files.length} files) calls an automation a "rule"`, files.length > 200 && found.length === 0, found);

done("✅ an automation is an automation in what the Kiosk shows");
