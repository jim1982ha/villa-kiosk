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
//   Ask first     → Investigate / Cancel. It is waiting for you.
//   Alert only    → whether an Alert came out of it; those land on the Reason
//                   tab too, marked "for your information".
//   Alert & chase → whether an Alert came out of it, and Alerts live on the
//                   Reason tab.
// (Renamed 2026-08-28 from Flag & Ask / Investigate & Log Only / Investigate &
//  Log +Escalation. The STORED ids — ask, observe, live — are unchanged.)
//
// ⚠️ THE PASS→OUTCOME RULES LIVE HERE (2.756.0). They parse literals that
// `agent/scheduler.py` and `agent/audit.py` produce, in two languages, with
// `test_pass_reason_contract.py` as the only thing holding them together.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, MinusCircle, Search, X } from "lucide-react";

import { PAGE_CARDS, Pager, usePaged } from "@/components/common/Paged";
import {
  checkIdOf, decideEscalation, loadApprovalQueue, loadCheckFlags, loadConcerns,
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
/** How many of a check's flags are still WAITING, out of `Followup.clause`'s
 *  "3 left for next pass".
 *
 *  ⚠️ THE HEADING SAID "5 items flagged" OVER TWO CARDS AND EXPLAINED NOTHING
 *  (2026-08-28, reported). Both halves were true and nothing joined them:
 *  `pass.escalated` is what TRIAGE flagged, while a card is drawn per audit row
 *  carrying a subject — and only an INVESTIGATED flag gets one. The other three
 *  were deferred by `max_investigations_per_pass` (2, the cost cap), so they
 *  exist, are named in the pass record, and had nowhere on screen to be.
 *
 *  ⚠️ THE NUMBER WAS ALREADY ON THE ROW. `reason.py` writes "escalated 5
 *  (investigated 2, 3 left for next pass)" — this reads the third figure rather
 *  than deriving it by subtraction, so a check that stopped for a DIFFERENT
 *  reason (budget, a provider outage) does not get counted as deferred. */
export function deferredOf(reason: string): number {
  const m = /(\d+) left for next pass/.exec(reason);
  return m ? Number(m[1]) : 0;
}

export function yieldOf(reason: string): { looked: number; raised: number } {
  const looked = /investigated (\d+)/.exec(reason);
  const raised = /(\d+) concerns?/.exec(reason);
  return { looked: looked ? Number(looked[1]) : 0,
           raised: raised ? Number(raised[1]) : 0 };
}

// ⚠️ `subjectsOf` — the recover-names-from-the-sentence fallback — was DELETED
// with its render site (2026-08-28, owner's request): pre-id checks are no
// longer listed at all, so nothing needs names a card cannot carry.


/** `2026-08-26T19:09:12Z` → `26 Aug 19:09` IN THE READER'S OWN TIME ZONE.
 *
 *  ⚠️ THE ONE CLOCK ON THIS SCREEN, AND IT USED TO BE TWO (2026-08-27).
 *  `audit._now_iso` stamps every row in UTC (`%Y-%m-%dT%H:%M:%SZ`) — correct,
 *  and the only sane thing to store. The flag rows rendered it through here,
 *  so they read local time; the CHECK heading printed the raw string with the
 *  `T` swapped for a space. On a villa at UTC+8 that put `2026-08-27 03:35`
 *  as the heading of a card whose own flags said `27 Aug, 11:34` — one card,
 *  two clocks, eight hours apart, and the owner reasonably read it as the
 *  list being out of order. It was not: the checks were correctly newest-first
 *  in UTC, which is invisible when half the card is in local time.
 *
 *  The fallback still slices the raw string, because an unparseable stamp is
 *  better shown as itself than as "Invalid Date". */
const whenOf = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 16);
  return d.toLocaleString(undefined,
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** One flag, drawn inside the check that raised it.
 *
 *  ⚠️ A CARD THAT ANSWERS THE READER'S THREE QUESTIONS — what was flagged, why,
 *  and what became of it — because "Jacuzzi Pump" on its own answers none of
 *  them (reported from a screenshot: the reason was in the audit the whole
 *  time and never mapped). The WHY is triage's own sentence, verbatim: it was
 *  written to justify a closer look, which is exactly the reader's question. */
function FlagRow({ flag, mode, concern, busy, waiting, onDecide }: {
  flag: CheckFlag;
  /** The mode the CHECK ran under, not the villa's mode today. */
  mode: string;
  concern?: Concern;
  busy: boolean;
  /** From the server's own pending list — never re-derived here. */
  waiting: boolean;
  onDecide: (runId: string, action: "approve" | "dismiss") => void;
}) {
  // ⚠️ WHO SETTLED IT IS PART OF THE ANSWER. "person" is a pressed button —
  // the merge reads it off the `approved` trigger and the dismissal's actor —
  // and everything else was the villa acting on its own mode.
  const byWhom = flag.settledBy === "person" ? " after your go-ahead"
               : flag.settledBy === "villa" ? " by the villa itself" : "";
  const at = flag.settledAt ? ` · ${whenOf(flag.settledAt)}` : "";

  // The outcome line, rendered inside the text column. Built here so the
  // column stays readable; `waiting` renders buttons instead.
  const status = concern ? (
        /* ⚠️ ONLY REACHABLE BECAUSE A CONCERN NOW RECORDS ITS `run_id`
           (2.780.0). Before that a concern named its subject as a HASH of an
           entity id the flag usually does not carry, so this could only ever
           have said "no concern" — including when there was one. */
        <span className="sev-warning flag-row-status" title={`Investigated${byWhom}${at ? at.replace(" · ", " at ") : ""}, and it found something: “${concern.title}”. Read it on the Reason tab.`}>
          <AlertCircle size={16} aria-hidden /> Alert{at}
        </span>
      ) : flag.verdict === "dismissed" ? (
        <span className="muted flag-row-status" title={`Skipped${byWhom}, without spending anything. If it is still true, a later check flags it again.`}>
          <MinusCircle size={16} aria-hidden /> Skipped{at}
        </span>
      ) : flag.runStatus === "failed" || flag.runStatus === "declined" ? (
        <span className="sev-warning flag-row-status" title={`The investigation started${byWhom} but could not finish (${flag.runStatus}). Nothing was concluded — flag it again or check Spend & people for a budget stop.`}>
          <AlertCircle size={16} aria-hidden /> Did not finish{at}
        </span>
      ) : flag.verdict === "deferred" ? (
        /* ⚠️ THE ITEMS THE HEADING ALREADY COUNTED (2026-08-28, owner: "3 items
           are waiting for the next check, but i don't see them in the card").
           They were never recorded until now — `reason.follow_up` broke at the
           per-pass cap and wrote nothing — so the sentence named three things
           the tab could not list. `audit.DEFERRED` is the row; this is the row
           drawn.
           ⚠️ IT SAYS WHAT WAITING MEANS, because "queued" would be wrong: the
           next check re-reads the villa from scratch, so this is flagged again
           only if it is still true. Nothing resumes a list. */
        <span className="muted flag-row-status" title="This check flagged it but had already used its investigation budget for the pass. The next check looks at the villa again from scratch — if this is still true, it is flagged again; if it has cleared, it simply is not.">
          <MinusCircle size={16} aria-hidden /> Waiting for the next check{at}
        </span>
      ) : flag.verdict === "escalated" || mode === "live" || mode === "observe" ? (
        /* ⚠️ AN HONEST CLAIM, NOW PROVABLE PER FLAG. The merged audit rows say
           an investigation RAN (`escalated`), and the concern store says
           nothing came of it — so "looked at, found nothing to raise" is a
           statement about THIS flag, not a guess from the villa's mode.

           ⚠️ `observe` JOINED THIS BRANCH ON 2026-08-28: its concerns now land
           in the live store too, so the lookup above catches them and "all
           clear" is as provable there as in live mode. The old "In your next
           briefing" wording described the shadow-store era, when a concern
           existed but this row could not see it. Residual: an observe flag
           settled BEFORE the change whose concern went to the old shadow file
           reads "all clear" here — rare, historical, and the briefing that
           carried it already said what it concluded. */
        /* ⚠️ "Investigated … no alert needed", NOT "Looked into — all clear"
           (2026-08-28, owner: "since you `investigate` everywhere else I
           suggest you rename it"). Correct: the step is called Reason and its
           chip says Investigated, so a third word for the same act made this
           row read as a different kind of outcome. And "all clear" describes
           the VILLA; what this row can honestly claim is about the ALERT — the
           evidence was read and nothing warranted telling anybody. */
        <span className="muted flag-row-status" title={`Investigated${byWhom}. It read the evidence and concluded nothing needed your attention — a complete answer, not a failure.`}>
          <MinusCircle size={16} aria-hidden /> Investigated{at ? at.replace(" · ", " at ") : ""}: no alert needed
        </span>
      ) : (
        /* ⚠️ NO MODE AND NO RUN RECORDED — a check written before 2.785.0.
           Claiming "in the briefing" would be a claim about a setting nobody
           stored, and it is FALSE in Ask first. "Settled" is the most this
           row can honestly say. */
        <span className="muted flag-row-status" title="This flag was dealt with, but the check that raised it predates the record of how.">
          <MinusCircle size={16} aria-hidden /> Settled{at}
        </span>
      );

  return (
    <li className="fm-row body-text">
      {/* ⚠️ ONE COLUMN, STATUS LAST (2026-08-28, owner's request after the
          wrap fix still read badly beside long reasons): the outcome line
          ("Looked into — all clear · 27 Aug, 04:43") renders INSIDE the text
          column as its own final line, under the reason it concludes. Only
          the two ACTION buttons of a waiting flag stay on the right — they
          are things to press, not things to read. */}
      <div className="flag-row-main">
        <div>{flag.subject}</div>
        {/* Triage's reason: why this earned a closer look. Older audit rows
            carry none, and an absent reason renders nothing rather than a
            placeholder pretending one was recorded. */}
        {flag.reason && (
          <div className="muted flag-row-reason">{flag.reason}</div>
        )}
        {flag.dismissNote && (
          <div className="muted flag-row-reason">Note: {flag.dismissNote}</div>
        )}
        {!waiting && status}
      </div>

      {/* ⚠️ THE AFFORDANCE FOLLOWS THE FLAG'S STATE FIRST AND THE MODE SECOND.
          A villa switched from Ask first to Alert only still has flags that were
          left waiting, and they remain answerable — reading the mode alone
          would strand them with no way to act, which is how the queue reached
          twenty-four items nothing could drain. */}
      {waiting && (
        <>
          <button className="icon-btn" disabled={busy}
                  aria-label={`Investigate ${flag.subject}`}
                  title="Look into this now — one AI investigation, a few cents. The result lands on the Reason tab if anything is wrong."
                  onClick={() => onDecide(flag.runId, "approve")}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden />
                  : <Search size={16} aria-hidden />}
          </button>
          <button className="icon-btn" disabled={busy}
                  aria-label={`Cancel ${flag.subject}`}
                  title="Skip it — nothing is spent. If it is still true, the next check flags it again."
                  onClick={() => onDecide(flag.runId, "dismiss")}>
            <X size={16} aria-hidden />
          </button>
        </>
      )}
    </li>
  );
}


export default function RecentChecks({ passes, empty, mode, canAct, action,
                                       notice, children }: {
  passes: TriagePass[];
  /** What to say when nothing has run. */
  empty: React.ReactNode;
  /** The villa's supervision mode — decides what a settled flag shows. */
  mode?: string;
  /** Owner only: the two buttons spend the budget, and the proxy refuses them
   *  for anybody else regardless. Hidden rather than disabled, so a reader is
   *  never shown a control that could only ever 403. */
  canAct?: boolean;
  /** ⚠️ THE "CHECK THE VILLA NOW" BUTTON, RENDERED ON THE SUMMARY LINE
   *  (2026-08-28, owner's request). It sat on the section heading's row, two
   *  visual tiers away from the totals it changes; the owner asked for it
   *  beside "Across all N checks below …", directly above the Pager row that
   *  carries "Cancel all" — and explicitly NOT in the same row as Cancel all,
   *  which acts on flags rather than starting checks. A slot rather than a
   *  hardcoded import so this component stays renderable without the button
   *  (non-owners, tests). */
  action?: React.ReactNode;
  /** ⚠️ RENDERED BELOW THE TOOLBAR, NEVER INSIDE IT. `action`'s component used
   *  to return its own status paragraph, which landed as a SECOND item in the
   *  toolbar's flex row and moved the button every time a check finished.
   *  Anything that needs saying about a check goes here instead, where the row
   *  above it cannot reflow. */
  notice?: string;
  children?: React.ReactNode;
}) {
  const [flags, setFlags] = useState<CheckFlag[]>([]);
  // ⚠️ THE SERVER DECIDES WHAT IS WAITING, AND THIS PANEL ASKS IT. The first
  // cut re-derived it here as `verdict === "awaiting-approval"` on an audit
  // row — but `audit.pending_escalations` ALSO excludes any run id that has a
  // settling row, and an already-dismissed flag keeps its original AWAITING
  // row forever. So eleven settled flags rendered as pending and every attempt
  // to cancel them was refused: "11 of 14 could not be cancelled", reported
  // exactly that way. A second implementation of a shared predicate is this
  // repository's cardinal sin and this is what it cost.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  // ⚠️ WHICH CARDS THE READER HAS TOGGLED, not which are open (2026-08-28,
  // owner: "collapse all the previous flagged item cards and expand the latest
  // one"). Storing the OPEN set would need seeding on every load and reseeding
  // whenever a new check arrives — and a check that arrives while the dialog is
  // open would either steal the reader's expansion or not open at all. Storing
  // the DEVIATIONS makes "newest open, rest closed" the default forever, with
  // no effect to keep in step: a new newest is open because it is newest, and
  // the card the reader opened three checks ago stays open because they said so.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const flip = useCallback((id: string) => {
    setToggled((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const [f, c, q] = await Promise.all([
      loadCheckFlags(), loadConcerns(), loadApprovalQueue()]);
    setFlags(f);
    setConcerns(c);
    setPending(new Set((q?.pending ?? []).map((p) => p.runId)));
  }, []);
  // ⚠️ RELOADED WHEN THE CHECKS CHANGE, NOT ONLY ON MOUNT (2026-08-28). The
  // parent refetches `passes` when "Check the villa now" finishes, so a new
  // card appeared — with NO items under it, because the flags, the pending
  // queue and the concerns were all still the ones fetched when the dialog
  // opened. A check that says "4 items flagged" above an empty card is the
  // screen contradicting itself, and it is what an owner sees every time they
  // press the button without closing and reopening the dialog.
  //
  // ⚠️ KEYED ON THE LATEST CHECK'S ID, NOT ON THE ARRAY. `passes` is a fresh
  // array on every parent render, so depending on it directly would refetch
  // three stores on each one; the id changes exactly when a new check exists.
  const newest = passes.length ? (passes[passes.length - 1].runId || "") : "";
  useEffect(() => { void load(); }, [load, newest]);

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
  // left in Ask first accumulates a waiting flag per check and the reference
  // villa reached TWENTY-TWO, clearable only one press at a time. Dismiss only,
  // never "investigate all": one investigation is a full frontier-model run, so
  // a bulk approve is a day's ceiling in one press with no undo. Sequential and
  // not `Promise.all` — each writes an audit row through a read-modify-write
  // store, and two dozen concurrent writes is how rows are lost.
  const cancelAll = useCallback(async () => {
    const ids = flags.filter((f) => pending.has(f.runId)).map((f) => f.runId);
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
  }, [flags, pending, load]);

  const waiting = pending.size;

  // ⚠️ PRE-ID CHECKS ARE NO LONGER LISTED (2026-08-28, owner's request).
  // Rows written before 2.780.0 carry `run_id: ""`, so their flags can never
  // be paired and they rendered in the OLD form — subject names inline in the
  // heading sentence. Beside the current cards that read as a second, broken
  // layout, and the records decay rather than improve (the note the status
  // memory has carried since 2.780.0). Their WAITING flags are not lost: the
  // orphans card below is keyed on the pending list, not on the checks.
  const rows = [...passes].reverse()
    .filter((p) => (p.runId || "") !== "")
    .map((p) => {
      const reason = reasonOf(p);
      const id = p.runId || "";
      const mine = flags.filter((f) => checkIdOf(f.runId) === id);
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
  // true of the two Alert modes, and NOT true in Ask first, where nothing
  // reaches the briefing at all. Dropping them removes the claim with them.
  const orphans = flags.filter(
    (f) => !attached.has(f.runId) && pending.has(f.runId));

  // ⚠️ CARDS, NOT ROWS — see `PAGE_CARDS`. Each entry here is several lines
  // with its flagged items nested under it, so the row count that suits a
  // one-line log is a scroll with no end in sight. Named constant, not a
  // literal: the rule is one owner for pagination, not one number.
  const paged = usePaged(rows, PAGE_CARDS);

  if (rows.length === 0) {
    // ⚠️ THE ACTION RENDERS HERE TOO. "Check the villa now" is most needed
    // exactly when nothing has run yet, and hanging it off the summary line
    // alone would make the one control that fixes an empty list disappear
    // with the list.
    return (
      <div className="triage-toolbar">
        <p className="muted body-text">{empty}</p>
        {action}
      </div>
    );
  }

  const work = rows.reduce((acc, r) => {
    const y = yieldOf(r.reason);
    return { looked: acc.looked + y.looked, raised: acc.raised + y.raised };
  }, { looked: 0, raised: 0 });

  return (
    <>
      {/* ⚠️ ONE ROW: THE WINDOW TOTALS AND THE BUTTON THAT EXTENDS THEM
          (2026-08-28, owner's request). The summary and "Check the villa now"
          share a flex row directly above the Pager row that carries "Cancel
          all" — and Cancel all is deliberately NOT in this row: it answers
          waiting flags, this row is about checks. */}
      <div className="triage-toolbar">
        {work.looked > 0 && (
          /* ⚠️ THE TOTAL NAMES ITS WINDOW (2026-08-28). "17 looked into, 2
              raised as a concern" sat directly above the NEWEST check's card,
              so the owner read the 2 as that check's yield, went to the Reason
              tab expecting two open concerns, and found none — the 2 were from
              checks two days earlier, both since dealt with. Verified against
              the log before rewording: no run that day called raise_concern and
              the concern store's response stayed byte-identical throughout. A
              true sentence bound to the wrong scope is this screen's most
              expensive kind of defect. */
          /* ⚠️ ONE VOCABULARY, AND IT IS THE TABS' OWN (2026-08-28, owner:
              "make sure you use the same terminology consistently"). A CHECK
              runs on the schedule; it FLAGS items; a flag that is INVESTIGATED
              may raise a CONCERN; only a concern is ever ESCALATED. The old
              wording said "N became concerns", which named no actor, and
              trailed "open ones and the record of the settled ones" — a clause
              whose subject was the concerns it had just reported as zero, so on
              the common reading it described nothing that existed.

              ⚠️ AND A FLAG THAT RAISED NOTHING IS NOT LOST, WHICH IS THE HALF
              THE SCREEN NEVER SAID (owner's request). Reading "0 concerns"
              beside a flagged Jacuzzi pump invites the conclusion that the
              finding was thrown away. It was not — the analysis that builds the
              briefing reads the same measurements, so the reading behind the
              flag is assessed again there. Worded as the READING rather than
              the flag record, because there is no code path carrying a triage
              flag into the report: the two agree because they read the villa,
              not because one hands the other anything. */
          <p className="muted body-text">
            The {rows.length} check{rows.length === 1 ? "" : "s"} below
            investigated {work.looked} flag{work.looked === 1 ? "" : "s"} and
            raised {work.raised} alert{work.raised === 1 ? "" : "s"}
            {work.raised > 0
              ? ", open and settled alike on the Reason tab." : "."}{" "}
            A flag that raises no alert is not discarded — the reading behind
            it is assessed again in the next briefing.
          </p>
        )}
        {action}
      </div>
      {(note || notice) && (
        <p className="muted body-text" role="status">{note || notice}</p>
      )}
      {/* ⚠️ THE UNATTACHED FLAGS, IN ONE CARD THAT EXPLAINS ITSELF. These are
          real and answerable — they are what "Cancel all N" acts on — and the
          merge made them invisible because a flag was only ever drawn inside a
          check. They are legacy: a check written before 2.780.0 stored no id,
          so nothing can say which one raised them. Saying that is better than
          hiding them or guessing a parent by timestamp, which is the pairing
          this release replaced precisely because it goes wrong when two checks
          overlap. */}
      {orphans.length > 0 && (
        <ul className="fm-list">
          <li className="editable-row-card">
            <div className="body-text">
              <strong>{orphans.length} flagged item{orphans.length === 1 ? "" : "s"}</strong>
              {" waiting, from checks recorded before "}
              <span className="muted">
                {"checks carried an id — so which check raised them is not known"}
              </span>
            </div>
            <ul className="fm-list" style={{ marginTop: 6 }}>
              {orphans.map((f) => (
                <FlagRow key={f.runId} flag={f} mode={mode || ""}
                         concern={concerns.find((c) => c.run_id === f.runId)}
                         busy={busy === f.runId} waiting={pending.has(f.runId)}
                         onDecide={canAct ? decide : () => {}} />
              ))}
            </ul>
          </li>
        </ul>
      )}
      {/* ⚠️ IN THE PAGER ROW, LEFT OF THE ARROWS. `Pager` already renders its
          children there — that slot exists for exactly this — and a control
          floating in its own row above the list read as belonging to the
          heading rather than to the list it acts on.

          ⚠️ ALWAYS RENDERED, GREYED WHEN THERE IS NOTHING TO ACT ON — by the
          owner's explicit request (2026-08-28), reversing the earlier
          "only when more than one is waiting" rule. A control that appears
          and disappears with the villa's mode reads as a broken screen to
          anyone who saw it yesterday; a greyed one with a tooltip says WHY it
          has nothing to do. The tooltip states the mode fact: flags only WAIT
          in Ask first — the other two modes investigate them on the spot —
          while flags left waiting from an earlier Ask first period stay
          cancellable in any mode, so `waiting`, not the mode, decides
          disabled. */}
      <Pager paged={paged} unit="check">
        {canAct && (
          <button className="btn ghost"
                  disabled={busy !== null || waiting === 0}
                  onClick={() => void cancelAll()}
                  title={waiting > 0
                    ? "Cancel every flag still waiting — spends nothing, and "
                      + "anything still true is flagged again by the next check"
                    : mode === "ask"
                    ? "Nothing is waiting for your decision right now — new "
                      + "flags will queue here on the next check"
                    : "Nothing is waiting. In the current mode the villa "
                      + "investigates its own flags immediately; flags only "
                      + "queue up for this button in Ask first"}>
            <X size={16} aria-hidden />
            {" Cancel all"}{waiting > 0 ? ` ${waiting}` : ""} flagged item{waiting === 1 ? "" : "s"}
          </button>
        )}
        {children}
      </Pager>
      {/* ⚠️ `.fm-list` — A FLEX COLUMN OF ROWS, NOT A BULLETED LIST. It was the
          one list class in styles.css that did not reset `list-style`, so every
          row drew a marker; reported as clutter. */}
      <ul className="fm-list">
        {paged.page.map(({ pass, reason, outcome, flags: mine }, i) => {
          // ⚠️ NEWEST OPEN, EVERY OLDER ONE CLOSED, AND A TOGGLE FLIPS THAT.
          // `rows` is reversed (newest first) and the pager preserves it, so
          // the newest card is index 0 of page 0 — asked of the LIST rather
          // than of a timestamp, because two checks in the same minute would
          // otherwise both open.
          const newestCard = paged.pageNo === 0 && i === 0;
          const id = pass.runId || `${pass.at}-${i}`;
          const open = toggled.has(id) ? !newestCard : newestCard;
          return (
            /* ⚠️ A CARD PER CHECK, NOT A LINE. The list was a wall of
                timestamps with the flags somewhere else entirely; the owner
                asked for one card per check carrying its own items and its own
                actions on the right. `.editable-row-card` is the app's existing
                card, so this invents no new surface. */
            <li key={`${pass.at}-${i}`} className="editable-row-card">
              <div className="editable-row">
                <div className="editable-row-fields editable-row-tight">
                  {/* ⚠️ THE HEADING IS THE TOGGLE, AND ONLY WHEN THERE IS
                      SOMETHING TO SHOW. A card with no items is already its
                      whole content, so making it pressable would offer an
                      action that does nothing — the shape this app removes
                      rather than greys out. A check with items renders a
                      `<button>` so it is reachable by keyboard and announces
                      its state; one without renders the same markup in a
                      plain `<div>`. */}
                  {mine.length > 0 ? (
                    <button
                      type="button"
                      className="check-card-toggle body-text"
                      aria-expanded={open}
                      onClick={() => flip(id)}
                    >
                      <ChevronRight
                        size={14}
                        aria-hidden
                        className={`check-card-caret${open ? " open" : ""}`}
                      />
                      <span>
                    {/* ⚠️ `whenOf`, NOT THE RAW STRING. See its header: this
                        printed UTC beside flag rows printing local time, so a
                        card read 03:35 over items stamped 11:34. */}
                    <span className="muted">{whenOf(pass.at)}</span>{" · "}
                    {outcome === "raised" ? (
                      <>
                        <strong>
                          {pass.escalated ?? 0} item{pass.escalated === 1 ? "" : "s"}
                          {" flagged in this check"}
                        </strong>
                        {/* ⚠️ AND WHY THE CARDS BELOW MAY BE FEWER. Without
                            this the heading counted what was FLAGGED while the
                            cards showed what was LOOKED INTO, with nothing
                            saying the rest are queued rather than lost. */}
                        {deferredOf(reasonOf(pass)) > 0 && (
                          <span className="muted">
                            {" — "}{yieldOf(reasonOf(pass)).looked} looked into,{" "}
                            {deferredOf(reasonOf(pass))} waiting for the next
                            check
                          </span>
                        )}
                        {/* ⚠️ THE INLINE-NAMES FALLBACK IS GONE (2026-08-28,
                            owner's request). It printed the flag names in the
                            heading sentence whenever pairing failed — the OLD
                            layout, which beside the nested cards read as a
                            second, broken one. A check whose items cannot be
                            drawn now shows its count alone; the names live in
                            the cards or nowhere. */}
                      </>
                    ) : outcome === "quiet" ? (
                      <>Nothing to flag in this check</>
                    ) : (
                      <>
                        <strong className="sev-warning">Could not run</strong>
                        {" — "}{reason}
                      </>
                    )}
                    {outcome !== "blocked" && pass.docChars === 0 && (
                      <span className="sev-warning"> · nothing to read</span>
                    )}
                      </span>
                    </button>
                  ) : (
                    <div className="body-text">
                      <span className="muted">{whenOf(pass.at)}</span>{" · "}
                      {outcome === "quiet"
                        ? <>Nothing to flag in this check</>
                        : outcome === "blocked"
                          ? <><strong className="sev-warning">Could not run</strong>{" — "}{reason}</>
                          : <strong>
                              {pass.escalated ?? 0} item
                              {pass.escalated === 1 ? "" : "s"} flagged in this check
                            </strong>}
                      {outcome !== "blocked" && pass.docChars === 0 && (
                        <span className="sev-warning"> · nothing to read</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {mine.length > 0 && open && (
                <ul className="fm-list" style={{ marginTop: 6 }}>
                  {mine.map((f) => (
                    <FlagRow
                      key={f.runId}
                      flag={f}
                      /* ⚠️ THE CHECK'S OWN MODE. Reading the villa's CURRENT
                         setting would relabel every past check the moment an
                         owner changed their mind. */
                      mode={pass.mode || ""}
                      concern={concerns.find((c) => c.run_id === f.runId)}
                      busy={busy === f.runId}
                      waiting={pending.has(f.runId)}
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
