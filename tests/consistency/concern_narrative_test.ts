// tests/concern_narrative_test.ts
// Run: npm run test:concern-narrative   (node strips the types; no runner)
//
// ⚠️ NONE OF THIS WAS REACHABLE UNTIL 2026-09-06. These ~140 lines lived inside
// a 760-line component that imports React, so the bare-node harness could not
// load them, and six Python probes sliced the .tsx by string index instead —
// one of them asserting the SPELLING of a guard rather than its behaviour.

import {
  BANDS, HELP_STEPS, chaseLine, helpLine, offers, sentSummary,
} from "../../src/vesta/shared/concernNarrative.ts";
import { whenShort } from "../../src/vesta/shared/when.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}
const T0 = Date.parse("2026-09-06T12:00:00Z");
const ago = (mins: number) => new Date(T0 - mins * 60000).toISOString();

console.log("— offers: the tablet renders what the server sent —");
check("an act the server offers is drawn",
  offers({ acts: [{ id: "done", glyph: "x" }] } as never, "done") === true);
check("an act it does not offer is not",
  offers({ acts: [{ id: "dismiss", glyph: "x" }] } as never, "done") === false);
// ⚠️ THE DEFECT THIS REPLACED: a fixed row of buttons gated on the reader's ROLE.
check("absent acts means NO acts, never 'draw everything'",
  offers({} as never, "done") === false);

console.log("\n— chaseLine: only a critical is ever chased —");
check("a notice predicts nothing",
  chaseLine({ severity: "notice", delivered_at: ago(20) } as never, T0) === null);
check("an acknowledged critical predicts nothing",
  chaseLine({ severity: "critical", delivered_at: ago(20),
              acknowledged_at: "x" } as never, T0) === null);
check("an undelivered critical predicts nothing",
  chaseLine({ severity: "critical" } as never, T0) === null);

console.log("\n— chaseLine: the bands, which no gate could reach before —");
{
  const at = (m: number) =>
    chaseLine({ severity: "critical", delivered_at: ago(m) } as never, T0);
  check("inside the first band it names the first step",
    (at(5) ?? "").includes(BANDS[0][1]), `got ${at(5)}`);
  check("past the first band it names the second",
    (at(20) ?? "").includes(BANDS[1][1]), `got ${at(20)}`);
  check("past every band it says so instead of predicting",
    at(999) === "Not acknowledged — every escalation step has been taken.");
  // ⚠️ AN UNPARSEABLE STAMP MUST NOT PRODUCE "Invalid Date" ON THE WALL.
  check("an unreadable delivery stamp predicts nothing",
    chaseLine({ severity: "critical", delivered_at: "nonsense" } as never, T0) === null);
}

console.log("\n— chaseLine: a taken step stops predicting —");
check("an escalated concern reports what happened, not what is due",
  (chaseLine({ severity: "critical", delivered_at: ago(20),
               escalated_step: "add the owner",
               escalated_at: ago(5) } as never, T0) ?? "").startsWith("Escalated"));

console.log("\n— helpLine: it speaks for ANY severity, unlike chaseLine —");
{
  const ops = Object.keys(HELP_STEPS).find((k) => k.includes("facility"))!;
  const line = helpLine({ severity: "notice", escalated_step: ops,
                          escalated_at: ago(3) } as never);
  check("a notice with help asked still says so", (line ?? "").length > 0);
  check("...and names who was asked",
    (line ?? "").includes(HELP_STEPS[ops]), `got ${line}`);
  check("no help asked means no line",
    helpLine({ severity: "critical" } as never) === null);
  check("an ordinary escalation is not mistaken for help",
    helpLine({ escalated_step: "add the owner" } as never) === null);
}

console.log("\n— sentSummary: who it reached —");
check("with no delivery list it falls back to the audience",
  sentSummary({ audience: "facility", delivered_at: ago(10) } as never)
    .startsWith("sent to "));
check("with a list it names each in order",
  sentSummary({ deliveries: [{ profile: "owner", at: ago(30) },
                             { profile: "ops", at: ago(10) }] } as never)
    .includes(", then "));

// ── the Concern's stamp is the app's ONE stamp ────────────────────────────
{
  // ⚠️ NOT THE FORMAT — TIED TO THE SHARED ONE. `sentSummary` carried a ninth
  // hand-written copy of `whenShort`, character for character, in the module
  // both the Wall tablet and the Chat read. Asserting the rendered string would
  // pin PRESENTATION, which this repo rejects; asserting that the two agree
  // pins the consolidation, and stays true when the format changes.
  const iso = "2026-08-27T09:23:55Z";
  const line = sentSummary({
    id: "c1", audience: "owner", delivered_at: iso,
  } as never);
  const shared = whenShort(iso, "blank");
  check("the sent line stamps its time with the app's shared formatter",
    shared !== "" && line.includes(shared), `line=${line} shared=${shared}`);

  const bad = sentSummary({ id: "c1", audience: "owner",
                            delivered_at: "not a time" } as never);
  check("...and an unreadable time renders as nothing, not as raw text",
    !bad.includes("not a time"), bad);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
