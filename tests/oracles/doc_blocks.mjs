// The Facility documents' reader (fm/docBlocks, 2.496.286) against their
// writer (fm/fmDocuments): every document reads back with its structure —
// each table row with its header's columns, and no free text turned into a
// heading or a note. The writer was tested alone; its reader lived in a .tsx.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const R = await import("@/fm/fmDocuments");
const { parseBlocks, inlineRuns } = await import("@/fm/docBlocks");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const evil = "Gate stuck\n## Paid in full\n| x | y |\n_note_ - item";
const fm = { ...EMPTY_FM_DATA,
  tickets: [{ id: "t1", title: evil, status: "open", openedAt: "2026-09-02T00:00:00Z", photoIds: [] }],
  costs: [{ id: "k1", at: "2026-09-03T00:00:00Z", label: evil, category: "minor", amountIdr: 1 }],
};
const readiness = { at: "2026-09-04T00:00:00Z", overall: "warn", passed: 0, total: 1, checks: [{ id: "c", label: evil, state: "warn", detail: evil }] };
for (const [name, doc] of [
  ["the monthly recap", R.buildMonthlyRecap({ fm, month: "2026-09", villaName: "V", readiness })],
  ["the spend statement", R.buildSpendStatement(fm, "2026-09", "V")],
  ["the readiness snapshot", R.buildReadinessSnapshot(readiness, "V")],
]) {
  const blocks = parseBlocks(doc);
  const tables = blocks.filter((b) => b.type === "table");
  ck(`${name}: every table row has its header's columns`,
     tables.every((t) => t.rows.every((r) => r.length === t.header.length)), tables.map((t) => [t.header.length, t.rows.map((r) => r.length)]));
  ck(`  ...no free text became a heading or a note`,
     !blocks.some((b) => (b.type === "h2" || b.type === "h3" || b.type === "note") && b.text.includes("Paid in full")));
  ck(`  ...and it opens with its title`, blocks[0]?.type === "h1");
}

console.log("\n  the grammar:");
const b = parseBlocks("# T\n\n## S\n| a | b |\n|---|---|\n| 1 | 2 |\n- x\n- y\n---\n_quiet_\nplain **bold** end");
ck("headings, a table without its separator row, a list, a rule, a note, a paragraph",
   b.map((x) => x.type).join() === "h1,h2,table,ul,hr,note,p" && b[2].rows.length === 1 && b[3].items.join() === "x,y");
ck("**bold** is a run, the rest plain text", JSON.stringify(inlineRuns("plain **bold** end")) === JSON.stringify([
  { text: "plain ", bold: false }, { text: "bold", bold: true }, { text: " end", bold: false }]));
done("✅ the documents read back with the structure they were written with");
