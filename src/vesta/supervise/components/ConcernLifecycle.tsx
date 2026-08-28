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
// Three `-1` ratings on one subject suppress it, deterministically, and until now
// a rule switching itself off was something an owner could only discover by
// noticing an absence.

import type { Concern, ConcernState } from "@/vesta/shared/agentTypes";
import InfoHint from "@/components/common/InfoHint";
import { downloadFile, filenameSlug } from "@/utils/download";

/** One settled group, as a spreadsheet.
 *
 *  ⚠️ THE COUNTS WERE THE ONLY RECORD AND THEY ARE NOT READABLE (2026-08-28,
 *  owner's request). "Closed 3" is the end of the trail: the wall lists live
 *  concerns only, so what those three WERE — what was raised, when, who was
 *  told, how it ended — existed on the tablet and nowhere a person could take
 *  away. Pressing a count now downloads exactly that group.
 *
 *  ⚠️ CSV, AND `\r\n` ENDINGS, BECAUSE THE DESTINATION IS A SPREADSHEET. RFC
 *  4180 is what Excel and Numbers expect; a bare \n opens as one long row in
 *  older Excel on Windows, which is precisely the reader who asked for a file
 *  rather than a screen.
 *
 *  ⚠️ EVERY FIELD IS QUOTED AND EVERY QUOTE DOUBLED. A concern title is model
 *  prose and routinely contains a comma; one unquoted comma shifts every later
 *  column of that row silently, which is a spreadsheet that looks fine and is
 *  wrong. */
const CSV_COLUMNS = ["Raised", "Severity", "What it said", "Outcome",
                     "Told", "Told to", "Seen by"] as const;

function toCsv(rows: Concern[]): string {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const when = (iso: unknown) => {
    const d = new Date(String(iso ?? ""));
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
  };
  const lines = [CSV_COLUMNS.map(cell).join(",")];
  for (const c of rows) {
    lines.push([
      when(c.openedAt), c.severity, c.title,
      // The settled record's whole point: closed, dismissed and "the fix did
      // not hold" are three different endings and the count cannot say which.
      c.outcome ?? "",
      when(c.delivered_at),
      (c.deliveries ?? []).map((d) => d.profile).join(" then ")
        || (c.audience === "facility" ? "Facility manager" : "Owner"),
      c.acknowledged_by ?? "",
    ].map(cell).join(","));
  }
  // ⚠️ A TRAILING NEWLINE. POSIX tools treat a file without one as truncated,
  // and this is a file somebody may pipe as well as open.
  return lines.join("\r\n") + "\r\n";
}

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
    label: "Closed by a person",
    // ⚠️ IT NO LONGER SAYS "not worth raising", BECAUSE THE BUTTON NO LONGER
    // SAYS IT (2026-08-28). `Seen` and `Dismiss` merged into one "nothing more
    // is needed", which is also pressed by somebody who has the work in hand —
    // so this state means "a person ended it", and what stops a subject being
    // raised again is the -1 rating, counted separately.
    hint: "A person said nothing more was needed. Rate an alert ⬇️ if you also "
        + "want fewer like it.",
  },
};

/** ⚠️ THE THRESHOLD IS THE BACKEND'S, RESTATED FOR THE READER RATHER THAN
 *  RE-DECIDED. `concerns.suppressed_subjects` counts `-1` RATINGS — not
 *  cancellations, since 2026-08-28 — and the rule is three; this only says so
 *  on screen. If that number ever moves, this line is
 *  wrong and the copy above is wrong with it — which is why both live here
 *  together rather than in the component that renders them. */
export const SUPPRESS_AFTER = 3;

/** Where a concern is in its life, as a chip.
 *
 *  ⚠️ NOTHING RENDERS THIS TODAY, AND THAT IS A RECORDED DECISION RATHER THAN
 *  DEAD CODE. (dry-audit:ok) `AgentConcerns` dropped it on 2026-08-27 at the owner's
 *  instruction because it could only ever say one thing: the wall lists LIVE
 *  concerns, nothing in the backend has ever written `acted`, so every card
 *  read "Nothing done yet" whatever anybody did. The moment a transition to
 *  `acted` exists, the chip comes back with it — and `STATE_COPY` above is
 *  used by the settled record regardless.
 *
 *  ⚠️ THE VERDICT IS WRITTEN HERE, NOT WHERE IT WAS REMOVED. It lived only in
 *  a comment in `AgentConcerns.tsx`, so /dry-audit's unused-export probe
 *  re-adjudicated this every run by opening the wrong file. */
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
  // ⚠️ "CAME BACK" IS A SLICE OF `closed`, NOT A SIXTH STATE, and it is
  // subtracted from the Closed count rather than double-counted — the three
  // numbers under a heading that reads as a breakdown must add up to what was
  // settled, or a reader totals them and gets more concerns than the villa
  // ever had.
  //
  // ⚠️ AND IT IS THE OTHER HALF OF "Fixed and confirmed". That count could
  // only ever be zero until the verification sweep was wired, and a screen
  // that can say a fix WORKED while having no way to say one FAILED reports a
  // success rate of 100% by construction. The two are produced by the same
  // sweep, in the same pass, from the same evidence.
  const isCameBack = (c: Concern) =>
    String(c.state ?? "") === "closed"
    && String(c.outcome ?? "").startsWith("the fix did not hold");
  const cameBack = concerns.filter(isCameBack).length;
  const closed = by("closed") - cameBack;
  if (verified + dismissed + closed + cameBack === 0) return null;

  /** ⚠️ THE GROUP IS DERIVED THE SAME WAY IT IS COUNTED, from one predicate
   *  each, so a file can never disagree with the number that opened it. The
   *  first cut filtered again inside the handler and `Closed` exported the
   *  came-back rows too — the number said 3 and the file held 4. */
  const save = (label: string, rows: Concern[]) => {
    if (rows.length === 0) return;
    downloadFile(`vesta-${filenameSlug(label)}-${
      new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows),
      "text/csv;charset=utf-8");
  };

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
          control and nobody read them). It LEADS the row: it explains all four
          counts, and hanging it off the first one (as it did until 2026-08-28)
          read as belonging to that number alone. */}
      <dl className="tier-facts">
        {/* ⚠️ THE (i) LEADS THE ROW (2026-08-28, owner: "move the (i) icon in
            the last line at the beginning of the line"). It used to hang off
            "Fixed and confirmed" — chosen because that count is what the
            explanation is most ABOUT — but it explains all four, and sitting
            between the first label and its number it read as belonging to that
            one number, with the other three unexplained. At the head of the
            line it is unambiguous: this is the key to what follows.
            ⚠️ ITS OWN CELL, NOT INSIDE THE FIRST PAIR. `.tier-facts` is a flex
            row of label/value pairs, so an icon smuggled into the first `<dt>`
            inherits that pair's spacing and drifts with the label's length. */}
        <div className="tier-facts-lead">
          <InfoHint label="Reading these counts">
            <p>
                It is the only count that says something actually worked: the
                condition stopped after somebody did something. Every other
                count says what was SAID, not what changed.
              </p>
              <p>
                &ldquo;Came back&rdquo; is the same check answering the other
                way: the villa raised the same thing again after it had been
                closed, so whatever was done did not hold. Both are decided a
                week after an alert is closed, and only when the villa was
                listening for that whole week — otherwise it says nothing
                rather than guessing.
              </p>
              <p>
                Dismissals are just as useful in the other direction — they are
                how the villa learns what you do not want to hear about.
              </p>
          </InfoHint>
        </div>
        {/* ⚠️ THE LABEL IS THE CONTROL, NEVER THE NUMBER (2026-08-28, owner:
            "don't make the number clickable but the text"). A one- or
            two-character press target on a wall tablet reads as decoration
            rather than a control. The (i) that used to sit in this `<dt>` now
            leads the row above — nesting `InfoHint`'s own button inside this
            one was invalid HTML, which browsers resolve by giving the outer
            element the click. */}
        <div>
          <dt>
            <button type="button" className="link-count"
                    disabled={verified === 0}
                    title="Download these as a spreadsheet"
                    onClick={() => save("Fixed and confirmed",
                      concerns.filter((c) => String(c.state ?? "") === "verified"))}>
              Fixed and confirmed
            </button>
          </dt>
          <dd>{verified}</dd>
        </div>
        <div>
          <dt>
            <button type="button" className="link-count"
                    disabled={cameBack === 0}
                    title="Download these as a spreadsheet"
                    onClick={() => save("Came back", concerns.filter(isCameBack))}>
              Came back
            </button>
          </dt>
          <dd>{cameBack}</dd>
        </div>
        <div>
          <dt>
            <button type="button" className="link-count"
                    disabled={dismissed === 0}
                    title="Download these as a spreadsheet"
                    onClick={() => save("Judged not useful", concerns.filter((c) => String(c.state ?? "") === "dismissed"))}>
              Judged not useful
            </button>
          </dt>
          <dd>{dismissed}</dd>
        </div>
        <div>
          <dt>
            <button type="button" className="link-count"
                    disabled={closed === 0}
                    title="Download these as a spreadsheet"
                    onClick={() => save("Closed", concerns.filter((c) => String(c.state ?? "") === "closed" && !isCameBack(c)))}>
              Closed
            </button>
          </dt>
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
