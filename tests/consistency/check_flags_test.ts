// tests/consistency/check_flags_test.ts
// Run: npm run test:check-flags   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`.
//
// ⚠️ THE REDUCTION WAS SEALED BEHIND A `fetch`. `loadCheckFlags` fetched the
// audit rows and then folded them into one Flag per run — a four-verdict state
// machine, a person-vs-villa attribution rule, a subject-less-row branch and a
// mirrored literal whose own comment says a typo "would silently mis-file a
// flag's whole life". None of it could be run without a server.
//
// Its docstring records what that cost: "the first cut mapped rows 1:1, so
// pressing Investigate made the flag appear TWICE, both copies 'Settled'.
// Reported from a screenshot the same day it shipped."

import { AWAITING_VERDICT, flagsFromAuditRows }
  from "../../src/vesta/supervise/agentApi.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

const row = (over: Record<string, unknown>) => ({
  run_id: "r1-e1", tool: "run:scheduled", verdict: "", detail: "", at: "",
  subject: "", actor: "", ...over,
});

// ── one flag per run, however many rows tell its story ──────────────────────
{
  // ⚠️ THE EXACT SHAPE THAT SHIPPED WRONG: the queued row, then the pressed
  // approval, then the run's own end row. Mapping 1:1 drew this twice.
  const flags = flagsFromAuditRows([
    row({ subject: "Pool pump", verdict: AWAITING_VERDICT, at: "T1",
          detail: "drifted" }),
    row({ subject: "Pool pump", verdict: "confirmed", at: "T2",
          tool: "run:approved", detail: "it really had" }),
    row({ verdict: "answered", at: "T3" }),
  ]);
  check("three rows about one run are ONE flag", flags.length === 1,
    JSON.stringify(flags.map((f) => f.runId)));
  const f = flags[0];
  check("it keeps the subject the first row named", f?.subject === "Pool pump");
  check("it is flagged when it was queued", f?.flaggedAt === "T1");
  check("and settled when the verdict landed", f?.settledAt === "T2");
  check("the run's own end row is the run status, not the verdict",
    f?.runStatus === "answered" && f?.verdict === "confirmed",
    `${f?.runStatus} / ${f?.verdict}`);
}

// ── who settled it ──────────────────────────────────────────────────────────
{
  // ⚠️ `run:approved` IS THE PERSON MARKER. The queued row and an automatic
  // investigation both carry the check's own trigger; only a pressed button
  // records `approved`. "Settled by the villa itself" on something a person
  // decided is the reading this attribution exists to prevent.
  const pressed = flagsFromAuditRows([
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T1" }),
    row({ subject: "s", verdict: "confirmed", at: "T2", tool: "run:approved" }),
  ])[0];
  check("a pressed button settles it as a person", pressed?.settledBy === "person");

  const automatic = flagsFromAuditRows([
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T1" }),
    row({ subject: "s", verdict: "confirmed", at: "T2", tool: "run:scheduled" }),
  ])[0];
  check("an automatic investigation settles it as the villa",
    automatic?.settledBy === "villa");

  const dismissed = flagsFromAuditRows([
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T1" }),
    row({ subject: "s", verdict: "dismissed", at: "T2", actor: "owner",
          detail: "not worth chasing" }),
  ])[0];
  check("a dismissal is a person, by its actor", dismissed?.settledBy === "person");
  check("...and its detail is the note, not the reason",
    dismissed?.dismissNote === "not worth chasing" && dismissed?.reason === "",
    JSON.stringify(dismissed));
}

// ── still waiting ───────────────────────────────────────────────────────────
{
  const waiting = flagsFromAuditRows([
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T1", detail: "why" }),
  ])[0];
  check("an unanswered flag is not settled",
    waiting?.settledAt === "" && waiting?.settledBy === "",
    JSON.stringify(waiting));
  // ⚠️ A RE-QUEUE ADDS NOTHING. Pressing Investigate twice must not settle it.
  const requeued = flagsFromAuditRows([
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T1" }),
    row({ subject: "s", verdict: AWAITING_VERDICT, at: "T2" }),
  ])[0];
  check("a second queueing leaves it waiting",
    requeued?.settledAt === "" && requeued?.verdict === AWAITING_VERDICT);
}

// ── what is NOT a flag ──────────────────────────────────────────────────────
{
  check("a subject-less row cannot start a flag",
    flagsFromAuditRows([row({ verdict: "confirmed", at: "T1" })]).length === 0,
    "a run row with no subject is the model investigating something it named");
  check("a row that is not a run is not a flag",
    flagsFromAuditRows([row({ subject: "s", tool: "pass:scheduled" })]).length === 0);
  check("a run id without the escalation marker is not a flag",
    flagsFromAuditRows([row({ subject: "s", run_id: "r1" })]).length === 0);
  check("rubbish in the list is skipped, not thrown over",
    flagsFromAuditRows([null, 7, "x", row({ subject: "s" })] as never).length === 1);
  check("no rows is no flags", flagsFromAuditRows([]).length === 0);
}

// ── two runs stay two flags ─────────────────────────────────────────────────
{
  const flags = flagsFromAuditRows([
    row({ run_id: "a-e1", subject: "one", verdict: AWAITING_VERDICT, at: "T1" }),
    row({ run_id: "b-e1", subject: "two", verdict: AWAITING_VERDICT, at: "T2" }),
    row({ run_id: "a-e1", subject: "one", verdict: "confirmed", at: "T3" }),
  ]);
  check("two runs are two flags", flags.length === 2);
  check("...and the later row settled only its own",
    flags.find((f) => f.runId === "a-e1")?.settledAt === "T3"
    && flags.find((f) => f.runId === "b-e1")?.settledAt === "");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
