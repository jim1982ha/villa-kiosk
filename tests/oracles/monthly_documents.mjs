// The Cockpit's three generated documents — the month's recap, the spend statement, the readiness snapshot — are ONE
// thing with three kinds (fm/monthlyDocument.ts, useMonthlyDocument): each named by its own word, downloaded under its
// own file name, made for the months it can be made for. ⚠️ Until 2.496.403 each tab had its own copy of "make, save,
// reopen, download", and readiness snapshots were listed as "Saved statements" (architecture review round two,
// 2026-10-17). By value, then the saved list as it is drawn.
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const D = await import("@/fm/monthlyDocument");
const { localStamp } = await import("@/fm/fmEngine");
const { SavedDocumentRows } = await import("@/components/fm/SavedDocumentsList");

console.log("  each kind, by value:");
const row = (k) => `${k}: ${D.DOCUMENT_KINDS[k].noun}/${D.DOCUMENT_KINDS[k].plural} → ${D.documentFileName(k, "Villa Example", "2026-10")}`;
ck("recap, statement, snapshot — each its own words and file",
   ["recap", "spend", "readiness"].map(row).join(" | ")
   === "recap: recap/recaps → villa-example-operations-2026-10.md | spend: statement/statements → villa-example-spend-2026-10.md"
   + " | readiness: snapshot/snapshots → villa-example-readiness-2026-10.md", ["recap", "spend", "readiness"].map(row));
const NOW = new Date(2026, 9, 17, 12).getTime();
const data = { schedules: [], tickets: [], savedDocuments: [],
  completions: [{ at: new Date(2026, 6, 3).toISOString() }], costs: [{ at: new Date(2026, 7, 9).toISOString() }] };
ck("the months offered: a recap the finished month first, then the current one and any with work or spend",
   D.monthsOffered("recap", data, NOW).join() === "2026-10,2026-09,2026-08,2026-07" && D.defaultMonth("recap", NOW) === "2026-09",
   D.monthsOffered("recap", data, NOW));
ck("  ...a statement the current month and any with spend; a snapshot now only",
   D.monthsOffered("spend", data, NOW).join() === "2026-10,2026-08" && D.defaultMonth("spend", NOW) === "2026-10"
   && D.monthsOffered("readiness", data, NOW).join() === "2026-10" && D.defaultMonth("readiness", NOW) === "2026-10");

console.log("\n  the saved list, drawn:");
const doc = (id, kind, month, at) => ({ id, kind, month, markdown: "# x", generatedAt: at });
const docs = [doc("a", "readiness", "2026-10", "2026-10-16T09:00:00Z"), doc("b", "readiness", "2026-10", "2026-10-17T09:00:00Z"),
  doc("c", "recap", "2026-09", "2026-10-02T09:00:00Z"), doc("d", "spend", "2026-09", "2026-10-02T09:00:00Z")];
const list = (kind) => draw(h(SavedDocumentRows, { kind, docs, onOpen: () => {}, onRemove: () => {} }));
// ⚠️ A SNAPSHOT IS OF A MOMENT, NOT A MONTH (architecture review, 2026-10-19): two taken this month were both titled
// "October 2026". Titled by the moment it was taken, in the documents' fixed form (localStamp, the "Generated:" stamp).
const at16 = localStamp("2026-10-16T09:00:00Z"), at17 = localStamp("2026-10-17T09:00:00Z");
ck("the readiness list reads \"Saved snapshots\", newest first, each titled by its moment, to Reopen or delete",
   text(list("readiness")).startsWith(`|Saved snapshots (2)|${at17}|Saved ${at17}`) && text(list("readiness")).includes(`|${at16}|`)
   && !text(list("readiness")).includes("October 2026") && (text(list("readiness")).match(/Reopen/g) ?? []).length === 2,
   text(list("readiness")));
ck("  ...the moment in the fixed form, never a locale's", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at17), at17);
ck("  ...and its delete button says snapshot, and which", new RegExp(`aria-label="Delete saved snapshot for ${at17}" title="Delete this saved snapshot"`).test(list("readiness")),
   (list("readiness").match(/aria-label="[^"]*"/g) ?? []));
ck("what a kind is about: the recap and the statement a month, the snapshot a moment",
   ["recap", "spend", "readiness"].map((k) => D.DOCUMENT_KINDS[k].about).join() === "month,month,moment");
ck("the recap's and the statement's lists keep their words, titled by their month", text(list("recap")).startsWith("|Saved recaps (1)|September 2026|")
   && text(list("spend")).startsWith("|Saved statements (1)|") && /Delete saved statement for September 2026/.test(list("spend")));
ck("  ...and a kind with nothing saved draws nothing", draw(h(SavedDocumentRows, { kind: "spend", docs: docs.slice(0, 2), onOpen: () => {}, onRemove: () => {} })) === "");

console.log("\n  one set of inputs, built once; each kind makes its own document from it (architecture review, 2026-10-19):");
{
  const { readFileSync } = await import("node:fs");
  const R = await import("@/fm/fmDocuments");
  const readiness = { checks: [{ id: "c", label: "Check", state: "pass", detail: "ok" }], passed: 1, total: 1, overall: "pass",
    availability: { total: 4, offline: ["x.a"] } };
  const inputs = { fm: { ...data, completions: [], costs: [] }, terms: { currency: "", monthlyCap: 0, warnAt: 0.8 }, readiness, villaName: "V",
    deviceOfRecord: (id) => id };
  const strip = (md) => md.replace(/^\*\*Generated:\*\* .*$/m, "");   // the moment it is made
  ck("each kind's build is its document, from the one set of inputs",
     strip(D.DOCUMENT_KINDS.recap.build(inputs, "2026-09")) === strip(R.buildMonthlyRecap({ ...inputs, month: "2026-09" }))
     && strip(D.DOCUMENT_KINDS.spend.build(inputs, "2026-09")) === strip(R.buildSpendStatement(inputs.fm, "2026-09", "V", inputs.terms))
     && strip(D.DOCUMENT_KINDS.readiness.build(inputs, "2026-10")) === strip(R.buildReadinessSnapshot(readiness, "V", "2026-10")));
  ck("  ...and the recap's device section is the readiness' own devices", D.DOCUMENT_KINDS.recap.build(inputs, "2026-09").includes("**3 of 4** devices reporting"));
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  const fs = src("components/fm/FacilitySections.tsx");
  const tabs = ["RecapTab", "SpendTab", "ReadinessTab"].map((t) => src(`components/fm/${t}.tsx`).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""));
  ck("the inputs are built once, in FacilitySections, and handed to the three tabs; each tab only draws",
     (fs.match(/: DocumentInputs => \(\{ fm: data, terms, readiness, villaName, deviceOfRecord \}\)/g) ?? []).length === 1
     && (fs.match(/inputs=\{inputs\}/g) ?? []).length === 3
     && tabs.every((t) => /useMonthlyDocument\("(recap|spend|readiness)", inputs\)/.test(t) && !/build(MonthlyRecap|SpendStatement|ReadinessSnapshot)|useDeviceIdentity|resolveSiteTitle/.test(t)));
}

done("✅ recaps, statements and snapshots: one way to make, save, reopen and download, each by its own name");

