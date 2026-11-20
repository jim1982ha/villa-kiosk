// tests/consistency/check.mjs
// The oracles' assertion helper, ONCE: ck and done — and tsFiles, the .ts/.tsx
// walk ten oracles each wrote out (2.496.263). `ck` was pasted verbatim into 82
// oracle files (and drifted into three shapes) before 2.496.200.
//
//   import { ck, done } from "../consistency/check.mjs";
//   ck("what must hold", holds, gotValueShownOnFailure);
//   done("✅ one line for the green run");   // exits 1 with a red count otherwise

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .ts/.tsx file under `dir`, recursively (appended to `out`). */
export function tsFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Whether `html` has an element whose class list holds `cls` (and every class of `also`): a test asks for the class it
 *  is about, so one more class on the element (a layout change) fails no test about something else. */
export function hasClass(html, cls, ...also) {
  return [...html.matchAll(/class="([^"]*)"/g)].some((m) => {
    const list = m[1].split(/\s+/);
    return [cls, ...also].every((c) => list.includes(c));
  });
}

let fail = 0;

export function ck(name, ok, got) {
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`);
  if (!ok) fail++;
}

export function done(green) {
  console.log(fail ? `\n❌ ${fail} failed` : `\n${green}`);
  process.exit(fail ? 1 : 0);
}
