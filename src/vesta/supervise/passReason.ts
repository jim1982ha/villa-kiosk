// src/vesta/supervise/passReason.ts
//
// WHAT A TRIAGE PASS ACTUALLY DID — the consumer half of a two-language
// contract whose producer is `agent/scheduler.py` and `agent/audit.py`.
//
// ⚠️ EXTRACTED BECAUSE THE ONLY THING PINNING IT WAS A `grep`. These rules
// lived in `RecentChecks.tsx`, and node refuses the `.tsx` extension outright —
// so `test_pass_reason_contract.py`, which derives the PRODUCER's literals from
// `scheduler.py` honestly, could only assert `"outcomeOf(" in panel` about the
// consumer. The half that classifies Triage's own verdict had never run.
//
// The stakes, from that test's own docstring: "Reword `"nothing to escalate"`
// and the Handover page silently reclassifies every quiet pass as 'could not
// run' — the panel whose entire purpose is separating 'looked and agreed' from
// 'never ran' would invert exactly that distinction, and it would render as a
// villa whose supervision had failed."
//
// ⚠️ IMPORTS NOTHING AT RUNTIME. `TriagePass` is a type-only import, which node
// erases. Keep it that way.

/** The one field `reasonOf` needs. ⚠️ DECLARED HERE RATHER THAN IMPORTED FROM
 *  `agentApi`, which imports THIS module — a type-only import would be erased
 *  at runtime and harmless, but taking the minimal shape means this module has
 *  no edge to the transport at all, and any row carrying a `detail` fits. */
export interface HasDetail { detail?: string }

/** What a check actually did.
 *
 *  ⚠️ THREE, NOT THE TWO THE STORE HOLDS. `blocked` is every reason that is not
 *  one of the two the triage path produces when it ran, derived BY EXCLUSION so
 *  a new guard in `scheduler._run_once` lands here as "could not run" without
 *  anybody remembering to update this file. */
export type PassOutcome = "raised" | "quiet" | "blocked";

/** The producer's two literals. ⚠️ CHANGE EITHER AND `test_pass_reason_contract`
 *  goes red on the Python side, which derives them from `scheduler.py`. */
export const ESCALATED_PREFIX = "escalated ";
export const QUIET_REASON = "nothing to escalate";

export function outcomeOf(reason: string): PassOutcome {
  if (reason.startsWith(ESCALATED_PREFIX)) return "raised";
  if (reason === QUIET_REASON) return "quiet";
  return "blocked";
}

/** The human half of `detail`: `audit.record_pass` joins the reason and the
 *  numbers with " | ", and everything after the first separator is the numbers. */
export const reasonOf = (p: HasDetail) =>
  (p.detail || "").split(" | ")[0].trim();

/** How many of a check's flags are still WAITING, out of `Followup.clause`'s
 *  "3 left for next pass".
 *
 *  ⚠️ THE HEADING SAID "5 items flagged" OVER TWO CARDS AND EXPLAINED NOTHING
 *  (2026-08-28, reported). Both halves were true and nothing joined them:
 *  `pass.escalated` is what TRIAGE flagged, while a card is drawn per audit row
 *  carrying a subject — and only an INVESTIGATED flag gets one. The others were
 *  deferred by the cost cap, so they exist, are named in the pass record, and
 *  had nowhere on screen to be.
 *
 *  ⚠️ THE NUMBER WAS ALREADY ON THE ROW, so this READS the third figure rather
 *  than deriving it by subtraction — a check that stopped for a DIFFERENT
 *  reason (budget, a provider outage) must not be counted as deferred. */
export function deferredOf(reason: string): number {
  const m = /(\d+) left for next pass/.exec(reason);
  return m ? Number(m[1]) : 0;
}

/** How many subjects a check INVESTIGATED and how many concerns came back, out
 *  of `Followup.clause` ("investigated 3, 1 concern").
 *
 *  ⚠️ THIS IS WHERE THE MONEY GOES AND THE PAGE WAS BLIND TO IT: "reached 0 of
 *  24" cannot be told apart from an assistant that looked twenty times and
 *  correctly concluded nothing, which `reason.SYSTEM` instructs outright. */
export function yieldOf(reason: string): { looked: number; raised: number } {
  const looked = /investigated (\d+)/.exec(reason);
  const raised = /(\d+) concerns?/.exec(reason);
  return { looked: looked ? Number(looked[1]) : 0,
           raised: raised ? Number(raised[1]) : 0 };
}

/** The check a flag belongs to: its own id with the `-eN` suffix removed.
 *  ⚠️ ONLY A TRAILING ONE — an id containing `-e` mid-string keeps it. */
export const checkIdOf = (flagRunId: string) => flagRunId.replace(/-e\d+$/, "");
