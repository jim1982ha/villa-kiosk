// The stylesheet is an ORDERED LIST OF PARTS, and the order is the cascade.
//
// It was one 4,174-line sheet with 413 global class names, so every surface in
// the app had the same hot spot. The split is a pure reordering-free cut: the
// same bytes, the same sequence, at section banners that were already there.
// That is only safe while three things hold — every part parses on its own,
// `styles.css` lists all of them exactly once, and nobody starts a ninth sheet
// somewhere else. Two rules of equal specificity are resolved by which comes
// LAST, so a rule carried across a boundary silently reverses that.
//
// It also pins the two rules that were split across the CSS/TS seam:
//   · rail layout, which drifted — the CSS moved to `(pointer: coarse)` in
//     v2.81.1 and the `matchMedia` copy in CameraPanel kept `max-height:560px`,
//     so an iPad in landscape got rail layout from one half and not the other;
//   · the breakpoint vocabulary, where "a narrow screen" is written four ways.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (f) => readFileSync(f, "utf8");
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const ALL = walk(SRC);
const TS = ALL.filter((f) => /\.tsx?$/.test(f));

/* ── 1. the entry point is nothing but an ordered import list ──────────── */
const entry = read(join(SRC, "styles.css"));
const code = entry.replace(/\/\*[\s\S]*?\*\//g, "").trim();
const importLines = code.split("\n").map((l) => l.trim()).filter(Boolean);
const imported = importLines.map((l) => (l.match(/^@import "\.\/styles\/([^"]+)";$/) ?? [])[1]);
const nonImports = importLines.filter((l) => !/^@import "\.\/styles\/[^"]+";$/.test(l));

/* ── 2. every part is listed, once, in its own order ───────────────────── */
const onDisk = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).sort();
const listedSorted = [...imported].sort();
const dupes = imported.filter((n, i) => imported.indexOf(n) !== i);

/* ── 3. every part stands alone — balanced braces at depth 0 ───────────── */
const depthOf = (css) => {
  // ⚠️ AN UNTERMINATED COMMENT IS ITSELF A FAILURE, AND IT USED TO HIDE ONE.
  // Stripping with a lazy `/\*...\*/` leaves a dangling `/*` swallowing the
  // rest of the file, so a part cut mid-block reported perfectly balanced
  // braces — a mutation that truncated a part passed this check.
  const src = css;
  const opens = (src.match(/\/\*/g) ?? []).length;
  const closes = (src.match(/\*\//g) ?? []).length;
  const s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  let d = 0, min = 0;
  for (const ch of s) {
    if (ch === "{") d++;
    else if (ch === "}") { d--; if (d < min) min = d; }
  }
  return { end: d, min, comments: opens === closes };
};
const unbalanced = onDisk.filter((n) => {
  const { end, min, comments } = depthOf(read(join(SRC, "styles", n)));
  return end !== 0 || min < 0 || !comments;
});

/* ── 4. no ninth sheet anywhere else ───────────────────────────────────── */
const strays = ALL.filter((f) => f.endsWith(".css"))
  .map((f) => f.slice(SRC.length + 1))
  .filter((f) => f !== "styles.css" && !f.startsWith("styles/"));

/* ── 5. rail layout has ONE owner, and it is the stylesheet ────────────── */
const allCss = onDisk.map((n) => read(join(SRC, "styles", n))).join("\n");
const declaresRail = /--cam-rail-layout:\s*0/.test(allCss)
  && /--cam-rail-layout:\s*1/.test(allCss);
// The query must not be restated in TypeScript — that is exactly what drifted.
const tsRestating = TS.filter((f) =>
  /matchMedia\([^)]*orientation[^)]*\)/.test(read(f))).map((f) => f.slice(SRC.length + 1));
const readsRail = TS.filter((f) => /--cam-rail-layout/.test(read(f)))
  .map((f) => f.slice(SRC.length + 1));

/* ── 6. the breakpoint vocabulary, pinned ──────────────────────────────── */
// ⚠️ PINNED, NOT UNIFIED. "A narrow screen" is written four ways here (480,
// 560, 640, 720) and collapsing them would re-flow real layouts at four widths
// with nothing in this repo able to see the result. What this CAN do is stop a
// FIFTH appearing unnoticed, which is how there came to be four.
const widths = [...allCss.matchAll(/@media[^{]*?(?:max|min)-width:\s*(\d+)px/g)]
  .map((m) => Number(m[1]));
const KNOWN = [480, 560, 640, 641, 720, 721, 860, 1000, 1024, 1180];
const unknown = [...new Set(widths)].filter((w) => !KNOWN.includes(w)).sort((a, b) => a - b);

console.log(`  entry: ${imported.length} parts imported, ${onDisk.length} on disk`);
console.log(`  parts: ${imported.join(", ")}`);
console.log(`  breakpoint widths in use: ${[...new Set(widths)].sort((a, b) => a - b).join(", ")}`);
console.log(`  rail layout read by: ${readsRail.join(", ") || "nothing"}`);
if (nonImports.length) console.log(`      non-import rule in styles.css: ${nonImports.join(" | ")}`);
if (strays.length) console.log(`      stylesheet outside the list: ${strays.join(", ")}`);
if (unbalanced.length) console.log(`      unbalanced part: ${unbalanced.join(", ")}`);
if (unknown.length) console.log(`      NEW breakpoint width: ${unknown.join(", ")}`);
if (tsRestating.length) console.log(`      TS restates a layout query: ${tsRestating.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan found the parts", onDisk.length >= 5);
ck("styles.css carries nothing but the import list", nonImports.length === 0);
ck("every part on disk is imported", listedSorted.join() === onDisk.join());
ck("no part is imported twice", dupes.length === 0);
ck("the import order IS the file order", imported.join() === onDisk.join());
ck("every part stands alone with balanced braces", unbalanced.length === 0);
ck("no stylesheet lives outside the list", strays.length === 0);
ck("the stylesheet declares the rail answer", declaresRail);
ck("exactly one module reads it", readsRail.length === 1);
ck("no TypeScript restates a layout media query", tsRestating.length === 0);
ck("no breakpoint width has appeared that nobody named", unknown.length === 0);
process.exit(fail ? 1 : 0);
