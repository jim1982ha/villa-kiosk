// The device list Advanced Settings edits (config/deviceRecord.ts — architecture review
// 2026-10-12, candidate 1), by value: every stored device ONE row, hand-linked or not, found by the
// name the map shows. A device bound to an object used to leave this list for another tab, and the
// search filtered on stored labels nobody sees.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const D = await import("@/config/deviceRecord");

const map = {
  "light.hall": { entityId: "light.hall", type: "light" },
  "light.patio": { entityId: "light.patio", type: "light", label: "light patio" },
  "fan.gone": { entityId: "fan.gone", type: "fan" },
};
const bindings = { "light.terrace_old": "light.patio", pool_lamp_mesh: "light.patio" };
const rows = D.deviceRows(map, bindings, new Set(["fan.gone"]));
ck("every stored device is a row — a hand-linked one included", rows.map((r) => r.id).join() === "light.hall,light.patio");
ck("  ...a removed one is not", !rows.some((r) => r.id === "fan.gone"));
ck("a row says which objects are linked to it by name", rows[1].objects.join() === "light.terrace_old,pool_lamp_mesh" && rows[0].objects.length === 0);

const patio = rows[1];
ck("found by the name the map shows, not the stored fallback", D.rowMatches(patio, "Patio2F", "Patio2F Center", "Patio 2F")
   && !D.rowMatches(patio, "light patio", "Patio2F Center", "Patio 2F"));
ck("  ...by its id, its room, a linked object; case-insensitive",
   ["LIGHT.PATIO", "patio 2f", "terrace_old"].every((q) => D.rowMatches(patio, q, "Patio2F Center", "Patio 2F")));
ck("  ...an empty search finds everything", D.rowMatches(patio, "  ", "x", ""));

const ed = readFileSync(new URL("../../src/components/settings/ConfigEditor.tsx", import.meta.url), "utf8");
ck("Advanced Settings lists deviceRows and filters with rowMatches on the shown name (no own list rule)",
   /deviceRows\(config\.entityMap, config\.meshBindings, dismissedSet\)/.test(ed)
   && /rowMatches\(r, search, entityLabel\(r\.id\),/.test(ed) && !/boundEntityIds/.test(ed));

done("✅ one device list: every device once, found by the name it shows");
