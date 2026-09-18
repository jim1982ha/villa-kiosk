// Removing a device is ONE operation, and no surface may perform half of it.
//
// `dismissedEntityIds` had exactly one writer in the tree — Advanced Settings'
// banner ("N entities no longer in Home Assistant → Remove N"). The trash can
// on every row of the SAME table deleted the entityMap row and recorded
// nothing, so the row vanished from Settings while the device stayed in the
// Facility fault picker, the offline count and readiness. That is verbatim the
// symptom the banner exists to end, arriving through the other button on the
// same screen.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);
const { forgetEntities, dismissedEntitySet } = await import("@/config/dismissedEntities");

const map = { "lock.a": { type: "lock" }, "sensor.b": { type: "sensor" }, "light.c": { type: "light" } };

/* ── the operation delivers both halves ───────────────────────────────── */
const one = forgetEntities(map, [], ["sensor.b"]);
const both = forgetEntities(map, [], ["sensor.b", "light.c"]);
const onto = forgetEntities(map, ["already.gone"], ["sensor.b"]);
const twice = forgetEntities(one.entityMap, one.dismissedEntityIds, ["sensor.b"]);

console.log("  forget sensor.b ->", JSON.stringify(one));
console.log("  onto an existing dismissal ->", JSON.stringify(onto.dismissedEntityIds));

/* ── and the removal actually reaches the surfaces that read mesh ids ─── */
// dismissedEntitySet is what the fault picker, the offline count and readiness
// consult. Before, a removed-but-stale id was in NONE of them.
const stillGone = dismissedEntitySet(one.dismissedEntityIds, { "lock.a": {} });

/* ── no surface assembles the patch itself ────────────────────────────── */
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
// A screen that builds a dismissal value is a screen that can build half of it.
const SURFACES = FILES.filter((f) => /\/(components|pages)\//.test(f));
const assemblers = SURFACES.filter((f) =>
  /dismissedEntityIds:\s*[[.]/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1));
// And an entityMap delete outside the one operation is the other half.
const rawDeletes = SURFACES.filter((f) =>
  /delete\s+\w+(\.\w+)*\[/.test(readFileSync(f, "utf8"))
  && /entityMap/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1));

console.log(`\n  scanned ${SURFACES.length} screens of ${FILES.length} source files`);
if (assemblers.length) console.log(`      assembles a dismissal: ${assemblers.join(", ")}`);
if (rawDeletes.length) console.log(`      deletes an entityMap row by hand: ${rawDeletes.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the screens", SURFACES.length > 40);
ck("the row is deleted", one.entityMap["sensor.b"] === undefined);
ck("...AND the decision is recorded", one.dismissedEntityIds.includes("sensor.b"));
ck("other rows are untouched", Object.keys(one.entityMap).sort().join() === "light.c,lock.a");
ck("several at once", both.dismissedEntityIds.length === 2 && Object.keys(both.entityMap).length === 1);
ck("an existing dismissal survives", onto.dismissedEntityIds.includes("already.gone"));
ck("removing twice records it once", twice.dismissedEntityIds.filter((x) => x === "sensor.b").length === 1);
ck("the removal reaches the mesh-reading surfaces", stillGone.has("sensor.b"));
ck("no screen assembles a dismissal itself", assemblers.length === 0);
ck("no screen deletes an entityMap row by hand", rawDeletes.length === 0);
process.exit(fail ? 1 : 0);
