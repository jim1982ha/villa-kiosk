// src/components/agent/RecentChecks.tsx
//
// The triage trace: did the villa look, what did it flag, and what became of it.
//
// ⚠️ ONE SECTION SINCE 2.780.0, AND THE MERGE IS THE POINT. "Recent checks" and
// "Flagged checks" were two lists at two GRANULARITIES — one row per CHECK, and
// one row per FLAG — sitting one above the other with nothing saying they were
// the same events seen twice. A reader had to hold "this check raised 3" beside
// three rows elsewhere and pair them by eye. Now a flag is drawn INSIDE the
// check that raised it.
//
// ⚠️ THE PAIRING IS AN EXACT KEY, NOT A TIMESTAMP GUESS. `audit.record_pass`
// stored `run_id: ""` until 2.780.0, so the only way to pair a check with its
// flags was to compare clocks and hope — which goes wrong precisely when a
// manual check overlaps the scheduled one, the case this screen exists to show.
// `scheduler.run_once` now mints ONE instant for the whole check, so a flag's
// id is the check's id plus `-eN` and `checkIdOf` strips it back.
//
// ⚠️ THE THREE MODES DRAW THE SAME CARD WITH A DIFFERENT AFFORDANCE, because
// what a flag CAN become differs by mode and nothing on screen used to say so:
//   Flag & Ask                   → Investigate / Cancel. It is waiting for you.
//   Investigate & Log Only       → a briefing mark. Already looked at; the
//                                  finding is in your next briefing.
//   Investigate & Log +Escalation → whether a Concern came out of it, and
//                                  concerns live on the Reason tab.
//
// ⚠️ THE PASS→OUTCOME RULES LIVE HERE (2.756.0). They parse literals that
// `agent/scheduler.py` and `agent/audit.py` produce, in two languages, with
// `test_pass_reason_contract.py` as the only thing holding them together.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X, FileText, AlertCircle, MinusCircle } from "lucide-react";

import { PAGE_CARDS, Pager, usePaged } from "@/components/common/Paged";
import {
  checkIdOf, decideEscalation, loadCheckFlags, loadConcerns,
  type CheckFlag, type TriagePass,
} from "@/agent/agentApi";
import type { Concern } from "@/agent/agentTypes";


/** What a check actually did. ⚠️ THREE, NOT THE TWO THE STORE HOLDS — `blocked`
 *  is every reason that is not one of the two the triage path produces when it
 *  ran, derived by exclusion so a new guard in `scheduler._run_once` lands here
 *  as "could not run" without anybody remembering to update this file. */
export type PassOutcome = "raised" | "quiet" | "blocked";

export function outcomeOf(reason: string): PassOutcome {
  if (reason.startsWith("escalated ")) return "raised";
  if (reason === "nothing to escalate") return "quiet";
  return "blocked";
}

/** The human half of `detail`: `audit.record_pass` joins the reason and the
 *  numbers with " | ", and everything after the first separator is the numbers. */
export const reasonOf = (p: TriagePass) => (p.detail || "").split(" | ")[0].trim();

/** How many subjects a check INVESTIGATED and how many concerns came back, out
 *  of `Followup.clause` ("investigated 3, 1 concern"). ⚠️ THIS IS WHERE THE
 *  MONEY GOES AND THE PAGE WAS BLIND TO IT: "reached 0 of 24" cannot be told
 *  apart from an assistant that looked twenty times and correctly concluded
 *  nothing, which `reason.SYSTEM` instructs outright. */
export function yieldOf(reason: string): { looked: number; raised: number } {
  const looked = /investigated (\d+)/.exec(reason);
  const raised = /(\d+) concerns?/.exec(reason);
  return { looked: looked ? Number(looked[1]) : 0,
           raised: raised ? Number(raised[1]) : 0 };
}

/** `escalated 2 (investigated 2): A, B` → `A, B`. ⚠️ THE FALLBACK ONLY. The
 *  audit carries the flags as rows with their own ids; this recovers the NAMES
 *  from the sentence for checks written before 2.780.0, which have no key. */
export const subjectsOf = (reason: string) => {
  const i = reason.indexOf(": ");
  return i < 0 ? "" : reason.slice(i + 2).trim();
};


/** One flag, drawn inside the check that raised it. */
function FlagRow({ flag, mode, concern, busy, onDecide }: {
  flag: CheckFlag;
  mode: string;
  concern?: Concern;
  busy: boolean;
  onDecide: (runId: string, action: "approve" | "dismiss") => void;
}) {
  const waiting = flag.verdict === "awaiting-approval";
  return (
    <li className="fm-row body-text">
      <span style={{ flex: 1 }}>{flag.subject}</span>

      {/* ⚠️ THE AFFORDANCE FOLLOWS THE FLAG'S STATE FIRST AND THE MODE SECOND.
          A villa switched from Flag & Ask to Alert me still has flags that were
          left waiting, and they remain answerable — reading the mode alone
          would strand them with no way to act, which is how the queue reached
          twenty-four items nothing could drain. */}
      {waiting ? (
        <>
          <button className="icon-btn" disabled={busy}
                  aria-label={`Investigate ${flag.subject}`}
                  title="Click to investigate"
                  onClick={() => onDecide(flag.runId, "approve")}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden />
                  : <Search size={16} aria-hidden />}
          </button>
          <button className="icon-btn" disabled={busy}
                  aria-label={`Cancel ${flag.subject}`}
                  title="Don\u2019t investigate and dismiss"
                  onClick={() => onDecide(flag.runId, "dismiss")}>
            <X size={16} aria-hidden />
          </button>
        </>
      ) : concern ? (
        /* ⚠️ ONLY REACHABLE BECAUSE A CONCERN NOW RECORDS ITS `run_id`
           (2.780.0). Before that a concern named its subject as a HASH of an
           entity id the flag usually does not carry, so this could only ever
           have said "no concern" — including when there was one. */
        <span className="sev-warning" title={`Raised a concern: ${concern.title}. It is on the Reason tab.`}>
          <AlertCircle size={16} aria-hidden /> Concern
        </span>
      ) : mode === "live" ? (
        <span className="muted" title="Looked into it and concluded nothing worth raising. That is a complete answer, not a failure.">
          <MinusCircle size={16} aria-hidden /> Nothing raised
        </span>
      ) : (
        <span className="muted" title="Investigated. Anything it concluded appears in your next briefing.">
          <FileText size={16} aria-hidden /> In the briefing
        </span>
      )}
    </li>
  );
}


export default function RecentChecks({ passes, empty, mode, canAct, children }: {
  passes: TriagePass[];
  /** What to say when nothing has run. */
  empty: React.ReactNode;
  /** The villa's supervision mode — decides what a settled flag shows. */
  mode?: string;
  /** Owner only: the two buttons spend the budget, and the proxy refuses them
   *  for anybody else regardless. Hidden rather than disabled, so a reader is
   *  never shown a control that could only ever 403. */
  canAct?: boolean;
  children?: React.ReactNode;
}) {
  const [flags, setFlags] = useState<CheckFlag[]>([]);
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  const load = useCallback(async () => {
    const [f, c] = await Promise.all([loadCheckFlags(), loadConcerns()]);
    setFlags(f);
    setConcerns(c);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (runId: string, action: "approve" | "dismiss") => {
    setBusy(runId);
    setNote("");
    let out: { ok: boolean; reason: string };
    // ⚠️ `finally`, SO THE SPINNER ALWAYS COMES BACK. A spinner that can outlive
    // its request is the defect this pair exists to prevent, and the guarantee
    // belongs at both ends rather than depending on the helper never rejecting.
    try { out = await decideEscalation(runId, action); }
    finally { setBusy(null); }
    if (!out.ok) setNote(out.reason || "it could not be started");
    else setNote(action === "approve"
      // ⚠️ IT MUST NOT PROMISE A FINDING. An investigation is allowed to
      // conclude nothing, and on this villa one did — eleven tool calls and no
      // concern. Anything stronger is a claim this button cannot verify.
      ? "Looked into. If it concluded anything it is on the Reason tab."
      : "Cancelled. It will not be looked into.");
    await load();
  }, [load]);

  // ⚠️ CARRIED OVER FROM `AgentQueue` (2.775.0), WHICH THIS REPLACES. A villa
  // left in Flag & Ask accumulates a waiting flag per check and the reference
  // villa reached TWENTY-TWO, clearable only one press at a time. Dismiss only,
  // never "investigate all": one investigation is a full frontier-model run, so
  // a bulk approve is a day's ceiling in one press with no undo. Sequential and
  // not `Promise.all` — each writes an audit row through a read-modify-write
  // store, and two dozen concurrent writes is how rows are lost.
  const cancelAll = useCallback(async () => {
    const ids = flags.filter((f) => f.verdict === "awaiting-approval")
                     .map((f) => f.runId);
    if (ids.length === 0) return;
    setNote("");
    let failures = 0;
    for (let i = 0; i < ids.length; i += 1) {
      setBusy(ids[i]);
      const out = await decideEscalation(ids[i], "dismiss");
      if (!out.ok) failures += 1;
    }
    setBusy(null);
    setNote(failures
      ? `${failures} of ${ids.length} could not be cancelled.`
      : `Cancelled ${ids.length}. Anything still true is flagged again by the `
        + "next check.");
    await load();
  }, [flags, load]);

  const waiting = flags.filter((f) => f.verdict === "awaiting-approval").length;

  const rows = [...passes].reverse().map((p) => {
    const reason = reasonOf(p);
    const id = p.runId || "";
    // ⚠️ A CHECK WITH NO ID KEEPS NO FLAGS RATHER THAN BORROWING SOMEBODY
    // ELSE'S. Rows written before 2.780.0 have `run_id: ""`, and an empty
    // prefix matches every flag — so the guard is the empty check, not the
    // match. Their subject names still show, from the sentence.
    const mine = id ? flags.filter((f) => checkIdOf(f.runId) === id) : [];
    return { pass: p, reason, outcome: outcomeOf(reason), flags: mine };
  });

  // ⚠️ A FLAG WHOSE CHECK CANNOT BE IDENTIFIED IS STILL SHOWN, and the first cut
  // of this hid fourteen of them. Checks written before 2.780.0 carry
  // `run_id: ""`, so nothing can pair them with their flags — and because the
  // flags were only ever drawn INSIDE a check, every one of those became
  // invisible the moment the two lists merged. The owner could see "Cancel all
  // 14 waiting" and not one of the fourteen. Hiding a thing the reader can act
  // on is strictly worse than the duplication the merge removed, so anything
  // unmatched gets its own card that says why it is on its own.
  const attached = new Set(rows.flatMap((r) => r.flags.map((f) => f.runId)));
  // ⚠️ WAITING ONLY, AND THE COUNT ON THE BUTTON IS THE SAME SET. The first cut
  // listed EVERY unmatched flag — fifty-four of them against a button offering
  // to cancel fourteen, which is two numbers for two different things on one
  // screen and reads as a bug in the button. Forty were already settled: their
  // check cannot be identified, so they carry no context, and their outcome
  // went to the briefing weeks ago. They had no action, no home and no reader.
  //
  // ⚠️ AND A SETTLED ORPHAN RENDERED A STATE THAT CAN BE FALSE. `FlagRow` falls
  // through to "In the briefing" for anything settled outside Escalate mode —
  // true of Investigate & Log, and NOT true in Flag & Ask, where nothing
  // reaches the briefing at all. Dropping them removes the claim with them.
  const orphans = flags.filter(
    (f) => !attached.has(f.runId) && f.verdict === "awaiting-approval");

  // ⚠️ CARDS, NOT ROWS — see `PAGE_CARDS`. Each entry here is several lines
  // with its flagged items nested under it, so the row count that suits a
  // one-line log is a scroll with no end in sight. Named constant, not a
  // literal: the rule is one owner for pagination, not one number.
  const paged = usePaged(rows, PAGE_CARDS);

  if (rows.length === 0) return <p className="muted body-text">{empty}</p>;

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
      {note && <p className="muted body-text" role="status">{note}</p>}
      {/* ⚠️ ONLY WHEN MORE THAN ONE IS WAITING. A single flag has its own
          buttons two lines below; a whole-list control beside it would be two
          ways to do one thing. */}
      {canAct && waiting > 1 && (
        <div className="modal-actions" style={{ margin: "0 0 12px" }}>
          <button className="btn ghost" disabled={busy !== null}
                  onClick={() => void cancelAll()}
                  title="Cancel every flag still waiting — spends nothing, and anything still true is flagged again by the next check">
            <X size={16} aria-hidden /> Cancel all {waiting} flagged item{waiting === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {/* ⚠️ THE UNATTACHED FLAGS, ABOVE THE CHECKS, IN ONE CARD THAT EXPLAINS
          ITSELF. These are real and answerable — they are what "Cancel all N"
          acts on — and the merge made them invisible because a flag was only
          ever drawn inside a check. They are almost always legacy: a check
          written before 2.780.0 stored no id, so nothing can say which one
          raised them. Saying that is better than either hiding them or
          guessing a parent by timestamp, which is the pairing this release
          replaced precisely because it goes wrong when checks overlap. */}
      {orphans.length > 0 && (
        <ul className="fm-list">
          <li className="body-text">
            <div>
              <strong>{orphans.length} flagged item{orphans.length === 1 ? "" : "s"}</strong>
              {" waiting, from checks recorded before "}
              <span className="muted">
                {"checks carried an id — so which check raised them is not known"}
              </span>
            </div>
            <ul className="fm-list" style={{ marginTop: 6, paddingLeft: 14 }}>
              {orphans.map((f) => (
                <FlagRow key={f.runId} flag={f} mode={mode || ""}
                         concern={concerns.find((c) => c.run_id === f.runId)}
                         busy={busy === f.runId}
                         onDecide={canAct ? decide : () => {}} />
              ))}
            </ul>
          </li>
        </ul>
      )}
      <Pager paged={paged} unit="check">{children}</Pager>
      {/* ⚠️ `.fm-list` — A FLEX COLUMN OF ROWS, NOT A BULLETED LIST. It was the
          one list class in styles.css that did not reset `list-style`, so every
          row drew a marker; reported as clutter. */}
      <ul className="fm-list">
        {paged.page.map(({ pass, reason, outcome, flags: mine }, i) => {
          const named = subjectsOf(reason);
          return (
            <li key={`${pass.at}-${i}`} className="body-text">
              <div>
                <span className="muted">
                  {pass.at.replace("T", " ").slice(0, 16)}
                </span>{" · "}
                {outcome === "raised" ? (
                  <>
                    {/* ⚠️ "N items flagged in this check", NOT "Flagged N".
                        The old form read as a verdict on the check itself —
                        the owner's wording names WHAT the number counts, which
                        matters because the same screen also counts checks. */}
                    <strong>
                      {pass.escalated ?? 0} item{pass.escalated === 1 ? "" : "s"}
                      {" flagged in this check"}
                    </strong>
                    {/* ⚠️ THE NAMES ONLY WHERE THE FLAGS THEMSELVES ARE NOT
                        DRAWN BELOW — otherwise the same subjects appear twice
                        in one card, which is the duplication this merge exists
                        to remove. */}
                    {mine.length === 0 && named ? <> — {named}</> : null}
                  </>
                ) : outcome === "quiet" ? (
                  <>Nothing to flag in this check</>
                ) : (
                  <>
                    <strong className="sev-warning">Could not run</strong>
                    {" — "}{reason}
                  </>
                )}
                {/* ⚠️ NOT ON A BLOCKED ROW. A check that never reached the model
                    has no document by construction, so this would fire on every
                    "could not run" row and say a second thing about a row that
                    has already explained itself. */}
                {outcome !== "blocked" && pass.docChars === 0 && (
                  <span className="sev-warning"> · nothing to read</span>
                )}
              </div>

              {mine.length > 0 && (
                <ul className="fm-list" style={{ marginTop: 6, paddingLeft: 14 }}>
                  {mine.map((f) => (
                    <FlagRow
                      key={f.runId}
                      flag={f}
                      mode={mode || ""}
                      concern={concerns.find((c) => c.run_id === f.runId)}
                      busy={busy === f.runId}
                      onDecide={canAct ? decide : () => {}}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
