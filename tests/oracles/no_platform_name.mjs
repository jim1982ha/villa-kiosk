// The Kiosk's screens never name the platform underneath (owner, 2026-10-15: "never mention Home Assistant anywhere in
// the Kiosk UI"). Every text a screen can show — JSX text, a string a component renders, a tooltip, an error a banner
// prints — is scanned with the code's comments taken out; "Home Assistant" or "HA" as a word in one fails, naming file
// and line. Code names (useHA, HAWebSocket, the [HA] tag of a developer log) are not text a person reads.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const root = new URL("../../src", import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mts)$/.test(p)) files.push(p); } };
walk(root);

/** The code without its comments, line numbers kept (a comment's text becomes spaces). */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}
const hits = [];
for (const f of files) {
  const lines = stripComments(readFileSync(f, "utf8")).split("\n");
  lines.forEach((l, i) => {
    if (/devLog\(|console\.|\[HA\]/.test(l)) return;                 // developer logs: never on a screen
    if (/Home\s+Assistant/i.test(l)) hits.push(`${f.slice(root.length + 1)}:${i + 1}`);
    else if (/["'`>][^"'`<\n]*\bHA\b[^"'`<\n]*["'`<]/.test(l)) hits.push(`${f.slice(root.length + 1)}:${i + 1} (HA)`);
  });
}
ck(`no screen text names Home Assistant (${files.length} files read, comments aside)`, hits.length === 0, hits);
done("✅ the Kiosk's words never name the platform underneath");
