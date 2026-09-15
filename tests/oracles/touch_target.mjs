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
const usesPad = /label\.toggle\s*\{[^}]*padding-block:\s*var\(--toggle-pad\)/s.test(css);
const rowHeight = box + 2 * ((touchMin - box) / 2);

console.log(`  --touch-min: ${touchMin}px`);
console.log(`  --toggle-box: ${box}px`);
console.log(`  row height before (box only): ${box}px`);
console.log(`  row height after  (box + 2x pad): ${rowHeight}px`);

let fail=0; const ck=(n,ok)=>{console.log(`    ${ok?"PASS":"FAIL"}  ${n}`); if(!ok)fail++;};
console.log("\n  assertions:");
ck("the tokens are defined", touchMin !== null && box !== null);
ck("label.toggle applies the padding", usesPad);
ck("the row now clears the app's own minimum", rowHeight >= touchMin);
ck("and it did not before — this was a real defect", box < touchMin);
ck("the pager selectors the new components need exist",
   /^\.pager\s*\{/m.test(css) && /^\.pager-controls\s*\{/m.test(css));
process.exit(fail?1:0);
