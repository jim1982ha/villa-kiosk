// One device-type list and one editor for a device's fields
// (types/ha.types ENTITY_DOMAINS, components/settings/MappingFields — round
// 10, 2.496.156). Two Advanced Settings tables each rendered the same seven
// fields for the same record (ad68ef49 had to make their dropdowns stop
// disagreeing; the label still committed two ways and the linked entity was
// described two ways), and the 12-type list was written out three times.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
const { ENTITY_DOMAINS } = await import("@/types/ha.types");
const { inferTypeFromEntityId } = await import("@/config/EntityMap");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

ck("every listed type is inferred from its entity_id domain, and nothing else is",
   ENTITY_DOMAINS.every((d) => inferTypeFromEntityId(`${d}.x`) === d) && inferTypeFromEntityId("vacuum.x") === null);
const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
const copies = walk(SRC).filter((f) => /"media_player",\s*"switch",\s*"input_boolean"/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
ck("the type list is written once (types/ha.types)", copies.length === 1 && copies[0] === "types/ha.types.ts", copies);

const read = (p) => readFileSync(new URL(`../../src/components/settings/${p}`, import.meta.url), "utf8");
const mf = read("MappingFields.tsx"), br = read("BindingRow.tsx"), er = read("EntityMapRow.tsx");
ck("both tables render a device's fields through MappingFields", /<MappingFields /.test(br) && /<MappingFields /.test(er));
const own = [br, er].map((s) => [/effectiveCategory\(/, /lightIntensityRatio/, /motionEntityId/, /requireConfirm/].filter((r) => r.test(s)).length);
ck("  ...and neither renders type, category, intensity, the confirm box or the motion sensor itself", own.every((n) => n === 0), own);
ck("the label commits one way: half a second after typing, or at once on leaving the field",
   /useDraftCommit<string>\(\(_k, value\) => onPatch\(\{ label: value \}\), 500\)/.test(mf) && /onBlur=\{\(\) => label\.flush\("v"\)\}/.test(mf));
ck("the linked entity is described once, truthfully (ring AND an on/off switch — it was 'ring only' in one table)",
   /placeholder=\{[^}]*ring and an on\/off switch/.test(mf) && ![mf, br, er].some((x) => /placeholder=[^>]*ring only/.test(x)));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one list of device types, one editor for a device");
