// Free text in the Facility documents cannot author their structure (2.496.206).
// A guest types ticket titles; a line break used to end the table ROW and let
// the rest of the title become a heading or a notice in the owner's report.
// One cell() now flattens every free-text cell — five hand-written pipe
// replacements before, and no line-break handling anywhere.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";

const R = await import("@/fm/fmDocuments");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

console.log("  cell():");
ck("a pipe cannot end the cell", R.cell("a|b") === "a/b");
ck("no line separator can end the row", R.cell("ok\n## Paid in full\r\n_x_ y z\u0085w") === "ok ## Paid in full _x_ y z w");
ck("long text is capped with an ellipsis", R.cell("x".repeat(300)).length === 200 && R.cell("x".repeat(300)).endsWith("…"));
ck("ordinary text passes untouched", R.cell("AC leaking in bedroom 2") === "AC leaking in bedroom 2");

console.log("\n  in the documents:");
const evil = "Gate stuck\n## Paid in full\n| x | y | z | w | v |";
const fm = { ...EMPTY_FM_DATA,
  tickets: [{ id: "t1", title: evil, status: "open", openedAt: "2026-09-02T00:00:00Z", photoIds: [] }],
  costs: [{ id: "k1", at: "2026-09-03T00:00:00Z", label: evil, category: "minor", amountIdr: 1 }],
};
const readiness = { at: "2026-09-04T00:00:00Z", checks: [{ id: "c", label: evil, state: "warn", detail: evil }] };
for (const [name, doc] of [
  ["the monthly report", R.buildMonthlyRecap({ fm, month: "2026-09", villaName: "V", readiness })],
  ["the spend statement", R.buildSpendStatement(fm, "2026-09", "V")],
  ["the readiness snapshot", R.buildReadinessSnapshot(readiness, "V")],
]) {
  ck(`${name} carries the text on its own row, not as a heading`,
     !doc.split("\n").some((l) => l.startsWith("## Paid")) && doc.includes("Gate stuck ## Paid in full / x / y"), name);
}

console.log("\n  one owner:");
const src = readFileSync(new URL("../../src/fm/fmDocuments.ts", import.meta.url), "utf8");
ck("no cell escapes on its own any more", !/\.replace\(\/\\\|\/g/.test(src.replace(/export function cell[\s\S]*?\n}/, "")));

done("✅ report text is data, never structure");
