// src/components/agent/ConcernLifecycle.tsx
//
// Where a concern is in its life, and what the settled ones are worth.
//
// ⚠️ THE LIFECYCLE EXISTED IN FULL AND WAS INVISIBLE. `agent/concerns.py`
// implements all five states, the transitions between them, the dismissal
// counter and the suppression rule that counter drives — and the wall rendered
// `open` and `acted` identically and hid the other three entirely. So a reader
// could not tell whether anything had been DONE about a concern, and the
// settled ones — the record of what worked and what was noise — had no surface
// at all.
//
// ⚠️ AND THE HLD IS EMPHATIC ABOUT WHY THAT MATTERS. §6.2: "The current system
// cannot tell whether a fix worked, cannot measure whether a rule is noisy, and
// cannot compute median time to clear — all three are recorded as not
// computable... Giving a finding a lifecycle produces verification, fatigue
// measurement and the eval corpus as by-products of the same field." Every one
// of those by-products is read off the state, so a state nobody can see is a
// field that produces none of them.
//
// ⚠️ THE DISMISSED BRANCH IS THE ONE TO SURFACE HARDEST — the same section calls
// it "the highest-value signal in the system and nearly free to collect".
// Three dismissals on one subject suppress it, deterministically, and until now
// a rule switching itself off was something an owner could only discover by
// noticing an absence.

import type { Concern, ConcernState } from "@/agent/agentTypes";
import InfoHint from "@/components/common/InfoHint";

/** ⚠️ ONE TABLE, AND IT IS THE ONLY PLACE A STATE IS NAMED OR EXPLAINED. Five
 *  states rendered ad hoc across a list and a history view is five chances to
 *  describe the same field differently — the drift this repository keeps
 *  paying for. `CONCERN_STATE` is the source of the set; this is the source of
 *  what each one MEANS to a reader. */
export const STATE_COPY: Record<ConcernState, { label: string; hint: string }> = {
  open: {
    label: "Nothing done yet",
    hint: "Raised and still standing. Nobody has acted and it has not stopped "
        + "on its own.",
  },
  acted: {
    label: "Acted on",
    hint: "The villa did something about it, or a person did. It is being "
        + "watched to see whether that worked.",
  },
  verified: {
    label: "Fixed — it stopped",
    hint: "The condition stopped happening after the action. This is the only "
        + "state that says a fix actually worked.",
  },
  closed: {
    label: "Closed",
    hint: "Finished with. Kept as a record of what happened.",
  },
  dismissed: {
    label: "Not useful",
    hint: "Somebody said this was not worth raising. Three of these about the "
        + "same thing stop it being raised again.",
  },
};

/** ⚠️ THE THRESHOLD IS THE BACKEND'S, RESTATED FOR THE READER RATHER THAN
 *  RE-DECIDED. `concerns.suppressed_subjects` counts dismissals and the rule is
 *  three; this only says so on screen. If that number ever moves, this line is
 *  wrong and the copy above is wrong with it — which is why both live here
 *  together rather than in the component that renders them. */
export const SUPPRESS_AFTER = 3;

export function LifecycleChip({ state }: { state: ConcernState }) {
  const copy = STATE_COPY[state];
  // ⚠️ AN UNKNOWN STATE RENDERS NOTHING rather than an empty pill. The store is
  // written by Python and served verbatim, so a newer add-on can send a state
  // this build has never heard of, and a blank chip reads as a fault in the app
  // rather than as a value it does not know.
  if (!copy) return null;
  return (
    <span className={`lifecycle-chip lifecycle-${state}`} title={copy.hint}>
      {copy.label}
    </span>
  );
}

/**
 * What the settled concerns add up to.
 *
 * ⚠️ COUNTS, NOT A LIST. The wall's job is the state of the villa now, and a
 * scroll of everything that ever happened would bury it. What a reader actually
 * needs from the settled ones is three numbers: did fixes work, how much was
 * noise, and is anything now being silenced because of it.
 */
export function SettledSummary({ concerns }: { concerns: Concern[] }) {
  const by = (s: ConcernState) =>
    concerns.filter((c) => String(c.state ?? "open") === s).length;
  const verified = by("verified");
  const dismissed = by("dismissed");
  const closed = by("closed");
  if (verified + dismissed + closed === 0) return null;

  // ⚠️ SUBJECTS AT OR PAST THE THRESHOLD, computed the same way the backend
  // counts them: dismissals grouped by `subjectKey`. A subject here is one the
  // villa has stopped raising, which is a rule switching itself off — the one
  // thing in this whole lifecycle an owner must not discover by accident.
  const perSubject = new Map<string, number>();
  for (const c of concerns) {
    if (String(c.state ?? "") !== "dismissed") continue;
    const k = String(c.subjectKey ?? "");
    if (k) perSubject.set(k, (perSubject.get(k) ?? 0) + 1);
  }
  const silenced = [...perSubject.values()]
    .filter((n) => n >= SUPPRESS_AFTER).length;

  return (
    <>
      {/* ⚠️ NO SECTION TITLE (2026-08-27, owner's request). "What came of them"
          sat directly under "Concerns — what the villa concluded" on the same
          tab, so it announced a second section where there is only a footer of
          counts — a heading that costs a line and says nothing the counts do
          not. The counts themselves are the label.

          ⚠️ AND THE PROSE BECAME THE (i), which is this app's settled rule: at
          most two lines of description on screen and everything else inside an
          InfoHint (see its header — the panes had grown a paragraph per
          control and nobody read them). It hangs off "Fixed and confirmed"
          because that count is what the whole explanation is ABOUT, so the
          reader meets the icon exactly where the question occurs to them,
          rather than after the numbers have already been read. */}
      <dl className="tier-facts">
        <div>
          <dt>
            Fixed and confirmed
            <InfoHint label="Reading these counts">
              <p>
                It is the only count that says something actually worked: the
                condition stopped after somebody did something. Every other
                count says what was SAID, not what changed.
              </p>
              <p>
                Dismissals are just as useful in the other direction — they are
                how the villa learns what you do not want to hear about.
              </p>
            </InfoHint>
          </dt>
          <dd>{verified}</dd>
        </div>
        <div>
          <dt>Judged not useful</dt>
          <dd>{dismissed}</dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>{closed}</dd>
        </div>
      </dl>
      {silenced > 0 && (
        <p className="body-text sev-warning">
          {silenced === 1 ? "One thing is" : `${silenced} things are`} no longer
          being raised, because {silenced === 1 ? "it was" : "they were"}{" "}
          dismissed {SUPPRESS_AFTER} times. That is the villa taking you at your
          word — it will stay quiet about {silenced === 1 ? "it" : "them"} until
          you say otherwise.
        </p>
      )}
    </>
  );
}
