// Does Settings' revert list cover every key Settings can change?
//
// ⚠️ THE FAILURE IS SILENT AND ONE-SIDED. A key written by a control but absent
// from SETTINGS_KEYS is un-revertable: Discard restores its siblings and leaves
// that one changed — worse than not offering Discard, because the dialog says
// it undid something it did not. No behavioural test sees this; it only shows
// up months later as "I pressed Discard and the theme stayed".
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)),
                     "../../src/components/settings/SettingsModal.tsx");
const src = readFileSync(FILE, "utf8");

// Every key handed to update({...}) or scheduleCommit({...}) in this file.
const written = new Set();
for (const m of src.matchAll(/(?:update|scheduleCommit)\(\{\s*([A-Za-z0-9_]+)/g))
  written.add(m[1]);

// The declared revert list.
const decl = src.match(/const SETTINGS_KEYS = \[([\s\S]*?)\] as const;/);
const declared = new Set(
  decl ? [...decl[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]) : []);

const missing = [...written].filter((k) => !declared.has(k)).sort();
const extra   = [...declared].filter((k) => !written.has(k)).sort();

console.log(`  keys written by a control : ${[...written].sort().join(", ")}`);
console.log(`  keys in SETTINGS_KEYS     : ${[...declared].sort().join(", ")}`);
if (missing.length) console.log(`\n  ⚠️ WRITTEN BUT NOT REVERTABLE: ${missing.join(", ")}`);
if (extra.length)   console.log(`\n  declared but never written: ${extra.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan found the controls at all", written.size >= 8);
ck("SETTINGS_KEYS was parsed", declared.size > 0);
ck("every key a control writes can be reverted", missing.length === 0);
ck("no dead key in the revert list", extra.length === 0);
process.exit(fail ? 1 : 0);
