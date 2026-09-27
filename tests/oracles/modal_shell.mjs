// ONE modal shell (2.496.175): header · body · footer, defined once, used by
// every dialog. There were three — the settings family (.settings-*), the
// panel family (.panel-*: device panels, Energy, Weather, prompts) and two
// Facility dialogs with unstyled .modal-header/.modal-body — and side by side
// they differed in header height, footer height, title size and the footer's
// left button ("keep the Energy one and use it everywhere", the owner).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const root = new URL("../../src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root);
const css = files.filter((f) => f.endsWith(".css")).map((f) => [f, readFileSync(f, "utf8")]);
const tsx = files.filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(f, "utf8")]);
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const old = /(?<![\w-])(settings|panel)-(header|body|footer)(?![\w-])/;
const stale = [...css.map(([f, s]) => [f, noComments(s)]), ...tsx].filter(([, s]) => old.test(s)).map(([f]) => f.slice(root.length));
ck("no dialog or stylesheet uses the retired .settings-* / .panel-* section classes", stale.length === 0, stale);

// Each section's own rule, outside any media query, exactly once.
const stripMedia = (s) => {
  let out = "", i = 0;
  while (i < s.length) {
    const m = s.indexOf("@media", i);
    if (m < 0) { out += s.slice(i); break; }
    out += s.slice(i, m);
    let j = s.indexOf("{", m), depth = 0;
    for (; j < s.length; j++) { if (s[j] === "{") depth++; else if (s[j] === "}" && --depth === 0) break; }
    i = j + 1;
  }
  return out;
};
const top = css.map(([, s]) => stripMedia(noComments(s))).join("\n");
for (const sec of ["modal-header", "modal-body", "modal-footer"]) {
  const n = (top.match(new RegExp(`(^|\\n)\\s*\\.${sec}\\s*\\{`, "g")) ?? []).length;
  ck(`.${sec} is defined once`, n === 1, n);
}
ck("the card itself carries no padding in any family (the sections do)", !/\.modal:not\(\.settings-modal\)/.test(css.map(([, s]) => noComments(s)).join("\n")));
ck("every header is the same height (min-height covers the 44px device icon)", /\.modal-header \{[^}]*min-height: 84px/.test(top));
ck("ONE footer button look — the soft pill Energy had", /\.modal-footer \.btn \{[^}]*border-radius: 999px/.test(top) && !/\.panel-footer/.test(top));

// Every dialog root is built from the shell.
const roots = tsx.filter(([, s]) => /className=(["`{])[^"`]*\bmodal\b(?![\w-])[^"`]*\1?/.test(s) && /role="dialog"/.test(s));
const missing = roots.filter(([, s]) => !(/modal-header/.test(s) && /modal-body/.test(s) && (/modal-footer/.test(s) || /<ModalFooter\b/.test(s))))
  .map(([f]) => f.slice(root.length));
ck(`all ${roots.length} dialogs have a header, a body and a footer from the shell`, roots.length >= 10 && missing.length === 0, missing);
const cornerX = roots.filter(([, s]) => /modal-header[\s\S]{0,300}aria-label="Close"/.test(s)).map(([f]) => f.slice(root.length));
ck("no dialog hides its exit as a corner ✕ — Close is in the footer, as everywhere", cornerX.length === 0, cornerX);

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one modal shell");
