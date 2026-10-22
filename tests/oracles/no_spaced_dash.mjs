// No " — " in what the Kiosk shows (owner, 2026-10-22: "replace ' — ' with ', ' in every text the Kiosk UI displays",
// and then, from screenshots of 2.496.488: it was STILL visible). The first sweep matched the exact three characters
// " — " inside a string, so it missed every dash a line break sat beside ("comes from —⏎ sunrise", JSX text wrapped
// in the source) and every JSX text starting with its dash (`{label} — {range}`: the compiler's text starts at the
// dash). This reads the compiler's tree of every screen's source — string literals, template parts and JSX text,
// never comments — and refuses an em dash with whitespace (or a string's edge) on both sides. Developer-only text (a
// console / debug call) is not a screen's, and the lone "—" that stands for "no value" is not this pattern.
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../src/", import.meta.url).pathname;
const DIRS = ["components", "fm", "pages", "config"];
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p); } };
for (const d of DIRS) walk(ROOT + d);

/** A call whose text only a developer reads. */
const DEV_CALL = /^(console\.\w+|devLog|tapDebug|log)$/;
const SPACED = /(^|\s)—(\s|$)/;
const TEXT = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText]);

/** Every shown text of one source that holds a spaced dash, as "file:line text". */
export function spacedDashes(rel, text) {
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
      // a JSX text's own words start at its full start: the compiler's "start" skips the spaces before its dash
      const raw = n.kind === ts.SyntaxKind.JsxText ? text.slice(n.pos, n.end)
        : n.getText(sf).replace(/^["'`}]|["'`]$|\$\{$/g, "");
      // the lone "—" that stands for "no value" (a string, or a cell's whole text) is not a separator
      if (SPACED.test(raw) && raw !== "—" && !devOnly(n)) {
        out.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${raw.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

console.log("  the rule, by value:");
ck("a dash between spaces, or before a line break, or at a string's edge, is found",
   spacedDashes("a.tsx", `const a = <p>comes from —\n sunrise</p>;`).length === 1
   && spacedDashes("b.tsx", `const b = <p>{x} — {y}</p>;`).length === 1
   && spacedDashes("c.ts", `const c = "Open — now";`).length === 1
   && spacedDashes("d.ts", "const d = `${a} — ${b}`;").length === 1);
ck("  ...the lone \"—\" for no value, a comment, a console line, and a comma are not",
   spacedDashes("e.ts", `const e = "—"; // a — b\nconsole.warn("lost — retrying");\nconst f = "a, b";`).length === 0);

console.log("\n  every screen's source:");
const found = files.flatMap((f) => spacedDashes(f.slice(ROOT.length), readFileSync(f, "utf8")));
ck(`no shown text in ${DIRS.join(", ")} (${files.length} files) holds " — "`, files.length > 200 && found.length === 0, found.slice(0, 8));

done("✅ no spaced dash in what the Kiosk shows");
