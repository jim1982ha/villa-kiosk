// A style no screen can use is refused (architecture review 11, 2026-10-09).
//
// Six rules styled elements that no longer exist — removed button states, an old pager, two energy layouts, an
// info tile — and nothing noticed, because a dead rule is invisible: it never matches, so it never breaks. Each
// one is a false lead for the next person restyling that screen. This reads every class a stylesheet names and
// looks for it in the source that draws the page. A class BUILT in code counts as used when a template literal
// builds its prefix: `tone-${t}` covers "tone-good", `e-s${i}` covers "e-s3" (a prefix without a dash covers
// digits only — `b${i}` covers "b0", never "badge").
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const all = walk(ROOT + "src");
const code = all.filter((f) => /\.(tsx?|html)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n") + readFileSync(ROOT + "index.html", "utf8");

const classes = new Map(); // class → the sheet that styles it
for (const f of all.filter((f) => f.endsWith(".css"))) {
  const t = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let buf = "";
  for (const ch of t) {
    if (ch === "{") { for (const m of buf.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) classes.set(m[1], f.slice(ROOT.length)); buf = ""; }
    else if (ch === "}" || ch === ";") buf = "";
    else buf += ch;
  }
}
ck("the scan found the stylesheets' classes", classes.size > 400, classes.size);

const prefixes = new Set([...code.matchAll(/(?<![\w-])([a-z][a-z0-9-]*)\$\{/g)].map((m) => m[1]));
const built = (c) => [...prefixes].some((p) => c.startsWith(p) && (p.endsWith("-") ? /^[a-z0-9-]+$/ : /^\d+$/).test(c.slice(p.length)));
const named = (c) => new RegExp(`(^|[^\\w-])${c.replace(/-/g, "\\-")}(?![\\w-])`).test(code);
const dead = [...classes].filter(([c]) => !named(c) && !built(c)).map(([c, f]) => `${c} (${f})`);
ck("every class a stylesheet styles is drawn by some screen", dead.length === 0, dead);
ck("  ...a built class counts: the Energy slots e-s0..5 come from `e-s${i}`", built("e-s3") && !built("badge"));

done("✅ no stylesheet rule for an element that no longer exists");
