// The shared checkbox row must clear the app's own minimum touch target.
// Arithmetic only — no browser — but it is the arithmetic the rule performs.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
// ⚠️ THE PARTS, NOT `styles.css` — WHICH IS NOW ONLY AN IMPORT LIST. This read
// the monolith directly, so the moment the stylesheet was split into eight
// files it went on parsing happily and found every token `null`: an instrument
// that reports "the tokens are undefined" when what actually happened is that
// it stopped looking. Reading the directory means a ninth part is picked up
// without anyone remembering to add it here.
const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles");
const css = readdirSync(STYLES).filter((f) => f.endsWith(".css")).sort()
  .map((f) => readFileSync(join(STYLES, f), "utf8")).join("\n");
const num = (name) => {
  const m = css.match(new RegExp(`${name}:\\s*([0-9.]+)px`));
  return m ? Number(m[1]) : null;
};
const touchMin = num("--touch-min"), box = num("--toggle-box");
// ⚠️ THE PADDING IS READ FROM THE STYLESHEET, NOT RE-DERIVED HERE.
//
// This oracle used to compute `box + 2 * ((touchMin - box) / 2)` in JS and then
// assert that it was >= touchMin. That expression IS touchMin for every pair of
// numbers, so the assertion reduced to `touchMin >= touchMin` and was true
// whatever the stylesheet said — it never read `--toggle-pad` at all. Setting
// `--toggle-pad: 2px` returned the row to 22px and left all five lines green.
//
// A replica of the rule, checked against itself, dressed as a measurement. It
// is the same shape as an oracle re-implementing the code it tests; the tell is
// that no assertion can distinguish a correct stylesheet from a broken one.
const usesPad = /label\.toggle\s*\{[^}]*padding-block:\s*var\(--toggle-pad\)/s.test(css);

// The declaration itself, as written. Either a calc() the tokens resolve, or a
// plain px value — both are legitimate, and both must be READ.
const padDecl = css.match(/--toggle-pad:\s*([^;]+);/)?.[1]?.trim() ?? "";
const padPx = (() => {
  const plain = padDecl.match(/^([0-9.]+)px$/);
  if (plain) return Number(plain[1]);
  // calc((var(--touch-min) - var(--toggle-box)) / 2) — resolve the two tokens
  // this file already read, so the arithmetic under test is the CSS's, not ours.
  const m = padDecl.match(/^calc\(\s*\(\s*var\(--touch-min\)\s*-\s*var\(--toggle-box\)\s*\)\s*\/\s*2\s*\)$/);
  return m ? (touchMin - box) / 2 : null;
})();
const rowHeight = padPx === null ? null : box + 2 * padPx;

console.log(`  --touch-min:  ${touchMin}px`);
console.log(`  --toggle-box: ${box}px`);
console.log(`  --toggle-pad: ${padDecl || "(not declared)"}  →  ${padPx}px`);
console.log(`  row height before (box only): ${box}px`);
console.log(`  row height after  (box + 2x pad): ${rowHeight}px`);

let fail=0; const ck=(n,ok)=>{console.log(`    ${ok?"PASS":"FAIL"}  ${n}`); if(!ok)fail++;};
console.log("\n  assertions:");
ck("the tokens are defined", touchMin !== null && box !== null);
ck("--toggle-pad is declared and readable", padPx !== null);
ck("label.toggle applies the padding", usesPad);
ck("the row the STYLESHEET produces clears the minimum", rowHeight !== null && rowHeight >= touchMin);
ck("and it did not before — this was a real defect", box < touchMin);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the toggle row is a real touch target"}`);
process.exit(fail ? 1 : 0);
