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
import { ck, done, tsFiles } from "../consistency/check.mjs";
const { ENTITY_DOMAINS } = await import("@/types/ha.types");
const { inferTypeFromEntityId, labelField } = await import("@/config/EntityMap");


ck("every listed type is inferred from its entity_id domain, and nothing else is",
   ENTITY_DOMAINS.every((d) => inferTypeFromEntityId(`${d}.x`) === d) && inferTypeFromEntityId("vacuum.x") === null);
const SRC = new URL("../../src/", import.meta.url).pathname;
const walk = tsFiles;
const copies = walk(SRC).filter((f) => /"media_player",\s*"switch",\s*"input_boolean"/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
ck("the type list is written once (types/ha.types)", copies.length === 1 && copies[0] === "types/ha.types.ts", copies);

const read = (p) => readFileSync(new URL(`../../src/components/settings/${p}`, import.meta.url), "utf8");
const mf = read("MappingFields.tsx"), br = read("BindingRow.tsx"), er = read("EntityMapRow.tsx");
// architecture review 2026-10-12, candidate 1: ONE editor for a device's fields — its row in Devices.
// The Villa tab's bound-objects row keeps the LINK only (it carried the same fields).
ck("a device's fields are edited in ONE table (Devices), the bound-objects row holds the link only",
   /<MappingFields /.test(er) && !/<MappingFields|import MappingFields/.test(br));
const own = [br, er].map((s) => [/effectiveCategory\(/, /lightIntensityRatio/, /linkedEntityId/, /requireConfirm/].filter((r) => r.test(s)).length);
ck("  ...and neither renders type, category, intensity, the confirm box or the linked entity itself", own.every((n) => n === 0), own);
ck("the label commits one way: half a second after typing, or at once on leaving the field",
   /useDraftCommit<string>\(\(_k, value\) => onPatch\(\{ label: value \}\), 500\)/.test(mf) && /onBlur=\{\(\) => label\.flush\("v"\)\}/.test(mf));
// owner, 2026-10-22: a camera's "Motion sensor" field merged into "Linked entity" — ONE picker for every type, its
// camera placeholder neutral (it said "arms detection, long-press", which no longer happens)
{
  const code = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ce = code(read("ConfigEditor.tsx"));
  ck("ONE linked-entity picker for every type: no camera-only motion picker, no column of its own",
     (mf.match(/<EntityPicker /g) ?? []).length === 1 && /cell\("linked", "Linked entity"/.test(mf)
     && !/Motion sensor|draftField\(\{ motion/.test(code(mf)) && !/Motion sensor/.test(ce));
  ck("  ...described truthfully: a camera's may be its motion sensor or a switch; nothing says long-press or arms",
     /placeholder=\{m\.type === "camera" \? "Linked entity, its motion sensor or a switch…" : "Linked entity, a switch or a sensor…"\}/.test(mf)
     && ![mf, br, er].some((x) => /long-press|arms detection|ring only/.test(code(x))));
}

// owner, 2026-10-12: the Label field printed the entity-id fallback as if typed, while the title above it
// read Home Assistant's own name
{
  const id = "light.hall_lamp_left";
  const auto = labelField(id, "Hall Lamp Left", "Reading lamp");
  ck("the label made from the entity id shows as an EMPTY field…", auto.value === "", auto);
  ck("  …with the name actually shown in grey, and where it comes from", auto.placeholder === "Reading lamp, from its device name", auto.placeholder);
  ck("  …the underscore form of the fallback too", labelField(id, "hall_lamp_left", "Reading lamp").value === "");
  ck("a name the owner typed shows as it is", labelField(id, "Desk light", "Reading lamp").value === "Desk light");
  ck("no Home Assistant name yet: the id's own name, said so", /, from its entity id$/.test(labelField(id, undefined).placeholder));
  ck("the field uses it (value and placeholder)", /labelField\(entityId, m\.label,/.test(mf) && /value=\{label\.drafts\.v \?\? named\.value\}/.test(mf)
     && /placeholder=\{named\.placeholder\}/.test(mf));
}

done("✅ one list of device types, one editor for a device");
