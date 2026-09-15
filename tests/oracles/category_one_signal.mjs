// A device's filter category must be resolved from the SAME signals everywhere,
// and a hand-picked one must stick.
//
// `effectiveCategory(entityId, type, storedCategory?, deviceClass?)` had two
// optional parameters, and the fourth changes the answer. Three of twelve
// callers omitted it — one of them the permission gate, whose own comment said
// it was deliberately aligned with "the category the badge/filter actually
// uses" and warned that disagreement "is an RBAC hole, not cosmetic". Two
// consecutive lines of one filter in Dashboard resolved the same entity's
// category two different ways.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);
const { effectiveCategory, subjectOf } = await import("@/config/EntityCategories");
const { isMappingAllowed } = await import("@/auth/permissions");

/* ── the signal that used to be droppable ─────────────────────────────── */
// An entity_id carrying no hint of what it measures — the case where
// device_class is the ONLY thing that can resolve the category.
const ID = "sensor.aqara_x";
const mapping = { entityId: ID, type: "sensor", label: "x" };
const tempEntity = { attributes: { device_class: "temperature" } };

const withDc = effectiveCategory(subjectOf(ID, mapping, tempEntity));
const withoutDc = effectiveCategory(subjectOf(ID, mapping, undefined));

// The gate must now reach the same answer the badge does.
const gateWithEntity = isMappingAllowed("guest", ID, mapping, tempEntity);
const gateBlind = isMappingAllowed("guest", ID, mapping, undefined);

console.log(`  ${ID} with device_class=temperature -> ${withDc}`);
console.log(`  ${ID} with no device_class          -> ${withoutDc}`);
console.log(`  guest gate, entity passed           -> ${gateWithEntity}`);
console.log(`  guest gate, entity absent           -> ${gateBlind}`);

/* ── a hand-picked category is honoured ───────────────────────────────── */
const picks = {
  lockOthers: effectiveCategory(subjectOf("lock.a",
    { type: "lock", category: "others", categoryPicked: true }, undefined)),
  cameraNetwork: effectiveCategory(subjectOf("camera.a",
    { type: "camera", category: "network", categoryPicked: true }, undefined)),
  switchOthers: effectiveCategory(subjectOf("switch.a",
    { type: "switch", category: "others", categoryPicked: true }, undefined)),
};
// ...while an AUTO-assigned legacy default still re-buckets, which is the
// behaviour the discard exists for and must not be lost.
const autoRebuckets = effectiveCategory(subjectOf("lock.a",
  { type: "lock", category: "others" }, undefined));

console.log(`  picked:  ${JSON.stringify(picks)}`);
console.log(`  auto-assigned "others" on a lock -> ${autoRebuckets}`);

/* ── nobody hand-builds a subject ─────────────────────────────────────── */
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = walk(SRC);
// Every resolution goes through `subjectOf`, which requires the live entity.
// Hand-assembling the object would let a caller write `deviceClass: undefined`
// without ever looking — the omission this change exists to stop, in a new hat.
const calls = [];
for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/effectiveCategory\(\s*([A-Za-z_{])/g)) {
    if (f.endsWith("EntityCategories.ts")) continue;
    calls.push([f.slice(SRC.length + 1), m[1]]);
  }
}
const handBuilt = calls.filter(([, first]) => first === "{").map(([f]) => f);
const viaSubject = calls.filter(([, first]) => first !== "{");

console.log(`\n  scanned ${FILES.length} source files`);
console.log(`  effectiveCategory call sites outside its own module: ${calls.length}`);
if (handBuilt.length) console.log(`      hand-built subject in: ${handBuilt.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the source tree", FILES.length > 100);
ck("device_class genuinely changes the answer", withDc !== withoutDc);
ck("  ...and the badge reads it as comfort", withDc === "comfort");
ck("  ...while a blind resolution says energy", withoutDc === "energy");
ck("the permission gate now reads device_class too", gateWithEntity === true);
ck("  ...and the blind answer, which the gate ALWAYS used to give, differs",
   gateBlind !== gateWithEntity);
ck("a hand-picked category is honoured verbatim",
   picks.lockOthers === "others" && picks.cameraNetwork === "network"
   && picks.switchOthers === "others");
ck("an auto-assigned legacy default still re-buckets", autoRebuckets === "access_control");
ck("every resolution goes through subjectOf", handBuilt.length === 0 && viaSubject.length > 5);
process.exit(fail ? 1 : 0);
