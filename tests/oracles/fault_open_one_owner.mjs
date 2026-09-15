// "Is this fault open" must have exactly ONE definition.
// A behavioural oracle cannot see this: every copy AGREED (except ticketStats,
// fixed in 2.496.6), so the defect is not a wrong answer — it is eight places
// that can independently drift into one. The instrument is therefore static.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const OFFENDERS = [];
// ⚠️ RESOLVED FROM THIS FILE, NOT THE WORKING DIRECTORY. It was `walk("src")`,
// which passes when run from the repo root and silently finds NOTHING when
// `run-all.sh` cd's into this directory — a scan that reports "0 offenders"
// because it scanned no files is the worst possible green.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
for (const f of walk(SRC)) {
  if (f.endsWith("fmEngine.ts")) continue;            // the one owner
  const src = strip(readFileSync(f, "utf8"));
  for (const [i, line] of src.split("\n").entries()) {
    // a ticket's status compared against the literal, anywhere but the owner
    if (/status\s*[!=]==\s*"resolved"/.test(line)) OFFENDERS.push(`${f}:${i + 1}  ${line.trim()}`);
  }
}
// ⚠️ ASSERT THE SCAN ACTUALLY HAPPENED. A file count of zero would make the
// uniqueness assertion vacuously true.
const SCANNED = walk(SRC).length;
console.log(`  scanned ${SCANNED} source files`);
console.log(`  inline copies of the rule outside fmEngine: ${OFFENDERS.length}`);
for (const o of OFFENDERS) console.log(`      ${o}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the source tree", SCANNED > 100);
ck("exactly one definition of the rule", OFFENDERS.length === 0);
console.log("\n  (the rule's BEHAVIOUR is pinned by ticket_status.mjs — this file pins its uniqueness)");
process.exit(fail ? 1 : 0);
