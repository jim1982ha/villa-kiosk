// src/components/agent/RecentChecks.tsx
//
// The triage trace: did the villa look, and what happened when it did.
//
// ⚠️ EXTRACTED BECAUSE THE TRIAGE TAB WAS BLANK (2.753.0). It rendered a step
// header and `AgentQueue`, and that component correctly returns `null` in
// `auto` mode — its own comment says an empty approval queue on a villa that
// investigates by itself "is not information, it is the permanent and correct
// state". That reasoning was written when it was one block among many on a
// crowded page. On a tab whose entire job is to show this tier, it left a
// heading over nothing, which is the
// silent-subsystem defect this project keeps paying for: correct behaviour that
// reads as a broken feature. The tier's real output was already being recorded
// and was only visible on the Handover page, three clicks away under Advanced.
//
// ⚠️ THE PASS→OUTCOME RULES LIVE HERE NOW (2.756.0). They were in
// `ShadowDiffPanel`, which is deleted — its comparison could never produce a
// comparison again once the automations were retired. This is their only
// consumer, and `test_pass_reason_contract.py` follows them here: they parse
// string literals that `agent/scheduler.py` and `agent/audit.py` produce, in
// two languages, with nothing but a pin between them.

import { Pager, usePaged } from "@/components/common/Paged";
import type { TriagePass } from "@/agent/agentApi";


/** What a pass actually did. ⚠️ THREE, NOT THE TWO THE STORE HOLDS — see the
 *  header. `blocked` is every reason that is not one of the two the triage path
 *  produces when it ran, which is why it is derived by exclusion: a new guard
 *  added to `scheduler._run_once` returns a new reason string and lands here as
 *  "could not run" without anybody remembering to update this file. */
export type PassOutcome = "raised" | "quiet" | "blocked";

export function outcomeOf(reason: string): PassOutcome {
  if (reason.startsWith("escalated ")) return "raised";
  if (reason === "nothing to escalate") return "quiet";
  return "blocked";
}

/** The human half of `detail`: `audit.record_pass` joins the reason and the
 *  numbers with " | ", and everything after the first separator is the numbers. */
export const reasonOf = (p: TriagePass) => (p.detail || "").split(" | ")[0].trim();

/** How many subjects a pass INVESTIGATED and how many concerns came back, out
 *  of `Followup.clause` ("investigated 3, 1 concern").
 *
 *  ⚠️ THIS IS WHERE THE MONEY GOES AND THE PAGE WAS BLIND TO IT. An
 *  investigation is a frontier-model run; "reached 0 of 24" reads as an
 *  assistant that is not working, and cannot be told apart from one that
 *  looked twenty times and correctly concluded nothing — which `reason.SYSTEM`
 *  instructs outright ("finding nothing is a good outcome and a complete
 *  answer"). Both numbers were already in the sentence; neither was on screen. */
export function yieldOf(reason: string): { looked: number; raised: number } {
  const looked = /investigated (\d+)/.exec(reason);
  const raised = /(\d+) concerns?/.exec(reason);
  return { looked: looked ? Number(looked[1]) : 0,
           raised: raised ? Number(raised[1]) : 0 };
}

/** `escalated 2 (investigated 2): A, B` → `A, B`. */
export const subjectsOf = (reason: string) => {
  const i = reason.indexOf(": ");
  return i < 0 ? "" : reason.slice(i + 2).trim();
};


export default function RecentChecks({ passes, empty, children }: {
  passes: TriagePass[];
  /** What to say when nothing has run. ⚠️ DIFFERENT PER TAB: on Handover an
   *  empty trace invalidates the comparison above it; on Triage it just means
   *  the villa has not looked yet. */
  empty: React.ReactNode;
  /** Anything for the pager's own row — the CSV button, on Handover. */
  children?: React.ReactNode;
}) {
  const rows = [...passes].reverse().map((p) => {
    const reason = reasonOf(p);
    return { pass: p, reason, outcome: outcomeOf(reason) };
  });
  const paged = usePaged(rows);

  if (rows.length === 0) return <p className="muted body-text">{empty}</p>;

  // ⚠️ THE ONE FIGURE THAT SAYS WHERE THE MONEY WENT, and it moved here in
  // 2.756.0 when the Handover page was deleted. An investigation is a
  // frontier-model run; "N raised" alone reads as broken and "M investigated"
  // alone reads as busy. Together they are the honest measure, and the gap
  // between them is a deliberate instruction (`reason.SYSTEM`: "finding
  // nothing is a good outcome and a complete answer"), not a fault.
  const work = rows.reduce((acc, r) => {
    const y = yieldOf(r.reason);
    return { looked: acc.looked + y.looked, raised: acc.raised + y.raised };
  }, { looked: 0, raised: 0 });

  return (
    <>
      {work.looked > 0 && (
        <p className="muted body-text">
          {work.looked} looked into, {work.raised} raised as a concern.
        </p>
      )}
      <Pager paged={paged} unit="check">{children}</Pager>
      {/* ⚠️ `.fm-list` — WHICH IS A FLEX COLUMN OF ROWS, NOT A BULLETED LIST.
          It was the one list class in styles.css that did not reset
          `list-style`, so every row here drew a marker; reported as clutter. */}
      <ul className="fm-list">
        {paged.page.map(({ pass, reason, outcome }, i) => {
          const who = subjectsOf(reason);
          return (
            <li key={`${pass.at}-${i}`} className="body-text">
              <span className="muted">
                {pass.at.replace("T", " ").slice(0, 16)}
              </span>{" · "}
              {/* ⚠️ PLAIN LANGUAGE, AND THE NUMBERS ONLY WHERE THEY CHANGE A
                  READING. `doc=5246c/51L | escalated=0 | model=…` on thirty rows
                  is the same string thirty times; the one part that ever matters
                  — a pass handed nothing to read — is called out below, and all
                  of it survives in the CSV. */}
              {outcome === "raised" ? (
                <>
                  <strong>Raised {pass.escalated ?? ""}</strong>
                  {who ? <> — {who}</> : null}
                </>
              ) : outcome === "quiet" ? (
                <>Looked, nothing to raise</>
              ) : (
                <>
                  <strong className="sev-warning">Could not run</strong>
                  {" — "}{reason}
                </>
              )}
              {/* ⚠️ NOT ON A BLOCKED ROW. A pass that never reached the model has
                  no document by construction, so this would fire on every "could
                  not run" row and say a second thing about a row that has
                  already explained itself. The fault it reports is a pass that
                  RAN on nothing. */}
              {outcome !== "blocked" && pass.docChars === 0 && (
                <span className="sev-warning"> · nothing to read</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
