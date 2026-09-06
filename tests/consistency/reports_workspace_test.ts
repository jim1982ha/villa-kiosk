// tests/reports_workspace_test.ts
// Run: npm run test:reports-workspace   (node strips the types; no runner)
//
// ⚠️ BOTH OF THESE COVER A DEFECT THAT SHIPPED, and neither was reachable: they
// lived inside a 536-line modal holding eleven pieces of state, so exercising
// them meant opening a browser and sending a real briefing.

import { noticeFor, visibleTabs } from "../../src/vesta/brief/reportsWorkspace.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

const TABS = [
  { id: "watched", configure: true as const },
  { id: "happened", configure: true as const },
  { id: "briefing", configure: true as const },
];

console.log("— visibleTabs: the defect fixed once and reintroduced —");
{
  const owner = visibleTabs(TABS, true);
  check("an owner sees every tab", owner.tabs.length === 3);
  check("...and opens on the first VISIBLE one, never a literal",
    owner.initial === "watched");

  // ⚠️ THE REACHABLE CASE. Every tab is owner-only, so a facility manager —
  // admitted to this dialog on a different capability — filters to nothing.
  const ops = visibleTabs(TABS, false);
  check("a reader who may not configure sees no tabs", ops.tabs.length === 0);
  check("...and gets null rather than a tab that matches no body",
    ops.initial === null);

  // ⚠️ THE MIXED CASE IS WHAT THE FIRST FIX WAS FOR: open on the first tab the
  // reader can actually see, not on the first tab in the table.
  const mixed = visibleTabs(
    [{ id: "watched", configure: true as const }, { id: "jobs" }], false);
  check("with one open tab it opens on THAT one", mixed.initial === "jobs");
}

console.log("\n— noticeFor: 'sent to nobody' must not read as success —");
{
  check("a failed request says so",
    noticeFor(null).bad === true);
  check("...and a null result is not confused with an empty one",
    noticeFor(null).text !== noticeFor({ deliveries: [] }).text);
  const none = noticeFor({ deliveries: [] });
  check("reaching nobody is BAD, not a quiet success", none.bad === true);
  check("...and says nothing was sent",
    none.text.toLowerCase().includes("nothing was sent"), none.text);
  const ok = noticeFor({ deliveries: [{ status: "sent", target: "a" }] } as never);
  check("a real send is not flagged bad", ok.bad === false);
  check("...and counts the recipients", ok.text.includes("1 recipient"), ok.text);
  const partial = noticeFor({ deliveries: [
    { status: "sent", target: "a" },
    { status: "failed", target: "b", detail: "no such entity" },
  ] } as never);
  check("a partial failure is bad and names the failure",
    partial.bad === true && partial.text.includes("no such entity"), partial.text);
  check("...and still reports what DID land",
    partial.text.includes("Sent to 1"), partial.text);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
