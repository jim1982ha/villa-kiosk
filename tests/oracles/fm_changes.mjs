// How a Facility record changes (src/fm/fmEngine, round 10, 2.496.159) — the
// transitions that lived inside FmDataContext's React mutators, driven by
// value with a fixed clock and ids.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const E = await import("@/fm/fmEngine");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
let n = 0;
const k = (now = "2026-09-27T10:00:00.000Z") => ({ now, id: (p) => `${p}${++n}` });
const cost = { amount: 100, label: "Part" };

const c1 = E.withCompletion(EMPTY_FM_DATA, { scheduleId: "s", at: "2026-09-27T09:00:00.000Z", by: "Op", photoIds: ["p1"] }, cost, k());
const done = c1.completions[0], spend = c1.costs[0];
ck("a completion with a cost: linked, and the cost takes the completion's date and photos",
   done.costId === spend.id && spend.at === done.at && spend.photoIds.join() === "p1");
const lessCost = E.withoutCost(c1, spend.id);
ck("erasing the cost keeps the work, without a dangling link", lessCost.costs.length === 0 && lessCost.completions.length === 1 && lessCost.completions[0].costId === undefined);
const lessDone = E.withoutCompletion(c1, done.id);
ck("erasing the completion erases its cost too (one event)", lessDone.completions.length === 0 && lessDone.costs.length === 0);

const t0 = { ...EMPTY_FM_DATA, tickets: [{ id: "t1", status: "open", openedAt: "2026-09-26T00:00:00.000Z", photoIds: ["a"], title: "Leak" }] };
const picked = E.withTicketAdvanced(t0, "t1", "in_progress", { who: "Op", photoIds: ["b"] }, undefined, k("2026-09-27T08:00:00.000Z"), "Facility manager");
ck("picking a fault up is a step: no completion, no resolution time, the photo joins the fault",
   picked.completions.length === 0 && picked.tickets[0].resolvedAt === undefined && picked.tickets[0].photoIds.join() === "a,b" && picked.tickets[0].updates.length === 1);
const fixed = E.withTicketAdvanced(picked, "t1", "resolved", { who: "Op", note: "Fixed", photoIds: ["c"] }, cost, k("2026-09-27T12:00:00.000Z"), "Owner");
ck("resolving files ONE completion linked to the fault, with its cost, stamped now",
   fixed.completions.length === 1 && fixed.completions[0].ticketId === "t1" && fixed.costs.length === 1
   && fixed.completions[0].costId === fixed.costs[0].id && fixed.tickets[0].resolvedAt === "2026-09-27T12:00:00.000Z");
const reopened = E.withTicketAdvanced(fixed, "t1", "open", { photoIds: [] }, undefined, k());
ck("reopening clears the resolution time (a stale one corrupts every MTTR figure)", reopened.tickets[0].resolvedAt === undefined);
{
  // review 26: a reopening is a step of its own kind, read by the VESTA Agent; every step records the profile, the
  // typed name apart — "Mark resolved" kept only the typed name, so Telegram said "by Facility manager" for one close
  // and nothing for the other
  const [p, f, r] = [picked, fixed, reopened].map((d) => d.tickets[0].updates.at(-1));
  ck("a reopening says it is one (kind reopened); picking up and resolving are plain status steps",
     r.kind === "reopened" && p.kind === undefined && f.kind === undefined, [p.kind, f.kind, r.kind]);
  ck("  ...and moving an OPEN fault to open is no reopening",
     E.withTicketAdvanced(t0, "t1", "open", { photoIds: [] }, undefined, k()).tickets[0].updates.at(-1).kind === undefined);
  ck("every step records the profile that recorded it and the name typed for who did it",
     p.by === "Facility manager" && p.who === "Op" && f.by === "Owner" && f.who === "Op", [p, f]);
  ck("  ...the work done is the typed name's, else the profile's",
     fixed.completions[0].by === "Op"
     && E.withTicketAdvanced(picked, "t1", "resolved", { photoIds: [] }, undefined, k(), "Owner").completions[0].by === "Owner");
}
ck("an unknown fault changes nothing", E.withTicketAdvanced(t0, "nope", "resolved", { photoIds: [] }, cost, k()) === t0);
const patched = E.withTicketPatch(t0, "t1", { status: "resolved" }, { now: "2026-09-27T13:00:00.000Z" });
ck("a patch to resolved stamps the time; one that keeps it keeps it",
   patched.tickets[0].resolvedAt === "2026-09-27T13:00:00.000Z"
   && E.withTicketPatch(patched, "t1", { status: "resolved" }, { now: "later" }).tickets[0].resolvedAt === "2026-09-27T13:00:00.000Z");

const ctx = readFileSync(new URL("../../src/fm/FmDataContext.tsx", import.meta.url), "utf8");
ck("the provider only calls them (no transition written inside a mutator)",
   /withCompletion\(d, c, cost, stamp\(\)\)/.test(ctx) && /withTicketAdvanced\(d, id, to, step, cost, stamp\(\), role \? ROLE_LABELS\[role\] : undefined\)/.test(ctx)
   && /withoutCost\(d, id\)/.test(ctx) && /withoutCompletion\(d, id\)/.test(ctx) && !/resolvedAt:/.test(ctx));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ every Facility record change, reachable and checked");
