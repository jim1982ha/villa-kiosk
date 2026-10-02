// The Facility record's vocabulary is ONE table (rootfs/usr/share/vesta/fm-records.json),
// as the APP reads it. The add-on reads the same file (tests/proxy-rules.py,
// "fm-records.json: …"), so a status, category or collection the kiosk writes
// is one the add-on accepts.
//
// Before 2.496.245 the proxy carried FM_TICKET_STATUSES / FM_COST_CATEGORIES
// and fmApi.ts its own FM_COLLECTIONS — two literal copies of one vocabulary.
// These drive values through the app's own modules; only the literal union
// TYPES are read as text, because a type has no value to drive.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const T = await import("@/fm/fmTypes");
const { diffFmData, fmDiffIsEmpty } = await import("@/fm/fmApi");

const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/fm-records.json", import.meta.url), "utf8"));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log("  the app reads the table:");
ck("its fault statuses are the table's", same(T.FM_TICKET_STATUSES, table.ticketStatuses), T.FM_TICKET_STATUSES);
ck("its cost categories are the table's", same(T.FM_COST_CATEGORIES, table.costCategories), T.FM_COST_CATEGORIES);
ck("its collections are the table's", same(T.FM_COLLECTIONS, table.collections), T.FM_COLLECTIONS);
ck("  ...and the empty record has exactly those collections",
   same(Object.keys(T.EMPTY_FM_DATA).sort(), [...table.collections].sort()), Object.keys(T.EMPTY_FM_DATA));

console.log("\n  the sync diff walks every collection the table names:");
{
  const base = Object.fromEntries(table.collections.map((c) => [c, []]));
  for (const c of table.collections) {
    const next = { ...base, [c]: [{ id: "x1" }] };
    const diff = diffFmData(base, next);
    ck(`  a record added to ${c} is seen`, !fmDiffIsEmpty(diff) && Object.keys(diff).length === table.collections.length);
  }
}

console.log("\n  the compiler's words are the table's:");
{
  const src = readFileSync(new URL("../../src/fm/fmTypes.ts", import.meta.url), "utf8");
  const union = (name) => {
    const m = new RegExp(`export type ${name} = ([^;]+);`).exec(src);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
  };
  ck("FmTicketStatus names exactly the table's statuses", same(union("FmTicketStatus") ?? [], table.ticketStatuses), union("FmTicketStatus"));
  ck("FmCostCategory names exactly the table's categories", same(union("FmCostCategory") ?? [], table.costCategories), union("FmCostCategory"));
  ck("FmCost.category is that type, not a second literal", /category: FmCostCategory;/.test(src));
}

done("✅ the Facility vocabulary is one table, and the app reads it");
